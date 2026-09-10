// ---------------------------------------------------------------------
// Field-level cleaning for the raw FBref CSV.
//
// The export is messy in three specific ways, all handled here:
//   1. Fringe players (unused subs) have blank Comp/Nation/Pos in the
//      base columns but populated `_playing_time` / `_keeper` variants.
//   2. Age is written either as '21-023' (years-days) or as '21.0'.
//   3. Every numeric column is a float-formatted string that may be ''.
// ---------------------------------------------------------------------

/** Trimmed value, or '' when absent. */
const raw = (row, key) => (row[key] ?? '').trim();

/**
 * First non-empty value across the given columns. FBref repeats the
 * same attribute in each per-category export, so a value missing from
 * the base column is usually still present in one of the others.
 */
export function coalesce(row, ...keys) {
  for (const key of keys) {
    const value = raw(row, key);
    if (value !== '') return value;
  }
  return null;
}

/** '12.0' -> 12, '' -> null. Non-numeric input yields null, never NaN. */
export function toInt(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** '0.24' -> 0.24, '' -> null. */
export function toFloat(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Same as toInt but clamps negatives away for UNSIGNED columns. */
export function toUInt(value) {
  const n = toInt(value);
  if (n === null) return null;
  return n < 0 ? null : n;
}

/**
 * '21-023' -> { years: 21, days: 23 }
 * '19.0'   -> { years: 19, days: null }
 * ''       -> { years: null, days: null }
 */
export function parseAge(value) {
  const text = (value ?? '').trim();
  if (text === '') return { years: null, days: null };
  if (text.includes('-')) {
    const [years, days] = text.split('-');
    return { years: toInt(years), days: toInt(days) };
  }
  return { years: toInt(text), days: null };
}

/**
 * 'ar ARG' -> { fbrefCode: 'ar ARG', flagCode: 'ar', code: 'ARG' }
 * Occasionally FBref emits only the 3-letter code with no flag prefix.
 */
export function parseNation(value) {
  const text = (value ?? '').trim();
  if (text === '') return null;
  const parts = text.split(/\s+/);
  if (parts.length >= 2) {
    return { fbrefCode: text, flagCode: parts[0].toLowerCase().slice(0, 2), code: parts[1].toUpperCase().slice(0, 3) };
  }
  return { fbrefCode: text, flagCode: text.toLowerCase().slice(0, 2), code: text.toUpperCase().slice(0, 3) };
}

// FBref prefixes each competition with its country code.
const COUNTRIES = {
  eng: ['ENG', 'England'],
  es: ['ESP', 'Spain'],
  it: ['ITA', 'Italy'],
  de: ['GER', 'Germany'],
  fr: ['FRA', 'France'],
};

/** 'eng Premier League' -> { name: 'Premier League', countryCode: 'ENG', ... } */
export function parseLeague(value) {
  const text = (value ?? '').trim();
  if (text === '') return null;
  const [prefix, ...rest] = text.split(/\s+/);
  const known = COUNTRIES[prefix.toLowerCase()];
  if (known && rest.length) {
    return { fbrefCode: text, name: rest.join(' '), countryCode: known[0], countryName: known[1] };
  }
  return { fbrefCode: text, name: text, countryCode: prefix.toUpperCase().slice(0, 3), countryName: prefix };
}

/** 'MF,FW' -> ['MF','FW']; the first entry is treated as primary. */
export function parsePositions(value) {
  const text = (value ?? '').trim();
  if (text === '') return [];
  return [...new Set(text.split(',').map((p) => p.trim().toUpperCase()).filter(Boolean))];
}

/** '2024-2025' -> { label, startYear: 2024, endYear: 2025 }. */
export function parseSeason(value) {
  const text = (value ?? '').trim();
  const [start, end] = text.split('-');
  return { label: text, startYear: toInt(start), endYear: toInt(end) };
}

/**
 * Accent-folded, lower-cased name used as the player identity key.
 *
 * The database stores names under utf8mb4_unicode_ci, which treats
 * 'Álvaro Cortés' and 'Alvaro Cortes' as the same value. The scrape
 * contains exactly that inconsistency for one player, so the importer
 * has to fold names the same way MySQL does or the unique key rejects
 * the second spelling. Folding here means both spellings resolve to a
 * single player row rather than two half-populated careers.
 */
export function normalizeName(value) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .trim();
}

/** Prefers the spelling that carries diacritics when a name has variants. */
export function preferredSpelling(a, b) {
  if (!a) return b;
  if (!b) return a;
  const accents = (s) => s.normalize('NFD').match(/\p{Mn}/gu)?.length ?? 0;
  return accents(b) > accents(a) ? b : a;
}
