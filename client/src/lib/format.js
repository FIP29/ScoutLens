// Display helpers shared across tables and charts.

export const num = (value, digits = 0) =>
  value === null || value === undefined ? '—' : Number(value).toFixed(digits);

export const int = (value) =>
  value === null || value === undefined ? '—' : Number(value).toLocaleString();

/** 'ar' -> the regional-indicator flag emoji, or '' when unknown. */
export function flag(code) {
  if (!code || code.length !== 2) return '';
  const base = 0x1f1e6;
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => base + c.charCodeAt(0) - 65));
}

export const POSITION_COLOURS = {
  GK: '#e0a458',
  DF: '#4c9f70',
  MF: '#3d84c6',
  FW: '#d1495b',
};
