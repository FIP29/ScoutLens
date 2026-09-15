// ---------------------------------------------------------------------
// Translates the scouting form's filter selections into a parameterised
// SQL WHERE clause.
//
// Nothing the client sends is ever interpolated into SQL. Field names are
// looked up in the whitelist below and only the resolved column name is
// concatenated; every user-supplied *value* travels as a `?` placeholder.
// An unknown field or operator is rejected with 400 rather than ignored,
// so a typo in the UI surfaces immediately instead of silently returning
// unfiltered data.
// ---------------------------------------------------------------------

import { ApiError } from './http.js';

// field -> the v_player_season column it maps to, plus the operators and
// value type allowed for it.
export const FILTER_FIELDS = {
  season_id:     { column: 'vps.season_id',     type: 'int',  ops: ['eq', 'in'] },
  league_id:     { column: 'vps.league_id',     type: 'int',  ops: ['eq', 'in'] },
  team_id:       { column: 'vps.team_id',       type: 'int',  ops: ['eq', 'in'] },
  position_code: { column: 'vps.position_code', type: 'text', ops: ['eq', 'in'] },
  nation_code:   { column: 'vps.nation_code',   type: 'text', ops: ['eq', 'in'] },
  player_name:   { column: 'vps.player_name',   type: 'text', ops: ['like'] },
  age_years:     { column: 'vps.age_years',     type: 'int',  ops: ['eq', 'gte', 'lte', 'between'] },
  minutes:       { column: 'vps.minutes',       type: 'int',  ops: ['gte', 'lte', 'between'] },
  matches_played:{ column: 'vps.matches_played',type: 'int',  ops: ['gte', 'lte', 'between'] },
  goals:         { column: 'vps.goals',         type: 'int',  ops: ['gte', 'lte', 'between'] },
  assists:       { column: 'vps.assists',       type: 'int',  ops: ['gte', 'lte', 'between'] },
  goals_assists: { column: 'vps.goals_assists', type: 'int',  ops: ['gte', 'lte', 'between'] },
  shots:         { column: 'vps.shots',         type: 'int',  ops: ['gte', 'lte'] },
  cards_yellow:  { column: 'vps.cards_yellow',  type: 'int',  ops: ['gte', 'lte'] },
  cards_red:     { column: 'vps.cards_red',     type: 'int',  ops: ['gte', 'lte'] },
  clean_sheets:  { column: 'vps.clean_sheets',  type: 'int',  ops: ['gte', 'lte'] },
  saves:         { column: 'vps.saves',         type: 'int',  ops: ['gte', 'lte'] },
  goals_per90:   { column: 'vps.goals_per90',   type: 'float',ops: ['gte', 'lte'] },
  assists_per90: { column: 'vps.assists_per90', type: 'float',ops: ['gte', 'lte'] },
  minutes_pct:   { column: 'vps.minutes_pct',   type: 'float',ops: ['gte', 'lte'] },
  total_points:  { column: 'fp.total_points',   type: 'float',ops: ['gte', 'lte'] },
  points_per90:  { column: 'fp.points_per90',   type: 'float',ops: ['gte', 'lte'] },
};

// Columns the result table may be sorted by. Sorting is the other place
// user input would otherwise reach SQL directly, so it gets the same
// whitelist treatment.
export const SORT_FIELDS = {
  player_name: 'vps.player_name',
  team_name: 'vps.team_name',
  league_name: 'vps.league_name',
  season_label: 'vps.start_year',
  position_code: 'vps.position_code',
  age_years: 'vps.age_years',
  minutes: 'vps.minutes',
  matches_played: 'vps.matches_played',
  goals: 'vps.goals',
  assists: 'vps.assists',
  goals_assists: 'vps.goals_assists',
  shots: 'vps.shots',
  cards_yellow: 'vps.cards_yellow',
  clean_sheets: 'vps.clean_sheets',
  saves: 'vps.saves',
  goals_per90: 'vps.goals_per90',
  assists_per90: 'vps.assists_per90',
  total_points: 'fp.total_points',
  points_per90: 'fp.points_per90',
};

const MAX_IN_VALUES = 50;

function coerce(value, type, field) {
  if (type === 'int' || type === 'float') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new ApiError(400, `${field} expects a number, got "${value}"`);
    return type === 'int' ? Math.trunc(n) : n;
  }
  const text = String(value).trim();
  if (text.length > 80) throw new ApiError(400, `${field} value is too long`);
  return text;
}

/**
 * Builds `{ sql, params }` from a list of filter objects:
 *   [{ field: 'goals', op: 'gte', value: 10 },
 *    { field: 'league_id', op: 'in', value: [1, 3] }]
 */
export function buildWhere(filters = []) {
  const clauses = [];
  const params = [];

  for (const filter of filters) {
    const { field, op = 'eq', value } = filter ?? {};
    const spec = FILTER_FIELDS[field];
    if (!spec) throw new ApiError(400, `Unknown filter field: "${field}"`);
    if (!spec.ops.includes(op)) {
      throw new ApiError(400, `Operator "${op}" is not allowed on "${field}" (allowed: ${spec.ops.join(', ')})`);
    }

    switch (op) {
      case 'eq':
        clauses.push(`${spec.column} = ?`);
        params.push(coerce(value, spec.type, field));
        break;
      case 'gte':
        clauses.push(`${spec.column} >= ?`);
        params.push(coerce(value, spec.type, field));
        break;
      case 'lte':
        clauses.push(`${spec.column} <= ?`);
        params.push(coerce(value, spec.type, field));
        break;
      case 'between': {
        if (!Array.isArray(value) || value.length !== 2) {
          throw new ApiError(400, `"${field}" with op "between" expects [min, max]`);
        }
        clauses.push(`${spec.column} BETWEEN ? AND ?`);
        params.push(coerce(value[0], spec.type, field), coerce(value[1], spec.type, field));
        break;
      }
      case 'in': {
        const list = Array.isArray(value) ? value : [value];
        if (!list.length) throw new ApiError(400, `"${field}" with op "in" expects a non-empty list`);
        if (list.length > MAX_IN_VALUES) {
          throw new ApiError(400, `"${field}" accepts at most ${MAX_IN_VALUES} values`);
        }
        clauses.push(`${spec.column} IN (${list.map(() => '?').join(', ')})`);
        params.push(...list.map((v) => coerce(v, spec.type, field)));
        break;
      }
      case 'like': {
        clauses.push(`${spec.column} LIKE ?`);
        // Escape LIKE wildcards so a search for "100%" is a literal search.
        const text = coerce(value, spec.type, field).replace(/[%_\\]/g, (c) => `\\${c}`);
        params.push(`%${text}%`);
        break;
      }
      default:
        throw new ApiError(400, `Unsupported operator: "${op}"`);
    }
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

/** Resolves a sort selection to a safe `ORDER BY` fragment. */
export function buildOrderBy(sortField, sortDir) {
  const column = SORT_FIELDS[sortField] || SORT_FIELDS.total_points;
  const direction = String(sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // NULLs (e.g. a keeper stat on an outfielder) always sort last.
  return `ORDER BY ${column} IS NULL, ${column} ${direction}, vps.player_name ASC`;
}

/**
 * Accepts filters from either a JSON body (POST /search) or a flat query
 * string (GET /search?goals_gte=10&league_id=1), normalising both into
 * the same filter-object list.
 */
export function filtersFromQuery(queryParams) {
  const filters = [];
  for (const [key, raw] of Object.entries(queryParams)) {
    if (raw === undefined || raw === '') continue;
    const match = key.match(/^(.*?)_(eq|gte|lte|in|like|between)$/);
    const field = match ? match[1] : key;
    const op = match ? match[2] : (FILTER_FIELDS[field]?.ops.includes('eq') ? 'eq' : 'like');
    if (!FILTER_FIELDS[field]) continue;   // ignore paging/sort params
    let value = raw;
    if (op === 'in' || op === 'between') value = String(raw).split(',').map((v) => v.trim());
    filters.push({ field, op, value });
  }
  return filters;
}
