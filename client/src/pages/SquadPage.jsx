// Fantasy squad builder. The 15-player cap, the single-captain rule and the
// season match are all enforced by database triggers — the UI simply
// surfaces whatever the database says when a rule is broken.
import { useEffect, useState } from 'react';
import { Loading, Message, PositionChip, Stat } from '../components/Bits.jsx';
import { api } from '../lib/api.js';
import { useMeta } from '../lib/MetaContext.jsx';
import { int, num } from '../lib/format.js';

const SLOTS = ['GK', 'DEF', 'MID', 'FWD', 'BENCH'];

export default function SquadPage() {
  const { meta } = useMeta();
  const [squads, setSquads] = useState(null);
  const [active, setActive] = useState(null);
  const [form, setForm] = useState({ name: '', season_id: '', formation: '4-3-3' });
  const [candidates, setCandidates] = useState([]);
  const [pick, setPick] = useState({ term: '', slot: 'MID', captain: false });
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function refresh() {
    try { setSquads(await api.squads()); } catch (err) { setError(err.message); }
  }

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (meta?.seasons?.length && !form.season_id) {
      setForm((f) => ({ ...f, season_id: String(meta.seasons[0].season_id) }));
    }
  }, [meta, form.season_id]);

  async function open(id) {
    setError(null);
    try { setActive(await api.squad(id)); } catch (err) { setError(err.message); }
  }

  async function create(e) {
    e.preventDefault();
    setError(null);
    try {
      const created = await api.createSquad({
        name: form.name,
        season_id: Number(form.season_id),
        formation: form.formation,
      });
      setForm({ ...form, name: '' });
      setNotice(`Created squad "${created.name}".`);
      await refresh();
      open(created.squad_id);
    } catch (err) {
      setError(err.message);
    }
  }

  // Candidates are restricted to the squad's own season, matching the
  // trigger rule, so the user is not offered players the database will reject.
  async function findPlayers() {
    if (!active || pick.term.trim().length < 2) return;
    setError(null);
    try {
      const data = await api.search({
        filters: [
          { field: 'player_name', op: 'like', value: pick.term },
          { field: 'season_id', op: 'eq', value: active.season_id },
        ],
        sort: 'total_points',
        pageSize: 10,
      });
      setCandidates(data.rows);
      if (data.rows.length === 0) {
        setNotice(`No players matching "${pick.term}" in ${active.season_label}.`);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function addPlayer(row) {
    setError(null);
    setNotice(null);
    try {
      await api.addToSquad(active.squad_id, {
        player_season_id: row.player_season_id,
        slot: pick.slot,
        is_captain: pick.captain,
      });
      setCandidates([]);
      setPick({ ...pick, term: '', captain: false });
      await open(active.squad_id);
      refresh();
    } catch (err) {
      // Trigger violations (squad full, second captain, wrong season) land here.
      setError(err.message);
    }
  }

  async function removePlayer(playerSeasonId) {
    try {
      await api.removeFromSquad(active.squad_id, playerSeasonId);
      await open(active.squad_id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeSquad(id) {
    try {
      await api.deleteSquad(id);
      if (active?.squad_id === id) setActive(null);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <h2>Squad builder</h2>
        <p>
          Build a fantasy squad from one season. Squad size, captaincy and season
          consistency are enforced by triggers in MySQL.
        </p>
      </div>

      {error && <Message kind="error">{error}</Message>}
      {notice && <Message kind="ok">{notice}</Message>}

      <div className="grid cols-2">
        <div className="panel">
          <h3>New squad</h3>
          <form onSubmit={create}>
            <div className="field" style={{ marginBottom: 8 }}>
              <label>Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Best of 2024-25"
                required maxLength={60}
              />
            </div>
            <div className="row" style={{ marginBottom: 10 }}>
              <div className="field">
                <label>Season</label>
                <select
                  value={form.season_id}
                  onChange={(e) => setForm({ ...form, season_id: e.target.value })}
                >
                  {meta?.seasons.map((s) => (
                    <option key={s.season_id} value={s.season_id}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Formation</label>
                <select
                  value={form.formation}
                  onChange={(e) => setForm({ ...form, formation: e.target.value })}
                >
                  {['4-4-2', '4-3-3', '3-5-2', '4-2-3-1', '5-3-2'].map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
            </div>
            <button className="primary" type="submit" disabled={!form.name.trim()}>Create squad</button>
          </form>
        </div>

        <div className="panel">
          <h3>Your squads</h3>
          {!squads ? <Loading /> : squads.length === 0 ? (
            <div className="empty">No squads yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th><th>Season</th>
                    <th style={{ textAlign: 'right' }}>Players</th>
                    <th style={{ textAlign: 'right' }}>Points</th><th />
                  </tr>
                </thead>
                <tbody>
                  {squads.map((s) => (
                    <tr key={s.squad_id}>
                      <td>
                        <button className="ghost small" onClick={() => open(s.squad_id)}>{s.name}</button>
                        <span className="tag" style={{ marginLeft: 6 }}>{s.formation}</span>
                      </td>
                      <td style={{ color: 'var(--text-dim)' }}>{s.season_label}</td>
                      <td className="num">{int(s.players)}</td>
                      <td className="num" style={{ color: 'var(--accent)' }}>{num(s.projected_points, 1)}</td>
                      <td>
                        <button className="ghost small danger" onClick={() => removeSquad(s.squad_id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {active && (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <Stat label="Squad" value={active.name} sub={`${active.formation} · ${active.season_label}`} />
            <Stat label="Players" value={`${active.players.length} / 15`} />
            <Stat
              label="Starting XI points"
              value={num(active.projection?.starting_points, 1)}
              sub="captain counted double"
            />
            <Stat label="Including bench" value={num(active.projection?.total_points_incl_bench, 1)} />
          </div>

          <div className="panel">
            <h3>Add a player from {active.season_label}</h3>
            <div className="row">
              <div className="field" style={{ flex: 1, minWidth: 180 }}>
                <label>Search name</label>
                <input
                  value={pick.term}
                  placeholder="e.g. Salah"
                  onChange={(e) => setPick({ ...pick, term: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && findPlayers()}
                />
              </div>
              <div className="field">
                <label>Slot</label>
                <select value={pick.slot} onChange={(e) => setPick({ ...pick, slot: e.target.value })}>
                  {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Captain</label>
                <select
                  value={pick.captain ? 'yes' : 'no'}
                  onChange={(e) => setPick({ ...pick, captain: e.target.value === 'yes' })}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>
              <button onClick={findPlayers}>Find</button>
            </div>

            {candidates.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Player</th><th>Pos</th><th>Club</th>
                      <th style={{ textAlign: 'right' }}>G</th>
                      <th style={{ textAlign: 'right' }}>A</th>
                      <th style={{ textAlign: 'right' }}>FPts</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => (
                      <tr key={c.player_season_id}>
                        <td>{c.player_name}</td>
                        <td><PositionChip code={c.position_code} /></td>
                        <td>{c.team_name}</td>
                        <td className="num">{int(c.goals)}</td>
                        <td className="num">{int(c.assists)}</td>
                        <td className="num" style={{ color: 'var(--accent)' }}>{num(c.total_points, 1)}</td>
                        <td><button className="small primary" onClick={() => addPlayer(c)}>Add</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel">
            <h3>{active.name} — selection</h3>
            {active.players.length === 0 ? (
              <div className="empty">Squad is empty. Add players above.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Slot</th><th>Player</th><th>Pos</th><th>Club</th>
                      <th style={{ textAlign: 'right' }}>Min</th>
                      <th style={{ textAlign: 'right' }}>G</th>
                      <th style={{ textAlign: 'right' }}>A</th>
                      <th style={{ textAlign: 'right' }}>CS</th>
                      <th style={{ textAlign: 'right' }}>FPts</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {active.players.map((p) => (
                      <tr key={p.player_season_id}>
                        <td>
                          <span className="tag">{p.slot}</span>
                          {p.is_captain ? <span className="tag" style={{ marginLeft: 4, color: 'var(--warn)' }}>C</span> : null}
                        </td>
                        <td>{p.player_name}</td>
                        <td><PositionChip code={p.position_code} /></td>
                        <td>{p.team_name}</td>
                        <td className="num">{int(p.minutes)}</td>
                        <td className="num">{int(p.goals)}</td>
                        <td className="num">{int(p.assists)}</td>
                        <td className="num">{int(p.clean_sheets)}</td>
                        <td className="num" style={{ color: 'var(--accent)' }}>{num(p.total_points, 1)}</td>
                        <td>
                          <button className="ghost small danger" onClick={() => removePlayer(p.player_season_id)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
