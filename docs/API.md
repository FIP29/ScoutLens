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
| `POST /shortlists/:id/entries` | `{ player_season_id, rating?, note? }`; re-posting updates the existing entry |
| `DELETE /shortlists/:id/entries/:playerSeasonId` | 204 |

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

## Authentication

There is none. The app runs as a single seeded scout (`users.user_id = 1`)
rather than shipping half an auth system. All writes are scoped to that user;
adding real accounts means replacing the `DEMO_USER` constant in
`server/src/routes/scouting.js` with a session lookup.
