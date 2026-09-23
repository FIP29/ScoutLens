// Shortlist management.
//
// A shortlist is a working document, not a bookmark folder: an opinion
// forms over time, so every entry carries a status, a star rating and a
// note, all editable in place. The summary panel and the aggregates it
// shows are computed in SQL, not by reducing rows here.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loading, Message, PositionChip, Stat } from '../components/Bits.jsx';
import { api } from '../lib/api.js';
import { flag, int, num } from '../lib/format.js';

const STATUSES = [
  { key: 'priority',    label: 'Priority',    colour: 'var(--accent)' },
  { key: 'shortlisted', label: 'Shortlisted', colour: '#3d84c6' },
  { key: 'watching',    label: 'Watching',    colour: '#8b9cad' },
  { key: 'rejected',    label: 'Rejected',    colour: 'var(--danger)' },
];

const SORTS = [
  ['added_at', 'Recently added'],
  ['rating', 'Rating'],
  ['status', 'Status'],
  ['player_name', 'Name'],
  ['age_years', 'Age'],
  ['total_points', 'Fantasy points'],
  ['goals', 'Goals'],
  ['minutes', 'Minutes'],
];

function StatusPill({ value, onChange }) {
  const current = STATUSES.find((s) => s.key === value) ?? STATUSES[2];
  return (
    <select
      className="status-pill"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ borderColor: current.colour, color: current.colour }}
      aria-label="Scouting status"
    >
      {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
    </select>
  );
}

function Stars({ value, onChange }) {
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= (value ?? 0) ? 'on' : ''}
          onClick={() => onChange(n === value ? null : n)}
          aria-label={`Rate ${n} of 5`}
          title={n === value ? 'Click again to clear' : `Rate ${n}`}
        >★</button>
      ))}
    </span>
  );
}

export default function ShortlistPage() {
  const [lists, setLists] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [active, setActive] = useState(null);
  const [sort, setSort] = useState('added_at');
  const [statusFilter, setStatusFilter] = useState('');

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Adding players without leaving the page.
  const [term, setTerm] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);

  const refreshLists = useCallback(async () => {
    try {
      const data = await api.shortlists();
      setLists(data);
      return data;
    } catch (err) {
      setError(err.message);
      return [];
    }
  }, []);

  const openList = useCallback(async (id, opts = {}) => {
    if (!id) return;
    setError(null);
    try {
      const data = await api.shortlist(id, {
        sort: opts.sort ?? sort,
        status: opts.status ?? statusFilter,
      });
      setActive(data);
      setActiveId(id);
    } catch (err) {
      setError(err.message);
    }
  }, [sort, statusFilter]);

  useEffect(() => {
    refreshLists().then((data) => {
      if (data.length && !activeId) openList(data[0].shortlist_id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(e) {
    e.preventDefault();
    setError(null);
    try {
      const created = await api.createShortlist({ name, notes: notes || undefined });
      setName(''); setNotes('');
      setNotice(`Created “${created.name}”.`);
      await refreshLists();
      openList(created.shortlist_id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeList(id) {
    try {
      await api.deleteShortlist(id);
      const remaining = await refreshLists();
      if (activeId === id) {
        setActive(null); setActiveId(null);
        if (remaining.length) openList(remaining[0].shortlist_id);
      }
    } catch (err) { setError(err.message); }
  }

  // Optimistic: update the row immediately, reconcile if the server says no.
  async function patchEntry(psId, patch) {
    setActive((prev) => prev && {
      ...prev,
      entries: prev.entries.map((e) =>
        e.player_season_id === psId ? { ...e, ...patch } : e),
    });
    try {
      await api.updateShortlistEntry(activeId, psId, patch);
      // Re-read the list: the summary tiles and pipeline counters are
      // aggregates computed in SQL, so patching a row locally would leave
      // them showing the previous state.
      await openList(activeId);
      refreshLists();
    } catch (err) {
      setError(err.message);
      openList(activeId);
    }
  }

  async function moveEntry(psId, targetId) {
    try {
      await api.moveShortlistEntry(activeId, psId, Number(targetId));
      const target = lists.find((l) => String(l.shortlist_id) === String(targetId));
      setNotice(`Moved to “${target?.name ?? 'other list'}”.`);
      await openList(activeId);
      refreshLists();
    } catch (err) { setError(err.message); }
  }

  async function removeEntry(psId) {
    try {
      await api.removeFromShortlist(activeId, psId);
      await openList(activeId);
      refreshLists();
    } catch (err) { setError(err.message); }
  }

  async function findPlayers() {
    if (term.trim().length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const data = await api.search({
        filters: [{ field: 'player_name', op: 'like', value: term.trim() }],
        sort: 'total_points', pageSize: 8,
      });
      setCandidates(data.rows);
      if (!data.rows.length) setNotice(`No player matching “${term}”.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  async function addCandidate(row) {
    try {
      await api.addToShortlist(activeId, { player_season_id: row.player_season_id });
      setCandidates([]); setTerm('');
      await openList(activeId);
      refreshLists();
    } catch (err) { setError(err.message); }
  }

  const summary = active?.summary;

  return (
    <>
      <div className="page-head">
        <h2>Shortlists</h2>
        <p>Track scouting targets, rate them, and move them through your pipeline.</p>
      </div>

      {error && <Message kind="error">{error}</Message>}
      {notice && <Message kind="ok">{notice}</Message>}

      <div className="shortlist-layout">
        {/* ---------------------------------------------- left: the lists */}
        <div>
          <div className="panel">
            <h3>Your lists</h3>
            {!lists ? <Loading /> : lists.length === 0 ? (
              <div className="empty" style={{ padding: 16 }}>No lists yet.</div>
            ) : (
              <div className="list-nav">
                {lists.map((l) => (
                  <button
                    key={l.shortlist_id}
                    className={`list-nav-item ${activeId === l.shortlist_id ? 'active' : ''}`}
                    onClick={() => openList(l.shortlist_id)}
                  >
                    <span className="nm">{l.name}</span>
                    <span className="ct">{int(l.players)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <h3>New list</h3>
            <form onSubmit={create}>
              <div className="field" style={{ marginBottom: 8 }}>
                <label htmlFor="sl-name">Name</label>
                <input id="sl-name" value={name} required maxLength={60}
                       placeholder="e.g. Left-backs under 23"
                       onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label htmlFor="sl-notes">Notes (optional)</label>
                <textarea id="sl-notes" rows={2} maxLength={500} value={notes}
                          placeholder="What are you looking for?"
                          onChange={(e) => setNotes(e.target.value)} />
              </div>
              <button className="primary" type="submit" disabled={!name.trim()}>Create</button>
            </form>
          </div>
        </div>

        {/* --------------------------------------------- right: the detail */}
        <div>
          {!active ? (
            <div className="panel"><div className="empty">Select or create a list.</div></div>
          ) : (
            <>
              <div className="panel">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{active.name}</h3>
                    {active.notes && (
                      <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>
                        {active.notes}
                      </p>
                    )}
                  </div>
                  <button className="ghost small danger"
                          onClick={() => removeList(active.shortlist_id)}>Delete list</button>
                </div>

                {summary?.total > 0 && (
                  <>
                    <div className="grid cols-4" style={{ marginTop: 14 }}>
                      <Stat label="Players" value={int(summary.total)}
                            sub={`${int(summary.clubs)} clubs · ${int(summary.nations)} nations`} />
                      <Stat label="Average age" value={num(summary.avg_age, 1)}
                            sub={`${int(summary.minutes)} minutes total`} />
                      <Stat label="Goals + assists"
                            value={int((summary.goals ?? 0) + (summary.assists ?? 0))}
                            sub={`${int(summary.goals)}G ${int(summary.assists)}A`} />
                      <Stat label="Avg fantasy points" value={num(summary.avg_points, 1)}
                            sub={summary.avg_rating ? `your rating ${num(summary.avg_rating, 1)}★` : 'unrated'} />
                    </div>

                    <div className="pipeline">
                      {STATUSES.map((s) => (
                        <div key={s.key} className="pipeline-step">
                          <span className="dot" style={{ background: s.colour }} />
                          <span className="n">{int(summary[s.key] ?? 0)}</span>
                          <span className="l">{s.label}</span>
                        </div>
                      ))}
                      {active.byPosition?.length > 0 && (
                        <div className="pipeline-step positions">
                          {active.byPosition.map((p) => (
                            <span key={p.position_code} className="tag" style={{ marginLeft: 4 }}>
                              {p.position_code} {p.n}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="panel">
                <h3>Add a player</h3>
                <div className="row">
                  <div className="field" style={{ flex: 1, minWidth: 180 }}>
                    <label htmlFor="sl-find">Search by name</label>
                    <input id="sl-find" value={term} placeholder="e.g. Saka"
                           onChange={(e) => setTerm(e.target.value)}
                           onKeyDown={(e) => e.key === 'Enter' && findPlayers()} />
                  </div>
                  <button onClick={findPlayers} disabled={searching}>
                    {searching ? 'Searching…' : 'Find'}
                  </button>
                </div>

                {candidates.length > 0 && (
                  <div className="table-wrap" style={{ marginTop: 12 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Player</th><th>Pos</th><th>Club</th><th>Season</th>
                          <th style={{ textAlign: 'right' }}>G</th>
                          <th style={{ textAlign: 'right' }}>A</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {candidates.map((c) => (
                          <tr key={c.player_season_id}>
                            <td>{c.flag_code ? `${flag(c.flag_code)} ` : ''}{c.player_name}</td>
                            <td><PositionChip code={c.position_code} /></td>
                            <td>{c.team_name}</td>
                            <td style={{ color: 'var(--text-dim)' }}>{c.season_label}</td>
                            <td className="num">{int(c.goals)}</td>
                            <td className="num">{int(c.assists)}</td>
                            <td>
                              <button className="small primary"
                                      onClick={() => addCandidate(c)}>Add</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="panel">
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>{active.entries.length} shown</h3>
                  <div className="row">
                    <div className="field">
                      <label htmlFor="sl-status">Status</label>
                      <select id="sl-status" value={statusFilter}
                              onChange={(e) => {
                                setStatusFilter(e.target.value);
                                openList(activeId, { status: e.target.value });
                              }}>
                        <option value="">All</option>
                        {STATUSES.map((s) => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="sl-sort">Sort by</label>
                      <select id="sl-sort" value={sort}
                              onChange={(e) => {
                                setSort(e.target.value);
                                openList(activeId, { sort: e.target.value });
                              }}>
                        {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {active.entries.length === 0 ? (
                  <div className="empty">
                    Nothing here yet. Add a player above, or use “+ shortlist” on the search page.
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Player</th><th>Pos</th><th>Club</th><th>Season</th>
                          <th style={{ textAlign: 'right' }}>Age</th>
                          <th style={{ textAlign: 'right' }}>Min</th>
                          <th style={{ textAlign: 'right' }}>G</th>
                          <th style={{ textAlign: 'right' }}>A</th>
                          <th style={{ textAlign: 'right' }}>FPts</th>
                          <th>Status</th><th>Rating</th><th>Note</th><th />
                        </tr>
                      </thead>
                      <tbody>
                        {active.entries.map((e) => (
                          <tr key={e.player_season_id}>
                            <td>
                              <Link to={`/players/${e.player_id}`}>
                                {e.flag_code ? `${flag(e.flag_code)} ` : ''}{e.player_name}
                              </Link>
                            </td>
                            <td><PositionChip code={e.position_code} /></td>
                            <td>{e.team_name}</td>
                            <td style={{ color: 'var(--text-dim)' }}>{e.season_label}</td>
                            <td className="num">{int(e.age_years)}</td>
                            <td className="num">{int(e.minutes)}</td>
                            <td className="num">{int(e.goals)}</td>
                            <td className="num">{int(e.assists)}</td>
                            <td className="num" style={{ color: 'var(--accent)' }}>
                              {num(e.total_points, 1)}
                            </td>
                            <td>
                              <StatusPill value={e.status}
                                          onChange={(v) => patchEntry(e.player_season_id, { status: v })} />
                            </td>
                            <td>
                              <Stars value={e.rating}
                                     onChange={(v) => patchEntry(e.player_season_id, { rating: v })} />
                            </td>
                            <td>
                              <input
                                className="note-input"
                                defaultValue={e.note ?? ''}
                                placeholder="Add a note…"
                                maxLength={300}
                                onBlur={(ev) => {
                                  const v = ev.target.value.trim();
                                  if (v !== (e.note ?? '')) {
                                    patchEntry(e.player_season_id, { note: v || null });
                                  }
                                }}
                              />
                            </td>
                            <td>
                              <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                                {lists.length > 1 && (
                                  <select
                                    className="small"
                                    value=""
                                    aria-label="Move to another list"
                                    onChange={(ev) => ev.target.value &&
                                      moveEntry(e.player_season_id, ev.target.value)}
                                  >
                                    <option value="">Move…</option>
                                    {lists.filter((l) => l.shortlist_id !== activeId).map((l) => (
                                      <option key={l.shortlist_id} value={l.shortlist_id}>
                                        {l.name}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                <button className="ghost small danger"
                                        onClick={() => removeEntry(e.player_season_id)}
                                        title="Remove from list">✕</button>
                              </div>
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
        </div>
      </div>
    </>
  );
}
