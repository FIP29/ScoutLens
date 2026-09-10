# Dataset & ETL notes

## Source

The statistics come from the
[FOOTBALL_FANTASY_ML](https://github.com/adiburrahman2004/FOOTBALL_FANTASY_ML)
dataset, which was scraped from [FBref](https://fbref.com/) and covers the
"Big 5" European leagues.

ScoutLens loads a single file from that repository:

| File | Rows | Columns |
|---|---|---|
| `Datasets (Scrapped from Fbref)/Ready-to-work-and-sorted-20-26.csv` | 21,100 | 85 |

It is vendored here as `data/player_stats_2020_2026.csv` so the database can be
rebuilt without cloning the upstream repository. That file is the union of five
FBref per-category exports (Standard, Shooting, Keeper, Playing Time, Misc)
joined side by side and stamped with a `season` column.

**Coverage:** Premier League, La Liga, Serie A, Bundesliga, Ligue 1 —
seasons 2020-21 through 2025-26.

The 2025-26 season is a partial, in-progress scrape, so its totals are lower
than a completed season. This is a property of the source data, not a loading
bug; treat cross-season comparisons involving 2025-26 with that in mind.

## From 85 wide columns to 22 tables

The CSV is one very wide, denormalised table. `etl/import.js` decomposes it:

| CSV columns | Becomes |
|---|---|
| `Comp` | `leagues` (5 rows) |
| `season` | `seasons` (6 rows) |
| `Nation` | `nations` (138 rows) |
| `Squad` | `teams` (137 rows) |
| `Player`, `Born` | `players` (8,225 rows) |
| identity + club + season | `player_seasons` (21,100 rows) |
| `Pos` (multi-valued) | `player_season_positions` (25,391 rows) |
| `Playing Time_*`, `Performance_*`, `Per 90 Minutes_*` | `stats_standard` (17,149) |
| `Standard_*` | `stats_shooting` (17,149) |
| `Performance_GA/Saves/CS/...`, `Penalty Kicks_*` | `stats_keeper` (1,233) |
| `Starts_*`, `Subs_*`, `Team Success_*` | `stats_playing_time` (21,100) |
| `Performance_Fls/Int/TklW/OG/...` | `stats_misc` (17,149) |

All 21,100 CSV rows load; none are skipped.

## Data quality issues found, and how each is handled

These were discovered by profiling the CSV before designing the schema. Each
one is handled in the ETL rather than left for the application to trip over.

### 1. 3,951 rows look empty but are not

Nearly a fifth of the rows have a blank `Comp`, `Nation` and `Pos`. They are
not junk: they are fringe squad members — unused substitutes and 0-minute
players — who appear in FBref's *Playing Time* export but never reached the
*Standard* export. Their competition, nation and position are present in the
`Comp_playing_time` / `Nation_playing_time` / `Pos_playing_time` columns.

The importer coalesces across the three variants:

```
league   = Comp   ?? Comp_playing_time   ?? Comp_keeper
nation   = Nation ?? Nation_playing_time ?? Nation_keeper
position = Pos    ?? Pos_playing_time    ?? Pos_keeper
```

This recovers a league for **100%** of rows. After coalescing only 32 rows lack
a nation, 16 lack a birth year and 5 lack a position.

Dropping these rows instead would have silently deleted every squad player who
did not get on the pitch — exactly the players a "who is not getting minutes"
scouting query is looking for.

### 2. Player names are not unique

49 names in this dataset belong to two different people. The clearest case is
two players called *Alberto López* at Sevilla in the same 2024-25 season: a
goalkeeper born in 2003 and a midfielder born in 2005.

Player identity is therefore `(full_name, born_year)`, not name alone.

### 3. Accented names are spelled inconsistently

The scrape contains both `Álvaro Cortés` and `Alvaro Cortes` for one Barcelona
player born in 2005, in consecutive seasons. MySQL's `utf8mb4_unicode_ci`
collation treats those two strings as equal, so a naive load fails on the
unique key.

`etl/parse.js` folds names the same way the collation does (NFD-normalise,
strip combining marks, lower-case) when building the identity key, then keeps
the spelling that carries the diacritics for display. The two spellings resolve
to one player with a complete career rather than two half-populated ones.

### 4. Age is stored in two different formats

FBref writes age either as `21-023` (21 years, 23 days) or as `19.0`. Both are
parsed into `age_years` and a nullable `age_days`, so age can be filtered
numerically.

### 5. A player can have two rows in one season

A mid-season transfer produces one row per club. That is the real grain of the
data, so the fact table's unique key is `(player_id, team_id, season_id)` and
the schema does not try to collapse a split season into one row.

### 6. Clubs change competition between seasons

Promotion and relegation mean a club is not permanently tied to one league.
`teams` therefore stores only the club name; the competition is recorded per
player-season on `player_seasons.league_id`.

## Known limitation: clean sheets

FBref publishes clean-sheet counts only in the goalkeeper export. The
`clean_sheets` column is therefore populated for goalkeepers and `NULL` for
outfielders.

The `Classic` fantasy ruleset defines defender and midfielder clean-sheet rules
for completeness, but they score zero until team-level match results are added
to the database. Defender fantasy scores are correspondingly lower than they
would be in a real fantasy game.

## Re-running the import

The importer truncates the statistics tables before loading, so it is safe to
re-run against a fresher scrape:

```bash
CSV_PATH=/path/to/new-scrape.csv npm run db:import
node etl/run-sql.js db/logic     # re-apply views/procs and re-score
```

User data (`users`, `shortlists`, `squads`, `saved_searches`) is never touched
by the import.
