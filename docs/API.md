# REST API reference

Base URL: `http://localhost:4000/api`

All responses are JSON. Errors return `{ "error": "message" }` with an
appropriate status: `400` invalid input, `404` not found, `409` conflict
(including database rule violations), `500` unexpected.

## Reference data

### `GET /meta`
Everything the filter form needs: seasons, leagues, positions, nations,
rulesets, row counts, plus the **filter grammar** — the whitelist of filterable
fields with their allowed operators. The React client builds its form from this
rather than keeping a second copy of the whitelist.

### `GET /meta/teams?season_id=&league_id=`
Clubs, optionally narrowed to one season or competition.

## Search

### `POST /players/search`
The structured form used by the filter builder.

```json
{
  "filters": [
    { "field": "position_code", "op": "eq",  "value": "MF" },
    { "field": "age_years",     "op": "lte", "value": 21 },
    { "field": "minutes",       "op": "gte", "value": 1800 },
    { "field": "league_id",     "op": "in",  "value": [1, 3] }
  ],
  "sort": "goals_assists",
  "dir": "desc",
  "page": 1,
  "pageSize": 25
}
```

Operators: `eq`, `gte`, `lte`, `between` (`value` is `[min, max]`), `in`
(`value` is an array, max 50), `like`.

Returns `{ rows, pagination: { page, pageSize, total, totalPages } }`.

**Field and operator names are validated against a server-side whitelist.** An
unknown field or a disallowed operator returns `400` rather than being ignored,
so a typo surfaces immediately instead of silently returning unfiltered data.
User-supplied values only ever travel as `?` placeholders.

### `GET /players/search?goals_gte=10&league_id=1&sort=goals`
Query-string shorthand for the same thing. Any `field_op` pair works
(`goals_gte`, `age_years_lte`, `player_name_like`); a bare `field` means `eq`.

### `GET /players/suggest?q=<name>`
Typeahead over career totals. Needs at least 2 characters, returns up to 15.

## Players

| Route | Returns |
|---|---|
| `GET /players/:playerId` | `{ career, trend, progression }` — career totals, the season-by-season line from `sp_player_trend`, and `LAG()`-based deltas |
| `GET /players/season/:playerSeasonId` | one fully expanded player-season including its fantasy points breakdown |

## Analytics

| Route | Returns |
|---|---|
| `GET /compare?left=<psId>&right=<psId>` | `{ left, right }` from `sp_compare_players` |
| `GET /leaderboard?season_id=&league_id=&position=&min_minutes=&limit=` | ranked fantasy table from `sp_leaderboard`; every filter optional |
| `GET /leagues?season_id=` | league-season aggregates |
| `GET /teams?season_id=&league_id=` | club-season aggregates |
| `GET /teams/:teamId/seasons/:seasonId` | `{ summary, squad }` for one club in one season |
| `GET /rulesets` | every scoring rule of every ruleset |
| `POST /rulesets/:id/activate` | switches the active ruleset and re-scores all 21,100 player-seasons in MySQL |

## Shortlists

| Route | Purpose |
|---|---|
| `GET /shortlists` | all lists with player counts |
| `POST /shortlists` | `{ name, notes? }` → 201 |
| `GET /shortlists/:id` | the list plus its entries, joined to current stats |
| `DELETE /shortlists/:id` | 204 |
| `POST /shortlists/:id/entries` | `{ player_season_id, rating?, note?, status? }`; re-posting updates the existing entry |
| `PATCH /shortlists/:id/entries/:playerSeasonId` | Update `rating`, `note` and/or `status` on an existing entry |
| `POST /shortlists/:id/entries/:playerSeasonId/move` | `{ target_shortlist_id }` — move a player to another list, keeping the assessment |
| `DELETE /shortlists/:id/entries/:playerSeasonId` | 204 |

`GET /shortlists/:id` also accepts `?sort=` (`added_at`, `rating`, `status`,
`player_name`, `age_years`, `minutes`, `goals`, `assists`, `total_points`),
`?dir=asc|desc` and `?status=` to filter by pipeline stage. It returns
`{ ...shortlist, entries, summary, byPosition }` where `summary` and
`byPosition` are aggregated in SQL.

`status` is one of `watching`, `shortlisted`, `priority`, `rejected`.

`rating` must be 1–5; the database enforces this with a `CHECK` constraint and
the API validates it up front.

## Squads

| Route | Purpose |
|---|---|
| `GET /squads` | all squads with projected points |
| `POST /squads` | `{ name, season_id, formation? }` → 201 |
| `GET /squads/:id` | squad, players and `sp_squad_projection` output |
| `DELETE /squads/:id` | 204 |
| `POST /squads/:id/players` | `{ player_season_id, slot, is_captain? }`; slot is `GK`/`DEF`/`MID`/`FWD`/`BENCH` |
| `DELETE /squads/:id/players/:playerSeasonId` | 204 |
| `GET /squads/:id/strength` | Attack and defence indices for one squad |
| `GET /squads/compare?a=&b=` | Head to head: `{ comparison, grid, lineups }` — ratings, expected goals, win/draw/loss percentages, the 6x6 scoreline grid and both XIs |

`/squads/compare` is declared before `/squads/:id` in the router: Express matches
routes in order, so a literal path registered after a parameterised one would
never be reached.

Adding a player can fail with `409` and one of these messages, raised by
database triggers rather than application code:

- `Squad is full: a squad may contain at most 15 players.`
- `Squad already has a captain.`
- `Player-season does not belong to this squad's season.`

## Saved searches

`GET /searches`, `POST /searches` (`{ name, criteria }`, criteria stored as
JSON), `DELETE /searches/:id`.

## Health

### `GET /api/health`
`{ status, database, player_seasons }`. Returns `503` when MySQL is
unreachable, so it tells you whether the API is up *and* whether the database
behind it is.

## Above-average performers

Public. Compares each player with their peer group: the same position, in the
same league, in the same season.

### `GET /peers/stats`
The stats that can be compared: `[{ key, label, group, lower_is_better }]`.
The `key` is what `/peers/above-average` accepts as `stat`.

### `GET /peers/above-average`

| Parameter | Required | Meaning |
|---|---|---|
| `stat` | yes | a key from `/peers/stats`, e.g. `goals_per90`, `save_pct` |
| `position` | yes | `GK`, `DF`, `MF` or `FW` |
| `season_id` | no | one season; omit for all |
| `league_id` | no | one league; omit for all |
| `min_minutes` | no | minutes floor for the player *and* their peers (default 900) |

```json
{
  "stat": { "key": "goals_per90", "label": "Goals per 90", "lower_is_better": false },
  "position": "FW", "min_minutes": 900, "count": 112, "truncated": false,
  "rows": [{
    "player_season_id": 17077, "player_id": 6649, "player_name": "Robert Lewandowski",
    "team_name": "Bayern Munich", "league_name": "Bundesliga", "season_label": "2020-2021",
    "minutes": 2458, "value": 1.5, "peer_avg": 0.418, "peer_count": 39,
    "margin": 1.082, "pct_above": 258.7
  }]
}
```

One SQL statement: `player_seasons` JOINed to `players`, `teams`, `leagues`,
`seasons`, `positions` and the stats table, with the peer average as a
correlated subquery (`WHERE ps2.season_id = ps.season_id AND ps2.league_id =
ps.league_id AND ps2.primary_position = ps.primary_position`) and
`HAVING value > peer_avg` (`<` for lower-is-better stats such as goals
conceded). The stat name picks a column from a whitelist, since a column name
cannot be a `?` placeholder; every value is a bound parameter. At most 500
rows; `truncated` says whether there were more. `400` for an unknown stat or
position.

## Admin

Everything under `/api/admin` except `login`, `logout` and `session` needs the
admin session cookie. Without it, or with an expired, forged or tampered
token, the response is `401`. If `JWT_SECRET` is not set on the server, admin
routes answer `503` with a message saying so, and the rest of the app keeps
working.

### `POST /admin/login`
`{ email, password }` → `{ email, expires_at }` and a `scoutlens_admin`
cookie (`HttpOnly`, `SameSite=Strict`, `Path=/api/admin`, `Secure` in
production). The token is a JWT signed with HS256 using `JWT_SECRET`, valid
for `JWT_EXPIRES_IN` (default `2h`). A wrong email and a wrong password get
the same `401 Invalid email or password.` and take the same time. After
`ADMIN_LOGIN_MAX_ATTEMPTS` failures (default 5) in 15 minutes, `429`.

### `POST /admin/logout`
Clears the cookie. `204`.

### `GET /admin/session`
`{ authenticated, configured, email?, expires_at? }`. Never `401`, so the
frontend can ask "am I signed in?" without an error.

### `GET /admin/players/:id`
The player's identity plus every season with its ids and standard stats — the
data the edit form needs.

### `POST /admin/players`
Adds a player together with their first season (the schema's grain is
player x club x season):

```json
{
  "full_name": "New Player", "born_year": 2002, "nation_id": 12,
  "season": {
    "season_id": 6, "league_id": 3, "team_id": 41, "position_code": "FW",
    "stats": { "matches_played": 20, "starts": 15, "minutes": 1500, "goals": 9, "assists": 4 }
  }
}
```

`201` → `{ player_id, player_season_id, full_name }`. Age is derived from the
birth year unless `season.age_years` is sent. Per-90 figures and
goals + assists are derived from the counts. Runs in one transaction and
re-scores the new row's fantasy points.

### `PUT /admin/players/:id`
Any of `full_name`, `born_year`, `nation_id`.

### `PUT /admin/player-seasons/:id`
Any of `team_id`, `league_id`, `position_code`, `age_years` and `stats` (only
the fields sent are changed). The season itself cannot be changed. Returns
`{ player_season_id, total_points }` after re-scoring.

Impossible numbers are refused with `400`: more starts than matches, more
minutes than matches x 130, more penalties than goals. A duplicate player
(same name and birth year) or a second row for the same player, club
and season is `409`.

### `DELETE /admin/players/:id`
Hard delete. One `DELETE FROM players`; the foreign keys cascade to
`player_seasons` and from there to every stats table, `fantasy_points`,
`player_season_positions`, `shortlist_entries` and `squad_players`.

```json
{ "deleted": "New Player", "player_id": 9001,
  "cascaded": { "seasons": 1, "stat_rows": 1, "shortlist_entries": 0, "squad_slots": 0 } }
```

## Scouting data ownership

Shortlists, squads and saved searches belong to a single seeded scout
(`users.user_id = 1`) and are public, as before. The admin login protects
only the player-editing routes above.
