# Database schema

MySQL 8.0 / MariaDB 10.6+, InnoDB, `utf8mb4_unicode_ci`. 22 tables, 6 views,
6 stored routines, 2 triggers.

## Design shape

The database is a small star schema with a 1:1 extension per statistic
category:

```
                    ┌───────────┐   ┌───────────┐   ┌───────────┐
                    │  leagues  │   │  seasons  │   │  nations  │
                    └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
                          │               │               │
                          │               │         ┌─────┴─────┐
     ┌───────────┐        │               │         │  players  │
     │   teams   ├────┐   │               │         └─────┬─────┘
     └───────────┘    │   │               │               │
                      ▼   ▼               ▼               ▼
                 ╔═══════════════════════════════════════════╗
                 ║             player_seasons                ║
                 ║   (player × club × season — 21,100 rows)  ║
                 ╚══╤════╤════╤════╤════╤═══════════════╤════╝
                    │    │    │    │    │               │
      ┌─────────────┘    │    │    │    └──────┐        │
      ▼                  ▼    ▼    ▼           ▼        ▼
┌───────────┐  ┌──────────┐ ┌────────┐ ┌────────────┐ ┌──────────────────────┐
│  stats_   │  │  stats_  │ │ stats_ │ │   stats_   │ │ player_season_       │
│ standard  │  │ shooting │ │ keeper │ │playing_time│ │ positions (1NF)      │
└───────────┘  └──────────┘ └────────┘ └────────────┘ └──────────────────────┘
                                 │
                            ┌────┴─────┐         ┌──────────────────┐
                            │  stats_  │         │ fantasy_points   │
                            │   misc   │         │ (materialised)   │
                            └──────────┘         └────────┬─────────┘
                                                          │
                                              ┌───────────┴──────────┐
                                              │  fantasy_rulesets    │
                                              │  fantasy_scoring_    │
                                              │  rules               │
                                              └──────────────────────┘

  Application side:  users ──┬── shortlists ── shortlist_entries
                             ├── squads ────── squad_players
                             └── saved_searches
```

## Why the statistics are split across five tables

Each of `stats_standard`, `stats_shooting`, `stats_keeper`,
`stats_playing_time` and `stats_misc` mirrors one FBref export and is a
1:1 *optional* extension of `player_seasons`. The primary key **is** the
foreign key, which is what enforces the 1:1 cardinality.

This matters because the categories are genuinely sparse:

| Table | Rows | Populated for |
|---|---|---|
| `stats_playing_time` | 21,100 | every player-season |
| `stats_standard` | 17,149 | players who actually featured |
| `stats_shooting` | 17,149 | same |
| `stats_misc` | 17,149 | same |
| `stats_keeper` | 1,233 | goalkeepers who played |

One wide table would have left ~85% of the keeper columns NULL on every row,
and a goalkeeper query would still scan the shooting columns. Splitting keeps
the fact table narrow and lets each query touch only what it needs.

## Table reference

### Dimensions

| Table | Rows | Notes |
|---|---|---|
| `leagues` | 5 | `fbref_code` keeps the raw `'eng Premier League'` for re-import matching |
| `seasons` | 6 | `start_year` / `end_year` so ordering never depends on string sort |
| `nations` | 138 | `'ar ARG'` split into `flag_code` + `code` |
| `positions` | 4 | GK / DF / MF / FW, stored atomically |
| `teams` | 137 | name only — league lives on the fact row (promotion/relegation) |
| `players` | 8,225 | identity is `(full_name, born_key)`; see below |

`players.born_key` is a stored generated column, `IFNULL(born_year, 0)`. Birth
year is part of the identity but is nullable for 16 players, and a NULL in a
unique key does not collide — the generated column makes the key work for those
rows too.

### Fact

| Table | Rows | Grain |
|---|---|---|
| `player_seasons` | 21,100 | one row per player per club per season |
| `player_season_positions` | 25,391 | resolves the multi-valued `'MF,FW'` into 1NF |

Unique key `(player_id, team_id, season_id)` — a mid-season transfer is two
rows, which is the dataset's real grain.

### Fantasy scoring

| Table | Purpose |
|---|---|
| `fantasy_rulesets` | named rulesets; exactly one `is_active` |
| `fantasy_scoring_rules` | points per unit of a stat, optionally per position |
| `fantasy_points` | materialised scores, refreshed by `sp_recalculate_fantasy_points` |

Scoring is **data, not code**. Re-tuning the game is an `UPDATE` plus a
`CALL sp_recalculate_fantasy_points()`, with no application change. Rules are
resolved most-specific-first: a `goals`/`DF` rule beats a `goals`/any rule.

`fantasy_points` is a real table rather than a view because every leaderboard,
filter and squad projection sorts on it; recomputing the formula per query is
measurably slower. Rebuilding all 21,100 rows takes about three seconds.

### Application tables

`users`, `shortlists`, `shortlist_entries`, `squads`, `squad_players`,
`saved_searches`. These are the read/write half of the app and are never
touched by the ETL, so a re-import does not destroy a scout's work.

## Views

| View | Purpose |
|---|---|
| `v_player_season` | the workhorse: one flat, labelled row per player-club-season, joining all eight tables. Every search and profile query reads this instead of re-assembling the join |
| `v_fantasy_stat_facts` | unpivots scoring-relevant stats into `(stat_key, value)` pairs — this is what makes the scoring formula data-driven |
| `v_team_season` | club-season aggregates |
| `v_league_season` | league-season totals for the dashboard |
| `v_player_career` | career totals across all clubs and seasons |
| `v_player_progression` | season-over-season deltas using `LAG()` window functions, so the API never fetches two seasons and subtracts them in JavaScript |

## Stored routines

| Routine | Purpose |
|---|---|
| `fn_active_ruleset()` | id of the currently active ruleset |
| `sp_recalculate_fantasy_points(ruleset)` | rebuilds `fantasy_points` from the rules |
| `sp_player_trend(player)` | chronological career line for the profile charts |
| `sp_compare_players(left, right)` | both player-seasons in one round trip |
| `sp_leaderboard(season, league, position, min_minutes, limit)` | ranked fantasy table; every parameter is optional (`NULL` = no filter) |
| `sp_squad_projection(squad)` | projected points, captain counted double |
| `sp_team_season_summary(team, season)` | club aggregates for one season |

## Triggers

`trg_squad_players_before_insert` and `trg_squad_players_before_update` enforce
three squad rules in the database, so they hold regardless of which client
writes the row:

1. at most 15 players per squad;
2. at most one captain;
3. every player must come from the squad's own season.

Each raises `SQLSTATE 45000` with a readable message, which the API maps to
HTTP 409 and shows to the user unchanged.

## Indexing

Beyond the primary and foreign keys:

- `player_seasons`: `(season_id, league_id)`, `(team_id, season_id)`,
  `player_id`, `primary_position`, `age_years` — the filter form's main axes.
- `stats_standard`: `goals`, `assists`, `minutes` — the common sort columns.
- `fantasy_points`: `(ruleset_id, total_points DESC)` and
  `(ruleset_id, points_per90 DESC)` — the leaderboard's two orderings.
