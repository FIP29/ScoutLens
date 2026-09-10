// Scout shortlists: create lists, review what's on them, drop players.
// Players are added from the search page.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loading, Message, PositionChip } from '../components/Bits.jsx';
import { api } from '../lib/api.js';
import { int, num } from '../lib/format.js';

export default function ShortlistPage() {
  const [lists, setLists] = useState(null);
  const [active, setActive] = useState(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function refresh() {
    try {
      const data = await api.shortlists();
      setLists(data);
      return data;
    } catch (err) {
      setError(err.message);
      return [];
    }
  }

  useEffect(() => { refresh(); }, []);

  async function open(id) {
    setError(null);
    try {
      setActive(await api.shortlist(id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function create(e) {
    e.preventDefault();
    setError(null);
    try {
      const created = await api.createShortlist({ name, notes: notes || undefined });
      setName('');
      setNotes('');
      setNotice(`Created "${created.name}".`);
      await refresh();
      open(created.shortlist_id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeList(id) {
    try {
      await api.deleteShortlist(id);
      if (active?.shortlist_id === id) setActive(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeEntry(playerSeasonId) {
    try {
      await api.removeFromShortlist(active.shortlist_id, playerSeasonId);
      open(active.shortlist_id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <h2>Shortlists</h2>
        <p>Track scouting targets. Add players from the search results table.</p>
      </div>

      {error && <Message kind="error">{error}</Message>}
      {notice && <Message kind="ok">{notice}</Message>}

      <div className="grid cols-2">
        <div className="panel">
          <h3>New shortlist</h3>
          <form onSubmit={create}>
            <div className="field" style={{ marginBottom: 8 }}>
              <label>Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Left-backs under 23"
                required
                maxLength={60}
              />
            </div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="What are you looking for?"
              />
            </div>
            <button className="primary" type="submit" disabled={!name.trim()}>Create</button>
          </form>
        </div>

        <div className="panel">
          <h3>Your shortlists</h3>
          {!lists ? <Loading /> : lists.length === 0 ? (
            <div className="empty">No shortlists yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Name</th><th style={{ textAlign: 'right' }}>Players</th><th /></tr>
                </thead>
                <tbody>
                  {lists.map((l) => (
                    <tr key={l.shortlist_id}>
                      <td>
                        <button className="ghost small" onClick={() => open(l.shortlist_id)}>
                          {l.name}
                        </button>
                        {l.notes && (
                          <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>{l.notes}</div>
                        )}
                      </td>
                      <td className="num">{int(l.players)}</td>
                      <td>
                        <button className="ghost small danger" onClick={() => removeList(l.shortlist_id)}>
                          Delete
                        </button>
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
        <div className="panel">
          <h3>{active.name} — {active.entries.length} players</h3>
          {active.entries.length === 0 ? (
            <div className="empty">
              Nothing here yet. Run a search and use “+ shortlist” on a result.
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
                    <th>Rating</th><th>Note</th><th />
                  </tr>
                </thead>
                <tbody>
                  {active.entries.map((e) => (
                    <tr key={e.player_season_id}>
                      <td>{e.player_name}</td>
                      <td><PositionChip code={e.position_code} /></td>
                      <td>{e.team_name}</td>
                      <td style={{ color: 'var(--text-dim)' }}>{e.season_label}</td>
                      <td className="num">{int(e.age_years)}</td>
                      <td className="num">{int(e.minutes)}</td>
                      <td className="num">{int(e.goals)}</td>
                      <td className="num">{int(e.assists)}</td>
                      <td className="num" style={{ color: 'var(--accent)' }}>{num(e.total_points, 1)}</td>
                      <td>{e.rating ? '★'.repeat(e.rating) : '—'}</td>
                      <td style={{ color: 'var(--text-dim)', whiteSpace: 'normal' }}>{e.note ?? '—'}</td>
                      <td>
                        <button className="ghost small danger" onClick={() => removeEntry(e.player_season_id)}>
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
      )}
    </>
  );
}
