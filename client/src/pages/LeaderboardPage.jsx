// Fantasy leaderboard. The ranking, the filters and the points themselves
// all come from MySQL (sp_leaderboard over the fantasy_points table).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loading, Message, PositionChip } from '../components/Bits.jsx';
import { api } from '../lib/api.js';
import { useMeta } from '../lib/MetaContext.jsx';
import { int, num } from '../lib/format.js';

export default function LeaderboardPage() {
  const { meta } = useMeta();
  const [filters, setFilters] = useState({
    season_id: '', league_id: '', position: '', min_minutes: 900, limit: 25,
  });
  const [rows, setRows] = useState(null);
  const [rulesets, setRulesets] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function load(next = filters) {
    setBusy(true);
    setError(null);
    try {
      const params = Object.fromEntries(
        Object.entries(next).filter(([, v]) => v !== '' && v !== null));
      setRows(await api.leaderboard(params));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    api.rulesets().then((all) => {
      // Collapse the rule rows into one entry per ruleset.
      const map = new Map();
      for (const r of all) {
        if (!map.has(r.ruleset_id)) {
          map.set(r.ruleset_id, {
            ruleset_id: r.ruleset_id, name: r.name,
            description: r.description, is_active: r.is_active, rules: [],
          });
        }
        map.get(r.ruleset_id).rules.push(r);
      }
      setRulesets([...map.values()]);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function activate(id) {
    setBusy(true);
    try {
      const result = await api.activateRuleset(id);
      setNotice(`Ruleset switched — ${result.scored.toLocaleString()} player-seasons re-scored in MySQL.`);
      setRulesets((prev) => prev.map((r) => ({ ...r, is_active: r.ruleset_id === id ? 1 : 0 })));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (patch) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    load(next);
  };

  return (
    <>
      <div className="page-head">
        <h2>Fantasy leaderboard</h2>
        <p>Points are computed in the database from the active scoring ruleset.</p>
      </div>

      <div className="panel">
        <h3>Scoring ruleset</h3>
        <div className="row">
          {rulesets.map((r) => (
            <button
              key={r.ruleset_id}
              className={r.is_active ? 'primary' : ''}
              onClick={() => activate(r.ruleset_id)}
              disabled={busy || !!r.is_active}
              title={r.description}
            >
              {r.name}{r.is_active ? ' · active' : ''}
            </button>
          ))}
        </div>
        {rulesets.find((r) => r.is_active) && (
          <p style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 0, marginTop: 10 }}>
            {rulesets.find((r) => r.is_active).description}
          </p>
        )}
      </div>

      <div className="panel">
        <h3>Filters</h3>
        <div className="row">
          <div className="field">
            <label>Season</label>
            <select value={filters.season_id} onChange={(e) => set({ season_id: e.target.value })}>
              <option value="">All seasons</option>
              {meta?.seasons.map((s) => (
                <option key={s.season_id} value={s.season_id}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>League</label>
            <select value={filters.league_id} onChange={(e) => set({ league_id: e.target.value })}>
              <option value="">All leagues</option>
              {meta?.leagues.map((l) => (
                <option key={l.league_id} value={l.league_id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Position</label>
            <select value={filters.position} onChange={(e) => set({ position: e.target.value })}>
              <option value="">All positions</option>
              {meta?.positions.map((p) => (
                <option key={p.position_id} value={p.code}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Min minutes</label>
            <input
              type="number" min="0" step="90" value={filters.min_minutes}
              onChange={(e) => setFilters({ ...filters, min_minutes: e.target.value })}
              onBlur={() => load()}
            />
          </div>
          <div className="field">
            <label>Show</label>
            <select value={filters.limit} onChange={(e) => set({ limit: e.target.value })}>
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>Top {n}</option>)}
            </select>
          </div>
        </div>
      </div>

      {error && <Message kind="error">{error}</Message>}
      {notice && <Message kind="ok">{notice}</Message>}

      <div className="panel">
        {busy && !rows ? <Loading /> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>Player</th><th>Pos</th><th>Club</th><th>Season</th>
                  <th style={{ textAlign: 'right' }}>Min</th>
                  <th style={{ textAlign: 'right' }}>G</th>
                  <th style={{ textAlign: 'right' }}>A</th>
                  <th style={{ textAlign: 'right' }}>CS</th>
                  <th style={{ textAlign: 'right' }}>Saves</th>
                  <th style={{ textAlign: 'right' }}>Attack</th>
                  <th style={{ textAlign: 'right' }}>Defence</th>
                  <th style={{ textAlign: 'right' }}>Discipline</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Per 90</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((row, i) => (
                  <tr key={row.player_season_id}>
                    <td style={{ color: 'var(--text-dim)' }}>{i + 1}</td>
                    <td><Link to={`/players/${row.player_id}`}>{row.player_name}</Link></td>
                    <td><PositionChip code={row.position_code} /></td>
                    <td>{row.team_name}</td>
                    <td style={{ color: 'var(--text-dim)' }}>{row.season_label}</td>
                    <td className="num">{int(row.minutes)}</td>
                    <td className="num">{int(row.goals)}</td>
                    <td className="num">{int(row.assists)}</td>
                    <td className="num">{int(row.clean_sheets)}</td>
                    <td className="num">{int(row.saves)}</td>
                    <td className="num">{num(row.attack_points, 0)}</td>
                    <td className="num">{num(row.defence_points, 0)}</td>
                    <td className="num" style={{ color: row.discipline_points < 0 ? 'var(--danger)' : undefined }}>
                      {num(row.discipline_points, 0)}
                    </td>
                    <td className="num" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      {num(row.total_points, 1)}
                    </td>
                    <td className="num">{num(row.points_per90, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows?.length === 0 && <div className="empty">No players match those filters.</div>}
          </div>
        )}
      </div>
    </>
  );
}
