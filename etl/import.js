// ---------------------------------------------------------------------
// ScoutLens - one-time CSV -> MySQL import.
//
//   node etl/import.js            load data/player_stats_2020_2026.csv
//   CSV_PATH=other.csv node etl/import.js
//
// The script is idempotent: it truncates the statistics tables before
// loading, so it can be re-run after a fresh scrape without duplicating
// rows. Application tables (users, shortlists, squads) are left alone.
// ---------------------------------------------------------------------

import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { parse } from 'csv-parse';
import { dbConfig, CSV_PATH } from './config.js';
import {
  coalesce, toInt, toUInt, toFloat,
  parseAge, parseNation, parseLeague, parsePositions, parseSeason,
  normalizeName, preferredSpelling,
} from './parse.js';

const BATCH = 1000;

const POSITIONS = [
  ['GK', 'Goalkeeper', 1],
  ['DF', 'Defender', 2],
  ['MF', 'Midfielder', 3],
  ['FW', 'Forward', 4],
];

/** Reads the CSV fully into memory (~6.5 MB / 21k rows - comfortably small). */
async function readCsv(path) {
  if (!fs.existsSync(path)) {
    throw new Error(
      `CSV not found at ${path}\n` +
      `Place the dataset there or set CSV_PATH. See docs/DATA.md.`);
  }
  const rows = [];
  const parser = fs.createReadStream(path).pipe(
    parse({ columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }));
  for await (const row of parser) rows.push(row);
  return rows;
}

/** Inserts rows in batches and returns the number of affected rows. */
async function insertBatch(conn, sql, rows) {
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const [res] = await conn.query(sql, [chunk]);
    total += res.affectedRows ?? chunk.length;
  }
  return total;
}

async function main() {
  console.log(`ScoutLens import\n  source: ${CSV_PATH}`);
  const rows = await readCsv(CSV_PATH);
  console.log(`  parsed: ${rows.length.toLocaleString()} CSV rows`);

  const conn = await mysql.createConnection({ ...dbConfig, multipleStatements: true });

  // ---- reset ------------------------------------------------------
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['stats_standard', 'stats_shooting', 'stats_keeper',
                   'stats_playing_time', 'stats_misc', 'fantasy_points',
                   'player_season_positions', 'player_seasons',
                   'players', 'teams', 'nations', 'leagues', 'seasons', 'positions']) {
    await conn.query(`TRUNCATE TABLE ${t}`);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');

  // ---- dimensions -------------------------------------------------
  await conn.query(
    'INSERT INTO positions (code, name, sort_order) VALUES ?', [POSITIONS]);
  const positionId = new Map();
  for (const [id, code] of (await conn.query('SELECT position_id, code FROM positions'))[0]
       .map((r) => [r.position_id, r.code])) positionId.set(code, id);

  // Collect distinct dimension values in one pass over the CSV.
  const seasons = new Map(), leagues = new Map(), nations = new Map(), teams = new Map();
  for (const row of rows) {
    const season = parseSeason(row.season);
    if (season.label) seasons.set(season.label, season);

    const league = parseLeague(coalesce(row, 'Comp', 'Comp_playing_time', 'Comp_keeper'));
    if (league) leagues.set(league.fbrefCode, league);

    const nation = parseNation(coalesce(row, 'Nation', 'Nation_playing_time', 'Nation_keeper'));
    if (nation) nations.set(nation.fbrefCode, nation);

    const team = (row.Squad ?? '').trim();
    if (team) teams.set(team, team);
  }

  await conn.query('INSERT INTO seasons (label, start_year, end_year) VALUES ?',
    [[...seasons.values()].sort((a, b) => a.startYear - b.startYear)
      .map((s) => [s.label, s.startYear, s.endYear])]);
  await conn.query('INSERT INTO leagues (fbref_code, name, country_code, country_name) VALUES ?',
    [[...leagues.values()].map((l) => [l.fbrefCode, l.name, l.countryCode, l.countryName])]);
  await conn.query('INSERT INTO nations (fbref_code, flag_code, code) VALUES ?',
    [[...nations.values()].map((n) => [n.fbrefCode, n.flagCode, n.code])]);
  await conn.query('INSERT INTO teams (name) VALUES ?',
    [[...teams.keys()].sort().map((t) => [t])]);

  const idMap = async (sql, keyCol, idCol) => {
    const [res] = await conn.query(sql);
    return new Map(res.map((r) => [r[keyCol], r[idCol]]));
  };
  const seasonId = await idMap('SELECT season_id, label FROM seasons', 'label', 'season_id');
  const leagueId = await idMap('SELECT league_id, fbref_code FROM leagues', 'fbref_code', 'league_id');
  const nationId = await idMap('SELECT nation_id, fbref_code FROM nations', 'fbref_code', 'nation_id');
  const teamId   = await idMap('SELECT team_id, name FROM teams', 'name', 'team_id');
  console.log(`  dimensions: ${seasons.size} seasons, ${leagues.size} leagues, ` +
              `${nations.size} nations, ${teams.size} teams`);

  // ---- players ----------------------------------------------------
  // Identity is (name, born_year): 49 names in this dataset belong to two
  // different people, and birth year is what separates them.
  const players = new Map();
  for (const row of rows) {
    const name = (row.Player ?? '').trim();
    if (!name) continue;
    const born = toUInt(row.Born);
    const key = `${normalizeName(name)}|${born ?? 0}`;
    const existing = players.get(key);
    if (existing) {
      // Same person spelled two ways in the scrape - keep the richer spelling.
      existing[0] = preferredSpelling(existing[0], name);
      continue;
    }
    const nation = parseNation(coalesce(row, 'Nation', 'Nation_playing_time', 'Nation_keeper'));
    players.set(key, [name, born, nation ? nationId.get(nation.fbrefCode) : null]);
  }
  await insertBatch(conn, 'INSERT INTO players (full_name, born_year, nation_id) VALUES ?',
    [...players.values()]);
  const [playerRows] = await conn.query(
    'SELECT player_id, full_name, born_key FROM players');
  const playerId = new Map(
    playerRows.map((r) => [`${normalizeName(r.full_name)}|${r.born_key}`, r.player_id]));
  console.log(`  players: ${playerId.size.toLocaleString()} distinct identities`);

  // ---- player_seasons ---------------------------------------------
  // Grain: one row per player per club per season (transfers -> 2 rows).
  const facts = [], factKeys = [];
  const skipped = { noLeague: 0, noPlayer: 0, duplicate: 0 };
  const seen = new Set();

  for (const row of rows) {
    const name = (row.Player ?? '').trim();
    const born = toUInt(row.Born);
    const pid = playerId.get(`${normalizeName(name)}|${born ?? 0}`);
    if (!pid) { skipped.noPlayer++; continue; }

    const league = parseLeague(coalesce(row, 'Comp', 'Comp_playing_time', 'Comp_keeper'));
    const lid = league ? leagueId.get(league.fbrefCode) : null;
    const sid = seasonId.get((row.season ?? '').trim());
    const tid = teamId.get((row.Squad ?? '').trim());
    if (!lid || !sid || !tid) { skipped.noLeague++; continue; }

    const dedupe = `${pid}|${tid}|${sid}`;
    if (seen.has(dedupe)) { skipped.duplicate++; continue; }
    seen.add(dedupe);

    const age = parseAge(row.Age);
    const positions = parsePositions(coalesce(row, 'Pos', 'Pos_playing_time', 'Pos_keeper'));
    const primary = positions.length ? positionId.get(positions[0]) ?? null : null;
    const rank = toUInt(coalesce(row, 'Rk_shooting', 'Rk_playing_time', 'Rk_keeper'));

    facts.push([pid, tid, lid, sid, age.years, age.days, primary, rank]);
    factKeys.push({ row, positions, dedupe });
  }

  await insertBatch(conn,
    `INSERT INTO player_seasons
       (player_id, team_id, league_id, season_id, age_years, age_days,
        primary_position, fbref_rank) VALUES ?`, facts);

  const [psRows] = await conn.query(
    'SELECT player_season_id, player_id, team_id, season_id FROM player_seasons');
  const psId = new Map(psRows.map((r) => [`${r.player_id}|${r.team_id}|${r.season_id}`, r.player_season_id]));
  console.log(`  player_seasons: ${psId.size.toLocaleString()} rows ` +
              `(skipped ${skipped.noLeague} unmappable, ${skipped.duplicate} duplicate)`);

  // ---- positions junction + stat categories -----------------------
  const psp = [], standard = [], shooting = [], keeper = [], playing = [], misc = [];

  for (const { row, positions, dedupe } of factKeys) {
    const id = psId.get(dedupe);
    if (!id) continue;

    positions.forEach((code, i) => {
      const pid = positionId.get(code);
      if (pid) psp.push([id, pid, i === 0 ? 1 : 0]);
    });

    // A Standard row exists only when the player actually featured.
    if ((row['Playing Time_MP'] ?? '').trim() !== '') {
      standard.push([id,
        toUInt(row['Playing Time_MP']), toUInt(row['Playing Time_Starts']),
        toUInt(row['Playing Time_Min']), toFloat(row['Playing Time_90s']),
        toUInt(row['Performance_Gls']), toUInt(row['Performance_Ast']),
        toUInt(row['Performance_G+A']), toUInt(row['Performance_G-PK']),
        toUInt(row['Performance_PK']), toUInt(row['Performance_PKatt']),
        toUInt(row['Performance_CrdY']), toUInt(row['Performance_CrdR']),
        toFloat(row['Per 90 Minutes_Gls']), toFloat(row['Per 90 Minutes_Ast']),
        toFloat(row['Per 90 Minutes_G+A']), toFloat(row['Per 90 Minutes_G-PK']),
        toFloat(row['Per 90 Minutes_G+A-PK'])]);
    }

    if ((row['Standard_Sh'] ?? '').trim() !== '') {
      shooting.push([id,
        toUInt(row['Standard_Sh']), toUInt(row['Standard_SoT']),
        toFloat(row['Standard_SoT%']), toFloat(row['Standard_Sh/90']),
        toFloat(row['Standard_SoT/90']), toFloat(row['Standard_G/Sh']),
        toFloat(row['Standard_G/SoT'])]);
    }

    if ((row['Performance_Saves'] ?? '').trim() !== '' ||
        (row['Performance_GA'] ?? '').trim() !== '') {
      keeper.push([id,
        toUInt(row['Playing Time_MP_keeper']), toUInt(row['Playing Time_Starts_keeper']),
        toUInt(row['Playing Time_Min_keeper']), toFloat(row['90s_keeper']),
        toUInt(row['Performance_GA']), toFloat(row['Performance_GA90']),
        toUInt(row['Performance_SoTA']), toUInt(row['Performance_Saves']),
        toFloat(row['Performance_Save%']), toUInt(row['Performance_W']),
        toUInt(row['Performance_D']), toUInt(row['Performance_L']),
        toUInt(row['Performance_CS']), toFloat(row['Performance_CS%']),
        toUInt(row['Penalty Kicks_PKatt']), toUInt(row['Penalty Kicks_PKA']),
        toUInt(row['Penalty Kicks_PKsv']), toUInt(row['Penalty Kicks_PKm']),
        toFloat(row['Penalty Kicks_Save%'])]);
    }

    if ((row['Playing Time_MP_playing_time'] ?? '').trim() !== '') {
      playing.push([id,
        toUInt(row['Playing Time_MP_playing_time']), toFloat(row['Playing Time_Mn/MP']),
        toFloat(row['Playing Time_Min%']), toFloat(row['Playing Time_90s_playing_time']),
        toUInt(row['Starts_Starts']), toFloat(row['Starts_Mn/Start']),
        toUInt(row['Starts_Compl']), toUInt(row['Subs_Subs']),
        toFloat(row['Subs_Mn/Sub']), toUInt(row['Subs_unSub']),
        toFloat(row['Team Success_PPM']), toUInt(row['Team Success_onG']),
        toUInt(row['Team Success_onGA']), toInt(row['Team Success_+/-']),
        toFloat(row['Team Success_+/-90']), toFloat(row['Team Success_On-Off'])]);
    }

    const hasMisc = ['Performance_2CrdY', 'Performance_Fls', 'Performance_Fld',
      'Performance_Off', 'Performance_Crs', 'Performance_Int', 'Performance_TklW',
      'Performance_PKwon', 'Performance_OG'].some((k) => (row[k] ?? '').trim() !== '');
    if (hasMisc) {
      misc.push([id,
        toUInt(row['Performance_2CrdY']), toUInt(row['Performance_Fls']),
        toUInt(row['Performance_Fld']), toUInt(row['Performance_Off']),
        toUInt(row['Performance_Crs']), toUInt(row['Performance_Int']),
        toUInt(row['Performance_TklW']), toUInt(row['Performance_PKwon']),
        toUInt(row['Performance_OG'])]);
    }
  }

  await insertBatch(conn,
    'INSERT INTO player_season_positions (player_season_id, position_id, is_primary) VALUES ?', psp);
  await insertBatch(conn,
    `INSERT INTO stats_standard (player_season_id, matches_played, starts, minutes,
       nineties, goals, assists, goals_assists, goals_minus_pk, pens_made, pens_att,
       cards_yellow, cards_red, goals_per90, assists_per90, ga_per90,
       g_minus_pk_per90, ga_minus_pk_per90) VALUES ?`, standard);
  await insertBatch(conn,
    `INSERT INTO stats_shooting (player_season_id, shots, shots_on_target, sot_pct,
       shots_per90, sot_per90, goals_per_shot, goals_per_sot) VALUES ?`, shooting);
  await insertBatch(conn,
    `INSERT INTO stats_keeper (player_season_id, matches_played, starts, minutes, nineties,
       goals_against, goals_against_p90, shots_on_target_against, saves, save_pct,
       wins, draws, losses, clean_sheets, clean_sheet_pct, pens_att_against,
       pens_allowed, pens_saved, pens_missed, pen_save_pct) VALUES ?`, keeper);
  await insertBatch(conn,
    `INSERT INTO stats_playing_time (player_season_id, matches_played, minutes_per_mp,
       minutes_pct, nineties, starts, minutes_per_start, starts_completed, subs,
       minutes_per_sub, unused_sub, points_per_match, team_goals_on,
       team_goals_against_on, plus_minus, plus_minus_per90, on_off) VALUES ?`, playing);
  await insertBatch(conn,
    `INSERT INTO stats_misc (player_season_id, second_yellow, fouls_committed, fouls_drawn,
       offsides, crosses, interceptions, tackles_won, pens_won, own_goals) VALUES ?`, misc);

  console.log(`  stats: ${standard.length.toLocaleString()} standard, ` +
    `${shooting.length.toLocaleString()} shooting, ${keeper.length.toLocaleString()} keeper, ` +
    `${playing.length.toLocaleString()} playing-time, ${misc.length.toLocaleString()} misc`);
  console.log(`  positions: ${psp.length.toLocaleString()} player-season-position links`);

  await conn.end();
  console.log('Import complete.');
}

main().catch((err) => { console.error('\nImport failed:', err.message); process.exit(1); });
