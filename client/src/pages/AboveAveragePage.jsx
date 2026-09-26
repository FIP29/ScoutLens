// Above-average performers.
//
// Pick a position and a stat; see who beats the average of their own peer
// group - the same position, in the same league, in the same season. The
// peer average is computed by MySQL (a correlated subquery, see
// server/src/routes/peers.js); this page only chooses the inputs and sorts
// the rows it gets back. Public - no login.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loading, Message } from '../components/Bits.jsx';
import { api } from '../lib/api.js';
import { useMeta } from '../lib/MetaContext.jsx';
import { flag, int, num } from '../lib/format.js';

// Stats that make sense for each position, so a forward is not offered
// "saves" and a keeper is not offered "shots". Every stat is still
// reachable - "All stats" lifts the filter.
const SUGGESTED = {
  FW: ['goals_per90', 'npg_per90', 'ga_per90', 'goals', 'assists', 'shots_per90', 'sot_per90'],
  MF: ['ga_per90', 'assists_per90', 'goals_per90', 'tackles_per90', 'interceptions_per90', 'assists'],
  DF: ['tackles_per90', 'interceptions_per90', 'tackles_won', 'interceptions', 'assists', 'goals'],
  GK: ['save_pct', 'goals_against_p90', 'clean_sheets', 'saves'],
};

const COLUMNS = [
  { key: 'player_name', label: 'Player' },
  { key: 'team_name', label: 'Club' },
  { key: 'league_name', label: 'League' },
  { key: 'season_label', label: 'Season' },
  { key: 'minutes', label: 'Min', numeric: true },
  { key: 'value', label: 'Value', numeric: true },
  { key: 'peer_avg', label: 'Peer avg', numeric: true },
  { key: 'margin', label: 'Margin', numeric: true },
  { key: 'pct_above', label: '% better', numeric: true },
  { key: 'peer_count', label: 'Peers', numeric: true },
];

export default function AboveAveragePage() {
  const { meta } = useMeta();
  const [stats, setStats] = useState([]);
  const [showAllStats, setShowAllStats] = useState(false);
  const [form, setForm] = useState({
    position: 'FW', stat: 'goals_per90', season_id: '', league_id: '', min_minutes: 900,
  });
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState({ key: 'margin', dir: 'desc' });

  useEffect(() => { api.peerStats().then(setStats).catch((e) => setError(e.message)); }, []);

  // Default to the most recent season once reference data arrives.
  useEffect(() => {
    if (meta?.seasons?.length && !form.season_id) {
      setForm((f) => ({ ...f, season_id: String(meta.seasons[0].season_id) }));
    }
  }, [meta, form.season_id]);

  // Re-query whenever an input changes - no Search button to press.
  useEffect(() => {
    if (!form.season_id && meta?.seasons?.length) return;   // wait for the default
    let cancelled = false;
    setBusy(true);
    setError(null);
    const handle = setTimeout(() => {
      api.aboveAverage(form)
        .then((d) => { if (!cancelled) setData(d); })
        .catch((e) => { if (!cancelled) { setError(e.message); setData(null); } })
        .finally(() => { if (!cancelled) setBusy(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [form, meta]);

  const statOptions = useMemo(() => {
    const allowed = showAllStats ? null : new Set(SUGGESTED[form.position]);
    const groups = {};
    for (const s of stats) {
      if (allowed && !allowed.has(s.key) && s.key !== form.stat) continue;
      (groups[s.group] ??= []).push(s);
    }
    return groups;
  }, [stats, form.position, form.stat, showAllStats]);

  // Changing position switches to a stat that fits it, unless the current
  // one already does.
  function setPosition(position) {
    const fits = SUGGESTED[position].includes(form.stat);
    setForm({ ...form, position, stat: fits ? form.stat : SUGGESTED[position][0] });
  }

  // Sorting happens here: the server returns at most 500 rows, so
  // reordering them in the browser is instant and needs no round trip.
  const rows = useMemo(() => {
    if (!data) return [];
    const { key, dir } = sort;
    const factor = dir === 'asc' ? 1 : -1;
    return [...data.rows].sort((a, b) => {
      const x = a[key]; const y = b[key];
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * factor;
    });
  }, [data, sort]);

  function toggleSort(key) {
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  }

  const statMeta = stats.find((s) => s.key === form.stat);
  const seasonLabel = meta?.seasons.find((s) => String(s.season_id) === String(form.season_id))?.label;
  const positionName = meta?.positions.find((p) => p.code === form.position)?.name?.toLowerCase();
  const noun = (n) => {
    const base = positionName ?? 'player';
    return n === 1 ? base : `${base}s`;
  };

  return (
    <>
      <div className="page-head">
        <h2>Above-average performers</h2>
        <p>
          Players who beat the average of their own peer group — the same
          position, in the same league, in the same season.
        </p>
      </div>

      <div className="panel">
        <div className="quick-grid">
          <div className="field">
            <label htmlFor="aa-position">Position</label>
            <select id="aa-position" value={form.position}
                    onChange={(e) => setPosition(e.target.value)}>
              {meta?.positions.map((p) => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="field span-2">
            <label htmlFor="aa-stat">Stat</label>
            <select id="aa-stat" value={form.stat}
                    onChange={(e) => setForm({ ...form, stat: e.target.value })}>
              {Object.entries(statOptions).map(([group, items]) => (
                <optgroup key={group} label={group}>
                  {items.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}{s.lower_is_better ? ' (lower is better)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="aa-season">Season</label>
            <select id="aa-season" value={form.season_id}
                    onChange={(e) => setForm({ ...form, season_id: e.target.value })}>
              <option value="">All seasons</option>
              {meta?.seasons.map((s) => (
                <option key={s.season_id} value={s.season_id}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="aa-league">League</label>
            <select id="aa-league" value={form.league_id}
                    onChange={(e) => setForm({ ...form, league_id: e.target.value })}>
              <option value="">All leagues</option>
              {meta?.leagues.map((l) => (
                <option key={l.league_id} value={l.league_id}>{l.name}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="aa-min">Min. minutes</label>
            <input id="aa-min" type="number" min="0" step="90" value={form.min_minutes}
                   onChange={(e) => setForm({ ...form, min_minutes: e.target.value })} />
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={showAllStats}
                   onChange={(e) => setShowAllStats(e.target.checked)} />
            Show every stat, not just the ones suited to this position
          </label>
        </div>
      </div>

      <div className="msg info">
        Each player is compared only with their peers, so a Bundesliga forward
        is measured against Bundesliga forwards, not against Premier League
        defenders. Peers need at least {int(Number(form.min_minutes) || 0)} minutes
        too, so a handful of short cameos cannot drag the average down.
        {statMeta?.lower_is_better && ' For this stat a lower number is better, so it lists players below their peer average.'}
      </div>

      {error && <Message kind="error">{error}</Message>}

      {busy && !data ? <Loading>Comparing players with their peers…</Loading> : data && (
        <div className="panel">
          <h3>
            {data.count} {noun(data.count)} above
            their peer average on {statMeta?.label.toLowerCase()}
            {seasonLabel ? ` · ${seasonLabel}` : ' · all seasons'}
            {data.truncated && ' (first 500)'}
          </h3>

          {rows.length === 0 ? (
            <div className="empty">
              Nobody clears the bar with these settings. Try lowering the minimum minutes.
            </div>
          ) : (
            <div className="table-wrap" style={{ opacity: busy ? 0.55 : 1 }}>
              <table>
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className="sortable"
                          style={c.numeric ? { textAlign: 'right' } : undefined}
                          onClick={() => toggleSort(c.key)}
                          aria-sort={sort.key === c.key
                            ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        {c.label}
                        {sort.key === c.key && <span className="arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.player_season_id}>
                      <td>
                        <Link to={`/players/${r.player_id}`}>
                          {r.flag_code ? `${flag(r.flag_code)} ` : ''}{r.player_name}
                        </Link>
                      </td>
                      <td>{r.team_name}</td>
                      <td style={{ color: 'var(--text-dim)' }}>{r.league_name}</td>
                      <td style={{ color: 'var(--text-dim)' }}>{r.season_label}</td>
                      <td className="num">{int(r.minutes)}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{num(r.value, 2)}</td>
                      <td className="num" style={{ color: 'var(--text-dim)' }}>{num(r.peer_avg, 2)}</td>
                      <td className="num" style={{ color: 'var(--accent)' }}>+{num(r.margin, 2)}</td>
                      <td className="num" style={{ color: 'var(--accent)' }}>
                        {r.pct_above === null ? '—' : `+${num(r.pct_above, 0)}%`}
                      </td>
                      <td className="num" style={{ color: 'var(--text-dim)' }}>{int(r.peer_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
