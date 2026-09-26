// ---------------------------------------------------------------------
// End-to-end API check.
//
//   node scripts/smoke-test.mjs            (expects the API on :4000)
//   BASE=http://host:4000 node scripts/smoke-test.mjs
//
// Exercises every route group, including the database rules that are
// supposed to reject bad writes. Exits non-zero if any check fails.
//
// Admin checks that need a real login (create / update / delete a player)
// run only when credentials are supplied:
//   SMOKE_ADMIN_EMAIL=you@example.com SMOKE_ADMIN_PASSWORD=... node scripts/smoke-test.mjs
// Without them the script still proves the admin routes are locked.
// ---------------------------------------------------------------------

const BASE = process.env.BASE || 'http://127.0.0.1:4000';

let passed = 0;
const failures = [];

async function call(method, path, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { status: res.status, body: json, raw: text, setCookie: res.headers.getSetCookie() };
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

await check('a squad can be auto-filled in one call', async () => {
  const created = await call('POST', '/api/squads', {
    name: `Smoke Auto ${stamp}`, season_id: seasonId, formation: '4-3-3',
  });
  const id = created.body.squad_id;
  const { status, body } = await call('POST', `/api/squads/${id}/autofill`, {});
  assert(status === 200, `status ${status}`);
  assert(body.added === 11, `added ${body.added}, expected 11`);

  const squad = await call('GET', `/api/squads/${id}`);
  const slots = squad.body.players.map((p) => p.slot);
  assert(slots.filter((s) => s === 'GK').length === 1, 'not exactly one keeper');
  assert(slots.filter((s) => s === 'DEF').length === 4, 'not four defenders for a 4-3-3');
  assert(slots.filter((s) => s === 'FWD').length === 3, 'not three forwards for a 4-3-3');
  await call('DELETE', `/api/squads/${id}`);
});

await check('suggestions exclude players already in the squad', async () => {
  const before = await call('GET', `/api/squads/${squadId}/suggestions`);
  const inSquad = new Set(
    (await call('GET', `/api/squads/${squadId}`)).body.players.map((p) => p.player_season_id));
  assert(before.body.every((r) => !inSquad.has(r.player_season_id)),
    'a player already in the squad was suggested');
});

// ---- above-average performers (public) ------------------------------

await check('peer stats list is published', async () => {
  const { status, body } = await call('GET', '/api/peers/stats');
  assert(status === 200, `status ${status}`);
  assert(body.some((s) => s.key === 'goals_per90'), 'goals_per90 missing');
  assert(body.some((s) => s.lower_is_better), 'no lower-is-better stat');
});

await check('every above-average row beats its peer average', async () => {
  const { status, body } = await call('GET',
    `/api/peers/above-average?stat=goals_per90&position=FW&season_id=${seasonId}`);
  assert(status === 200, `status ${status}`);
  assert(body.rows.length > 0, 'no rows');
  assert(body.rows.every((r) => r.position_code === 'FW'), 'non-forward in results');
  // The SQL compares unrounded values; the API rounds to 3 dp, so a player
  // who wins by a hair can show as a tie - but never as behind.
  assert(body.rows.every((r) => r.value >= r.peer_avg), 'a row does not beat its peer average');
  assert(body.rows.every((r) => r.minutes >= 900), 'default 900-minute floor not applied');
});

await check('lower-is-better stats list players below the average', async () => {
  const { body } = await call('GET',
    `/api/peers/above-average?stat=goals_against_p90&position=GK&season_id=${seasonId}`);
  assert(body.stat.lower_is_better, 'stat not flagged lower-is-better');
  assert(body.rows.length > 0, 'no keepers');
  assert(body.rows.every((r) => r.value <= r.peer_avg), 'a keeper concedes more than the peers');
});

await check('above-average rejects an unknown stat or position', async () => {
  const a = await call('GET', '/api/peers/above-average?stat=goals;DROP TABLE players&position=FW');
  const b = await call('GET', '/api/peers/above-average?stat=goals&position=XX');
  assert(a.status === 400 && b.status === 400, `statuses ${a.status}/${b.status}`);
});

// ---- admin: locked without a login ------------------------------------

await check('admin session probe reports signed out', async () => {
  const { status, body } = await call('GET', '/api/admin/session');
  assert(status === 200, `status ${status}`);
  assert(body.authenticated === false, 'reports signed in without a cookie');
});

await check('admin writes are refused without a login', async () => {
  const create = await call('POST', '/api/admin/players', { full_name: 'Nobody' });
  const remove = await call('DELETE', '/api/admin/players/1');
  const update = await call('PUT', '/api/admin/players/1', { full_name: 'Nobody' });
  for (const r of [create, remove, update]) {
    assert(r.status === 401 || r.status === 503, `status ${r.status}`);
  }
});

await check('a forged admin cookie is refused', async () => {
  const forged = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOjEsImVtYWlsIjoieEB5LnoifQ.';
  const { status } = await call('DELETE', '/api/admin/players/1', null, `scoutlens_admin=${forged}`);
  assert(status === 401 || status === 503, `status ${status}`);
});

await check('a wrong admin password is refused', async () => {
  const { status, body } = await call('POST', '/api/admin/login',
    { email: 'nobody@example.com', password: 'definitely-not-it' });
  assert(status === 401 || status === 503, `status ${status}`);
  assert(body.error, 'no error message');
});

// ---- admin: full CRUD with real credentials (optional) ----------------

const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;

if (!adminEmail || !adminPassword) {
  console.log('  skip  admin create/update/delete (set SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD)');
} else {
  let cookie, newPlayerId, newPsId;

  await check('admin can sign in and gets an httpOnly cookie', async () => {
    const { status, setCookie } = await call('POST', '/api/admin/login',
      { email: adminEmail, password: adminPassword });
    assert(status === 200, `status ${status}`);
    const raw = setCookie.find((c) => c.startsWith('scoutlens_admin='));
    assert(raw, 'no session cookie');
    assert(/HttpOnly/i.test(raw) && /SameSite=Strict/i.test(raw), `weak cookie: ${raw}`);
    cookie = raw.split(';')[0];
  });

  await check('admin can add a player with a first season', async () => {
    const meta = await call('GET', '/api/meta');
    const league = meta.body.leagues[0];
    const teams = await call('GET', `/api/meta/teams?season_id=${seasonId}&league_id=${league.league_id}`);
    const { status, body } = await call('POST', '/api/admin/players', {
      full_name: `Smoke Admin Player ${stamp}`,
      born_year: 2000,
      season: {
        season_id: seasonId, league_id: league.league_id, team_id: teams.body[0].team_id,
        position_code: 'FW',
        stats: { matches_played: 10, starts: 8, minutes: 800, goals: 5, assists: 2 },
      },
    }, cookie);
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    newPlayerId = body.player_id;
    newPsId = body.player_season_id;
  });

  await check('admin rejects impossible stats', async () => {
    const { status } = await call('PUT', `/api/admin/player-seasons/${newPsId}`,
      { stats: { starts: 99 } }, cookie);
    assert(status === 400, `status ${status}`);
  });

  await check('admin update rescores fantasy points', async () => {
    const before = await call('GET', `/api/admin/players/${newPlayerId}`, null, cookie);
    assert(before.status === 200, `status ${before.status}`);
    const { status, body } = await call('PUT', `/api/admin/player-seasons/${newPsId}`,
      { stats: { goals: 9 } }, cookie);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.total_points > 0, 'no points after update');
    const rename = await call('PUT', `/api/admin/players/${newPlayerId}`,
      { full_name: `Smoke Admin Renamed ${stamp}` }, cookie);
    assert(rename.status === 200, `rename status ${rename.status}`);
  });

  await check('admin delete cascades through every child table', async () => {
    await call('POST', `/api/shortlists/${shortlistId}/entries`, { player_season_id: newPsId });
    const { status, body } = await call('DELETE', `/api/admin/players/${newPlayerId}`, null, cookie);
    assert(status === 200, `status ${status}`);
    assert(body.cascaded.seasons === 1 && body.cascaded.stat_rows === 1,
      `unexpected cascade ${JSON.stringify(body.cascaded)}`);
    const gone = await call('GET', `/api/players/${newPlayerId}`);
    assert(gone.status === 404, `player still reachable: ${gone.status}`);
  });

  await check('admin sign-out clears the cookie', async () => {
    const out = await call('POST', '/api/admin/logout', null, cookie);
    assert(out.status === 204, `status ${out.status}`);
    const cleared = out.setCookie.find((c) => c.startsWith('scoutlens_admin='));
    assert(cleared && /Expires=Thu, 01 Jan 1970/i.test(cleared), 'cookie not cleared');
  });
}

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
