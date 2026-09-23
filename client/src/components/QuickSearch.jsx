// ---------------------------------------------------------------------
// The everyday search controls: name, country, league, position, season
// and club, always visible in one row.
//
// This sits above the advanced filter builder. Most searches are one of
// these six things, and making a scout add a criterion row to type a name
// was friction for no benefit. Anything more specific than this - "goals
// at least 15 and age under 23" - is still the filter builder's job.
//
// Both feed the same POST /api/players/search, so there is one code path
// on the server and one whitelist governing both.
// ---------------------------------------------------------------------

import { useMemo } from 'react';
import { useMeta } from '../lib/MetaContext.jsx';
import { flag } from '../lib/format.js';

export default function QuickSearch({ value, onChange, onSubmit, onClear, busy, teams }) {
  const { meta } = useMeta();

  // Nations are returned most-populous first; sort alphabetically for a
  // dropdown people scan by name, but keep the player counts visible.
  const nations = useMemo(
    () => [...(meta?.nations ?? [])].sort((a, b) => a.code.localeCompare(b.code)),
    [meta]);

  if (!meta) return null;

  const set = (patch) => onChange({ ...value, ...patch });
  const active = Object.values(value).filter((v) => v !== '' && v != null).length;

  return (
    <div className="panel quick-search">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Search</h3>
        {active > 0 && (
          <span className="tag">{active} {active === 1 ? 'filter' : 'filters'} active</span>
        )}
      </div>

      <div className="quick-grid">
        <div className="field span-2">
          <label htmlFor="qs-name">Player name</label>
          <input
            id="qs-name"
            type="search"
            placeholder="e.g. Bellingham"
            value={value.player_name}
            onChange={(e) => set({ player_name: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
          />
        </div>

        <div className="field">
          <label htmlFor="qs-nation">Country</label>
          <select id="qs-nation" value={value.nation_code}
                  onChange={(e) => set({ nation_code: e.target.value })}>
            <option value="">All countries</option>
            {nations.map((n) => (
              <option key={n.nation_id} value={n.code}>
                {flag(n.flag_code)} {n.code} ({n.players})
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="qs-league">League</label>
          <select id="qs-league" value={value.league_id}
                  onChange={(e) => set({ league_id: e.target.value, team_id: '' })}>
            <option value="">All leagues</option>
            {meta.leagues.map((l) => (
              <option key={l.league_id} value={l.league_id}>{l.name}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="qs-position">Position</label>
          <select id="qs-position" value={value.position_code}
                  onChange={(e) => set({ position_code: e.target.value })}>
            <option value="">All positions</option>
            {meta.positions.map((p) => (
              <option key={p.position_id} value={p.code}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="qs-season">Season</label>
          <select id="qs-season" value={value.season_id}
                  onChange={(e) => set({ season_id: e.target.value, team_id: '' })}>
            <option value="">All seasons</option>
            {meta.seasons.map((s) => (
              <option key={s.season_id} value={s.season_id}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="qs-team">Club</label>
          <select id="qs-team" value={value.team_id}
                  onChange={(e) => set({ team_id: e.target.value })}>
            <option value="">
              {teams.length ? 'All clubs' : 'Pick a league or season first'}
            </option>
            {teams.map((t) => (
              <option key={t.team_id} value={t.team_id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="qs-minutes">Min. minutes</label>
          <input
            id="qs-minutes"
            type="number"
            min="0"
            step="90"
            placeholder="0"
            value={value.min_minutes}
            onChange={(e) => set({ min_minutes: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
          />
        </div>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button className="ghost" onClick={onClear} disabled={busy}>Clear all</button>
        <span style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 'auto' }}>
          {busy ? 'Searching…' : 'Results update as you type.'}
        </span>
      </div>
    </div>
  );
}
