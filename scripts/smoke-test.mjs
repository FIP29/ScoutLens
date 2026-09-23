// ---------------------------------------------------------------------
// End-to-end API check.
//
//   node scripts/smoke-test.mjs            (expects the API on :4000)
//   BASE=http://host:4000 node scripts/smoke-test.mjs
//
// Exercises every route group, including the database rules that are
// supposed to reject bad writes. Exits non-zero on the first failure.
// ---------------------------------------------------------------------

const BASE = process.env.BASE || 'http://127.0.0.1:4000';

let passed = 0;
const failures = [];

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { status: res.status, body: json, raw: text };
}

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.log(`  FAIL  ${name} — ${err.message}`);
  }
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

console.log(`ScoutLens API smoke test → ${BASE}\n`);

await check('health reports a connected database', async () => {
  const { status, body } = await call('GET', '/api/health');
  assert(status === 200, `status ${status}`);
  assert(body.database === 'connected', 'database not connected');
  assert(body.player_seasons > 20000, `only ${body.player_seasons} player-seasons`);
});

await check('meta returns every dimension', async () => {
  const { body } = await call('GET', '/api/meta');
  assert(body.seasons.length === 6, `${body.seasons.length} seasons`);
  assert(body.leagues.length === 5, `${body.leagues.length} leagues`);
  assert(body.positions.length === 4, `${body.positions.length} positions`);
  assert(Object.keys(body.filterFields).length > 15, 'filter grammar missing');
});

await check('GET search with query shorthand', async () => {
  const { body } = await call('GET', '/api/players/search?goals_gte=20&pageSize=5');
  assert(body.rows.length === 5, `${body.rows.length} rows`);
  assert(body.rows.every((r) => r.goals >= 20), 'filter not applied');
});

await check('POST search with structured filters', async () => {
  const { body } = await call('POST', '/api/players/search', {
    filters: [
      { field: 'position_code', op: 'eq', value: 'GK' },
      { field: 'minutes', op: 'gte', value: 2000 },
    ],
    sort: 'saves',
    pageSize: 5,
  });
  assert(body.rows.length > 0, 'no goalkeepers found');
  assert(body.rows.every((r) => r.position_code === 'GK'), 'non-keeper in results');
});

await check('search rejects an unknown filter field', async () => {
  const { status } = await call('POST', '/api/players/search', {
    filters: [{ field: 'goals; DROP TABLE players', op: 'eq', value: 1 }],
  });
  assert(status === 400, `expected 400, got ${status}`);
});

await check('search rejects a disallowed operator', async () => {
  const { status } = await call('POST', '/api/players/search', {
    filters: [{ field: 'goals', op: 'like', value: 'x' }],
  });
  assert(status === 400, `expected 400, got ${status}`);
});

let playerId;
await check('suggest finds a known player', async () => {
  const { body } = await call('GET', '/api/players/suggest?q=Haaland');
  assert(body.length > 0, 'no suggestions');
  playerId = body[0].player_id;
});

await check('player profile returns career and trend', async () => {
  const { body } = await call('GET', `/api/players/${playerId}`);
  assert(body.career.player_name, 'no career row');
  assert(body.trend.length > 0, 'no trend rows');
});

await check('unknown player id returns 404', async () => {
  const { status } = await call('GET', '/api/players/99999999');
  assert(status === 404, `expected 404, got ${status}`);
});

let leftId, rightId;
await check('leaderboard returns ranked rows', async () => {
  const { body } = await call('GET', '/api/leaderboard?min_minutes=1500&limit=10');
  assert(body.length === 10, `${body.length} rows`);
  for (let i = 1; i < body.length; i++) {
    assert(body[i - 1].total_points >= body[i].total_points, 'not sorted by points');
  }
  leftId = body[0].player_season_id;
  rightId = body[1].player_season_id;
});

await check('compare returns both sides', async () => {
  const { body } = await call('GET', `/api/compare?left=${leftId}&right=${rightId}`);
  assert(body.left?.player_season_id === leftId, 'left side missing');
  assert(body.right?.player_season_id === rightId, 'right side missing');
});

await check('league dashboard aggregates', async () => {
  const { body } = await call('GET', '/api/leagues');
  assert(body.length === 30, `${body.length} league-seasons (expected 5 x 6)`);
  assert(body.every((r) => r.goals > 0), 'a league-season has no goals');
});

// ---- write path -------------------------------------------------------

const stamp = Date.now();
let shortlistId, squadId, seasonId, psId;

await check('create a shortlist', async () => {
  const { status, body } = await call('POST', '/api/shortlists', { name: `Smoke ${stamp}` });
  assert(status === 201, `status ${status}`);
  shortlistId = body.shortlist_id;
});

await check('add a player to the shortlist', async () => {
  const { status } = await call('POST', `/api/shortlists/${shortlistId}/entries`, {
    player_season_id: leftId, rating: 4, note: 'smoke test',
  });
  assert(status === 201, `status ${status}`);
});

await check('shortlist reads back with the entry', async () => {
  const { body } = await call('GET', `/api/shortlists/${shortlistId}`);
  assert(body.entries.length === 1, `${body.entries.length} entries`);
  assert(body.entries[0].rating === 4, 'rating not stored');
});

await check('reject an out-of-range rating', async () => {
  const { status } = await call('POST', `/api/shortlists/${shortlistId}/entries`, {
    player_season_id: leftId, rating: 9,
  });
  assert(status === 400, `expected 400, got ${status}`);
});

await check('create a squad', async () => {
  const meta = await call('GET', '/api/meta');
  seasonId = meta.body.seasons[0].season_id;
  const { status, body } = await call('POST', '/api/squads', {
    name: `Smoke XI ${stamp}`, season_id: seasonId, formation: '4-3-3',
  });
  assert(status === 201, `status ${status}`);
  squadId = body.squad_id;
});

await check('add a captain to the squad', async () => {
  const search = await call('POST', '/api/players/search', {
    filters: [{ field: 'season_id', op: 'eq', value: seasonId }],
    sort: 'total_points', pageSize: 20,
  });
  psId = search.body.rows[0].player_season_id;
  const { status } = await call('POST', `/api/squads/${squadId}/players`, {
    player_season_id: psId, slot: 'MID', is_captain: true,
  });
  assert(status === 201, `status ${status}`);
});

await check('trigger blocks a second captain', async () => {
  const search = await call('POST', '/api/players/search', {
    filters: [{ field: 'season_id', op: 'eq', value: seasonId }],
    sort: 'total_points', pageSize: 20,
  });
  const other = search.body.rows.find((r) => r.player_season_id !== psId);
  const { status, body } = await call('POST', `/api/squads/${squadId}/players`, {
    player_season_id: other.player_season_id, slot: 'FWD', is_captain: true,
  });
  assert(status === 409, `expected 409, got ${status}`);
  assert(/captain/i.test(body.error), `unexpected message: ${body.error}`);
});

await check('trigger blocks a player from another season', async () => {
  const meta = await call('GET', '/api/meta');
  const otherSeason = meta.body.seasons.find((s) => s.season_id !== seasonId);
  const search = await call('POST', '/api/players/search', {
    filters: [{ field: 'season_id', op: 'eq', value: otherSeason.season_id }],
    pageSize: 1,
  });
  const { status, body } = await call('POST', `/api/squads/${squadId}/players`, {
    player_season_id: search.body.rows[0].player_season_id, slot: 'DEF',
  });
  assert(status === 409, `expected 409, got ${status}`);
  assert(/season/i.test(body.error), `unexpected message: ${body.error}`);
});

await check('squad projection doubles the captain', async () => {
  const { body } = await call('GET', `/api/squads/${squadId}`);
  const captain = body.players.find((p) => p.is_captain);
  assert(captain, 'no captain in squad');
  assert(
    Math.abs(body.projection.starting_points - captain.total_points * 2) < 0.01,
    `expected ${captain.total_points * 2}, got ${body.projection.starting_points}`);
});

await check('duplicate shortlist name is rejected', async () => {
  const { status } = await call('POST', '/api/shortlists', { name: `Smoke ${stamp}` });
  assert(status === 409, `expected 409, got ${status}`);
});

// ---- quick search, shortlist pipeline, squad comparison ---------------

await check('search by country, league and position together', async () => {
  const { body } = await call('POST', '/api/players/search', {
    filters: [
      { field: 'nation_code', op: 'eq', value: 'BRA' },
      { field: 'position_code', op: 'eq', value: 'FW' },
      { field: 'minutes', op: 'gte', value: 900 },
    ],
    pageSize: 10,
  });
  assert(body.rows.length > 0, 'no Brazilian forwards found');
  assert(body.rows.every((r) => r.nation_code === 'BRA'), 'a non-Brazilian slipped through');
  assert(body.rows.every((r) => r.position_code === 'FW'), 'a non-forward slipped through');
});

await check('shortlist entry carries a pipeline status', async () => {
  const { status, body } = await call('POST', `/api/shortlists/${shortlistId}/entries`, {
    player_season_id: rightId, status: 'shortlisted',
  });
  assert(status === 201, `status ${status}`);
  assert(body.status === 'shortlisted', `got status ${body.status}`);
});

await check('an entry can be promoted with PATCH', async () => {
  const { status } = await call('PATCH', `/api/shortlists/${shortlistId}/entries/${rightId}`, {
    status: 'priority', rating: 5, note: 'smoke',
  });
  assert(status === 200, `status ${status}`);
  const { body } = await call('GET', `/api/shortlists/${shortlistId}`);
  const entry = body.entries.find((e) => e.player_season_id === rightId);
  assert(entry.status === 'priority', `status is ${entry.status}`);
  assert(entry.rating === 5, `rating is ${entry.rating}`);
});

await check('an invalid status is rejected', async () => {
  const { status } = await call('PATCH', `/api/shortlists/${shortlistId}/entries/${rightId}`, {
    status: 'definitely-not-valid',
  });
  assert(status === 400, `expected 400, got ${status}`);
});

await check('shortlist summary aggregates in SQL', async () => {
  const { body } = await call('GET', `/api/shortlists/${shortlistId}`);
  assert(body.summary, 'no summary returned');
  assert(body.summary.total === body.entries.length,
    `summary total ${body.summary.total} != ${body.entries.length} entries`);
  assert(Array.isArray(body.byPosition), 'no position breakdown');
});

await check('shortlist entries can be sorted', async () => {
  const { body } = await call('GET', `/api/shortlists/${shortlistId}?sort=player_name&dir=asc`);
  const names = body.entries.map((e) => e.player_name);
  const sorted = [...names].sort((x, y) => x.localeCompare(y));
  assert(JSON.stringify(names) === JSON.stringify(sorted), 'entries not sorted by name');
});

let squadB;
await check('a second squad can be built for comparison', async () => {
  const created = await call('POST', '/api/squads', {
    name: `Smoke XI B ${stamp}`, season_id: seasonId, formation: '4-4-2',
  });
  assert(created.status === 201, `status ${created.status}`);
  squadB = created.body.squad_id;

  const search = await call('POST', '/api/players/search', {
    filters: [{ field: 'season_id', op: 'eq', value: seasonId }],
    sort: 'total_points', dir: 'asc', pageSize: 5,
  });
  for (const row of search.body.rows.slice(0, 3)) {
    await call('POST', `/api/squads/${squadB}/players`, {
      player_season_id: row.player_season_id, slot: 'MID',
    });
  }
});

await check('squad strength is rated', async () => {
  const { body } = await call('GET', `/api/squads/${squadId}/strength`);
  assert(body.attack_index > 0, 'no attack index');
  assert(body.defence_index > 0, 'no defence index');
});

await check('head-to-head probabilities sum to 100', async () => {
  const { body } = await call('GET', `/api/squads/compare?a=${squadId}&b=${squadB}`);
  const c = body.comparison;
  const total = c.pct_a_win + c.pct_draw + c.pct_b_win;
  assert(Math.abs(total - 100) < 0.2, `probabilities sum to ${total}, not 100`);
  assert(c.expected_goals_a > 0 && c.expected_goals_b > 0, 'expected goals missing');
  assert(body.grid.length === 36, `grid has ${body.grid.length} cells, expected 36`);
  assert(body.lineups.a.length > 0 && body.lineups.b.length > 0, 'lineups missing');
});

await check('comparing a squad with itself is symmetric', async () => {
  const { body } = await call('GET', `/api/squads/compare?a=${squadId}&b=${squadId}`);
  const c = body.comparison;
  assert(Math.abs(c.pct_a_win - c.pct_b_win) < 0.01,
    `self-comparison is lopsided: ${c.pct_a_win} vs ${c.pct_b_win}`);
  assert(Math.abs(c.expected_goals_a - c.expected_goals_b) < 0.01,
    'self-comparison has unequal expected goals');
});

// ---- cleanup ----------------------------------------------------------

await check('clean up the smoke-test rows', async () => {
  const a = await call('DELETE', `/api/squads/${squadId}`);
  const b = await call('DELETE', `/api/shortlists/${shortlistId}`);
  if (squadB) await call('DELETE', `/api/squads/${squadB}`);
  assert(a.status === 204 && b.status === 204, `statuses ${a.status}/${b.status}`);
});

await check('unknown route returns 404 JSON', async () => {
  const { status, body } = await call('GET', '/api/nope');
  assert(status === 404, `status ${status}`);
  assert(body.error, 'no error message');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('\nFailures:');
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
