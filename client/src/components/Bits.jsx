// Small presentational pieces reused across pages.
import { Link } from 'react-router-dom';
import { POSITION_COLOURS, flag, int, num } from '../lib/format.js';

export function PositionChip({ code }) {
  if (!code) return <span className="tag">—</span>;
  return (
    <span className="chip" style={{ background: POSITION_COLOURS[code] || '#64748b' }}>
      {code}
    </span>
  );
}

export function PlayerLink({ id, name, nationCode, flagCode }) {
  return (
    <Link to={`/players/${id}`}>
      {flagCode ? `${flag(flagCode)} ` : ''}{name}
      {nationCode ? <span style={{ color: 'var(--text-dim)', marginLeft: 5, fontSize: 11 }}>{nationCode}</span> : null}
    </Link>
  );
}

export function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function Message({ kind = 'info', children }) {
  if (!children) return null;
  return <div className={`msg ${kind}`}>{children}</div>;
}

export function Loading({ children = 'Loading…' }) {
  return <div className="loading">{children}</div>;
}

/** Renders a numeric cell with a consistent 'no data' dash. */
export const Num = ({ value, digits = 0 }) => (
  <td className="num">{digits ? num(value, digits) : int(value)}</td>
);
