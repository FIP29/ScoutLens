// ---------------------------------------------------------------------
// The scouting filter form.
//
// The list of filterable fields and the operators each one allows are
// taken from GET /api/meta, which in turn reflects the server-side
// whitelist. The UI therefore cannot offer a filter the API would reject,
// and adding a filter to the backend makes it appear here automatically.
// ---------------------------------------------------------------------

import { useState } from 'react';
import { useMeta } from '../lib/MetaContext.jsx';

const OP_LABELS = {
  eq: 'is',
  gte: 'at least',
  lte: 'at most',
  between: 'between',
  in: 'is one of',
  like: 'contains',
};

// Fields whose values come from a dropdown rather than free text.
const OPTION_SOURCES = {
  season_id: (meta) => meta.seasons.map((s) => [s.season_id, s.label]),
  league_id: (meta) => meta.leagues.map((l) => [l.league_id, l.name]),
  position_code: (meta) => meta.positions.map((p) => [p.code, `${p.code} — ${p.name}`]),
  nation_code: (meta) => meta.nations.slice(0, 60).map((n) => [n.code, `${n.code} (${n.players})`]),
};

const FIELD_LABELS = {
  season_id: 'Season', league_id: 'League', team_id: 'Team',
  position_code: 'Position', nation_code: 'Nation', player_name: 'Player name',
  age_years: 'Age', minutes: 'Minutes', matches_played: 'Appearances',
  goals: 'Goals', assists: 'Assists', goals_assists: 'Goals + assists',
  shots: 'Shots', cards_yellow: 'Yellow cards', cards_red: 'Red cards',
  clean_sheets: 'Clean sheets', saves: 'Saves', goals_per90: 'Goals per 90',
  assists_per90: 'Assists per 90', minutes_pct: 'Minutes %',
  total_points: 'Fantasy points', points_per90: 'Fantasy points per 90',
};

const label = (field) => FIELD_LABELS[field] ?? field;

export default function FilterBuilder({ filters, onChange, onSubmit, onReset, busy }) {
  const { meta } = useMeta();
  const [newField, setNewField] = useState('goals');
  if (!meta) return null;

  const fields = Object.entries(meta.filterFields);

  const addFilter = () => {
    const spec = meta.filterFields[newField];
    if (!spec) return;
    const op = spec.ops[0];
    onChange([...filters, { field: newField, op, value: op === 'between' ? ['', ''] : '' }]);
  };

  const update = (index, patch) =>
    onChange(filters.map((f, i) => (i === index ? { ...f, ...patch } : f)));

  const remove = (index) => onChange(filters.filter((_, i) => i !== index));

  return (
    <div className="panel">
      <h3>Filter builder</h3>

      {filters.length === 0 && (
        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>
          No filters yet — the search returns every player-season. Add a
          criterion below to narrow it down.
        </p>
      )}

      {filters.map((filter, index) => {
        const spec = meta.filterFields[filter.field];
        const options = OPTION_SOURCES[filter.field]?.(meta);

        return (
          <div className="filter-row" key={index}>
            <select
              value={filter.field}
              onChange={(e) => {
                const nextSpec = meta.filterFields[e.target.value];
                update(index, {
                  field: e.target.value,
                  op: nextSpec.ops[0],
                  value: nextSpec.ops[0] === 'between' ? ['', ''] : '',
                });
              }}
            >
              {fields.map(([field]) => (
                <option key={field} value={field}>{label(field)}</option>
              ))}
            </select>

            <select
              value={filter.op}
              onChange={(e) =>
                update(index, {
                  op: e.target.value,
                  value: e.target.value === 'between' ? ['', ''] : '',
                })}
            >
              {spec.ops.map((op) => (
                <option key={op} value={op}>{OP_LABELS[op] ?? op}</option>
              ))}
            </select>

            {filter.op === 'between' ? (
              <div className="between">
                <input
                  type="number"
                  placeholder="min"
                  value={filter.value?.[0] ?? ''}
                  onChange={(e) => update(index, { value: [e.target.value, filter.value?.[1] ?? ''] })}
                />
                <input
                  type="number"
                  placeholder="max"
                  value={filter.value?.[1] ?? ''}
                  onChange={(e) => update(index, { value: [filter.value?.[0] ?? '', e.target.value] })}
                />
              </div>
            ) : options ? (
              <select
                value={filter.value ?? ''}
                onChange={(e) => update(index, { value: e.target.value })}
              >
                <option value="">— choose —</option>
                {options.map(([value, text]) => (
                  <option key={value} value={value}>{text}</option>
                ))}
              </select>
            ) : (
              <input
                type={spec.type === 'text' ? 'text' : 'number'}
                step={spec.type === 'float' ? '0.01' : '1'}
                placeholder={spec.type === 'text' ? 'value' : '0'}
                value={filter.value ?? ''}
                onChange={(e) => update(index, { value: e.target.value })}
              />
            )}

            <button className="ghost small danger" onClick={() => remove(index)} title="Remove">
              ✕
            </button>
          </div>
        );
      })}

      <div className="row" style={{ marginTop: 12 }}>
        <div className="field">
          <label>Add criterion</label>
          <select value={newField} onChange={(e) => setNewField(e.target.value)}>
            {fields.map(([field]) => (
              <option key={field} value={field}>{label(field)}</option>
            ))}
          </select>
        </div>
        <button onClick={addFilter}>+ Add</button>
        <button className="primary" onClick={onSubmit} disabled={busy}>
          {busy ? 'Searching…' : 'Run search'}
        </button>
        <button className="ghost" onClick={onReset}>Reset</button>
      </div>
    </div>
  );
}
