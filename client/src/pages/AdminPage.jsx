// Admin: log in, then add, edit or delete players.
//
// The session is an httpOnly cookie the browser holds and sends on its
// own - this page never sees or stores the token. It asks the server
// whether a session exists (/admin/session) and shows either the login
// form or the tools. Any 401 from a write means the session lapsed, and
// the page drops back to the login form with a message.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loading, Message, PositionChip } from '../components/Bits.jsx';
import { api } from '../lib/api.js';
import { useMeta } from '../lib/MetaContext.jsx';
import { int, num } from '../lib/format.js';

const STAT_INPUTS = [
  ['matches_played', 'Appearances'],
  ['starts', 'Starts'],
  ['minutes', 'Minutes'],
  ['goals', 'Goals'],
  ['assists', 'Assists'],
  ['pens_made', 'Penalties scored'],
  ['cards_yellow', 'Yellow cards'],
  ['cards_red', 'Red cards'],
];

const EMPTY_STATS = Object.fromEntries(STAT_INPUTS.map(([k]) => [k, '']));

/** Blank inputs are left out, so the server keeps (or defaults) them. */
function numbersOnly(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => [k, Number(v)]));
}

// ------------------------------------------------------------- login ---

function LoginForm({ onLoggedIn, notice, configured }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.adminLogin(email, password);
      setPassword('');
      onLoggedIn(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel admin-login">
      <h3>Admin login</h3>
      {notice && <Message kind="info">{notice}</Message>}
      {!configured && (
        <Message kind="error">
          Admin login is not configured on the server yet. Set JWT_SECRET in the
          project's .env, restart, and create the account with <code>npm run admin:set</code>.
        </Message>
      )}
      {error && <Message kind="error">{error}</Message>}
      <form onSubmit={submit}>
        <div className="field" style={{ marginBottom: 10 }}>
          <label htmlFor="ad-email">Email</label>
          <input id="ad-email" type="email" autoComplete="username" required
                 value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label htmlFor="ad-password">Password</label>
          <input id="ad-password" type="password" autoComplete="current-password" required
                 value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="primary" type="submit" disabled={busy || !configured}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------------- shared inputs ---

function StatFields({ stats, onChange, prefix }) {
  return (
    <div className="quick-grid">
      {STAT_INPUTS.map(([key, label]) => (
        <div className="field" key={key}>
          <label htmlFor={`${prefix}-${key}`}>{label}</label>
          <input id={`${prefix}-${key}`} type="number" min="0" inputMode="numeric"
                 value={stats[key] ?? ''} placeholder="0"
                 onChange={(e) => onChange({ ...stats, [key]: e.target.value })} />
        </div>
      ))}
    </div>
  );
}

/** Finds a player by name, returning the chosen player_id. */
function PlayerPicker({ onPick, label = 'Find a player' }) {
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState([]);

  useEffect(() => {
    if (term.trim().length < 2) { setOptions([]); return; }
    const handle = setTimeout(() => {
      api.suggest(term.trim()).then(setOptions).catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [term]);

  return (
    <div>
      <div className="field">
        <label htmlFor="ad-find">{label}</label>
        <input id="ad-find" type="search" placeholder="Start typing a name…"
               value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      {options.length > 0 && (
        <div className="picker-list">
          {options.map((o) => (
            <button key={o.player_id} type="button" className="ghost small"
                    onClick={() => { onPick(o.player_id); setTerm(''); setOptions([]); }}>
              {o.player_name}
              <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>
                {o.latest_team} · {o.seasons_played} {o.seasons_played === 1 ? 'season' : 'seasons'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------- add tab ---

function AddPlayer({ onAuthLost }) {
  const { meta } = useMeta();
  const [identity, setIdentity] = useState({ full_name: '', born_year: '', nation_id: '' });
  const [season, setSeason] = useState({ season_id: '', league_id: '', team_id: '', position_code: 'MF', age_years: '' });
  const [stats, setStats] = useState(EMPTY_STATS);
  const [teams, setTeams] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (meta?.seasons?.length && !season.season_id) {
      setSeason((s) => ({ ...s, season_id: String(meta.seasons[0].season_id) }));
    }
  }, [meta, season.season_id]);

  // Clubs narrow to the chosen league so the list stays short.
  useEffect(() => {
    if (!season.league_id) { setTeams([]); return; }
    api.teams({ league_id: season.league_id }).then(setTeams).catch(() => setTeams([]));
  }, [season.league_id]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null); setResult(null);
    try {
      const created = await api.adminCreatePlayer({
        full_name: identity.full_name,
        born_year: identity.born_year ? Number(identity.born_year) : undefined,
        nation_id: identity.nation_id ? Number(identity.nation_id) : undefined,
        season: {
          season_id: Number(season.season_id),
          league_id: Number(season.league_id),
          team_id: Number(season.team_id),
          position_code: season.position_code,
          age_years: season.age_years ? Number(season.age_years) : undefined,
          stats: numbersOnly(stats),
        },
      });
      setResult(created);
      setIdentity({ full_name: '', born_year: '', nation_id: '' });
      setStats(EMPTY_STATS);
    } catch (err) {
      if (err.status === 401) return onAuthLost(err.message);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const nations = [...(meta?.nations ?? [])].sort((a, b) => a.code.localeCompare(b.code));

  return (
    <form className="panel" onSubmit={submit}>
      <h3>Add a new player</h3>
      {error && <Message kind="error">{error}</Message>}
      {result && (
        <Message kind="ok">
          Added {result.full_name}. <Link to={`/players/${result.player_id}`}>View profile →</Link>
        </Message>
      )}

      <p className="form-section">Player</p>
      <div className="quick-grid">
        <div className="field span-2">
          <label htmlFor="add-name">Full name *</label>
          <input id="add-name" required maxLength={80} value={identity.full_name}
                 onChange={(e) => setIdentity({ ...identity, full_name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="add-born">Birth year</label>
          <input id="add-born" type="number" min="1950" max="2015" value={identity.born_year}
                 onChange={(e) => setIdentity({ ...identity, born_year: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="add-nation">Nationality</label>
          <select id="add-nation" value={identity.nation_id}
                  onChange={(e) => setIdentity({ ...identity, nation_id: e.target.value })}>
            <option value="">—</option>
            {nations.map((n) => <option key={n.nation_id} value={n.nation_id}>{n.code}</option>)}
          </select>
        </div>
      </div>

      <p className="form-section">First season</p>
      <div className="quick-grid">
        <div className="field">
          <label htmlFor="add-season">Season *</label>
          <select id="add-season" required value={season.season_id}
                  onChange={(e) => setSeason({ ...season, season_id: e.target.value })}>
            {meta?.seasons.map((s) => <option key={s.season_id} value={s.season_id}>{s.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="add-league">League *</label>
          <select id="add-league" required value={season.league_id}
                  onChange={(e) => setSeason({ ...season, league_id: e.target.value, team_id: '' })}>
            <option value="">— choose —</option>
            {meta?.leagues.map((l) => <option key={l.league_id} value={l.league_id}>{l.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="add-team">Club *</label>
          <select id="add-team" required value={season.team_id} disabled={!season.league_id}
                  onChange={(e) => setSeason({ ...season, team_id: e.target.value })}>
            <option value="">{season.league_id ? '— choose —' : 'Pick a league first'}</option>
            {teams.map((t) => <option key={t.team_id} value={t.team_id}>{t.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="add-pos">Position *</label>
          <select id="add-pos" value={season.position_code}
                  onChange={(e) => setSeason({ ...season, position_code: e.target.value })}>
            {meta?.positions.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="add-age">Age</label>
          <input id="add-age" type="number" min="14" max="50" value={season.age_years}
                 placeholder={identity.born_year ? 'from birth year' : ''}
                 onChange={(e) => setSeason({ ...season, age_years: e.target.value })} />
        </div>
      </div>

      <p className="form-section">Season stats</p>
      <StatFields stats={stats} onChange={setStats} prefix="add" />
      <p className="form-hint">
        Per-90 figures, goals + assists and fantasy points are calculated
        automatically from these.
      </p>

      <button className="primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Add player'}
      </button>
    </form>
  );
}

// ------------------------------------------------------- edit tab ---

function EditPlayer({ onAuthLost }) {
  const { meta } = useMeta();
  const [player, setPlayer] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [seasonId, setSeasonId] = useState(null);
  const [seasonForm, setSeasonForm] = useState(null);
  const [teams, setTeams] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async (id, keepSeason) => {
    setError(null);
    try {
      const p = await api.adminPlayer(id);
      setPlayer(p);
      setIdentity({ full_name: p.full_name, born_year: p.born_year ?? '', nation_id: p.nation_id ?? '' });
      const chosen = p.seasons.find((s) => s.player_season_id === keepSeason) ?? p.seasons[0];
      if (chosen) selectSeason(chosen);
    } catch (err) {
      if (err.status === 401) return onAuthLost(err.message);
      setError(err.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onAuthLost]);

  function selectSeason(s) {
    setSeasonId(s.player_season_id);
    setSeasonForm({
      league_id: String(s.league_id),
      team_id: String(s.team_id),
      position_code: s.position_code ?? 'MF',
      age_years: s.age_years ?? '',
      stats: Object.fromEntries(STAT_INPUTS.map(([k]) => [k, s[k] ?? ''])),
    });
  }

  useEffect(() => {
    if (!seasonForm?.league_id) { setTeams([]); return; }
    api.teams({ league_id: seasonForm.league_id }).then(setTeams).catch(() => setTeams([]));
  }, [seasonForm?.league_id]);

  async function saveIdentity(e) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.adminUpdatePlayer(player.player_id, {
        full_name: identity.full_name,
        born_year: identity.born_year === '' ? null : Number(identity.born_year),
        nation_id: identity.nation_id === '' ? null : Number(identity.nation_id),
      });
      setNotice('Player details saved.');
      await load(player.player_id, seasonId);
    } catch (err) {
      if (err.status === 401) return onAuthLost(err.message);
      setError(err.message);
    } finally { setBusy(false); }
  }

  async function saveSeason(e) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await api.adminUpdateSeason(seasonId, {
        league_id: Number(seasonForm.league_id),
        team_id: Number(seasonForm.team_id),
        position_code: seasonForm.position_code,
        age_years: seasonForm.age_years === '' ? null : Number(seasonForm.age_years),
        stats: numbersOnly(seasonForm.stats),
      });
      setNotice(`Season saved. Fantasy points are now ${num(res.total_points, 1)}.`);
      await load(player.player_id, seasonId);
    } catch (err) {
      if (err.status === 401) return onAuthLost(err.message);
      setError(err.message);
    } finally { setBusy(false); }
  }

  const nations = [...(meta?.nations ?? [])].sort((a, b) => a.code.localeCompare(b.code));

  return (
    <>
      <div className="panel">
        <h3>Edit a player</h3>
        <PlayerPicker onPick={(id) => { setNotice(null); load(id); }} />
      </div>

      {error && <Message kind="error">{error}</Message>}
      {notice && <Message kind="ok">{notice}</Message>}

      {player && identity && (
        <>
          <form className="panel" onSubmit={saveIdentity}>
            <h3>{player.full_name}</h3>
            <p className="form-section">Player details — shared by every season</p>
            <div className="quick-grid">
              <div className="field span-2">
                <label htmlFor="ed-name">Full name</label>
                <input id="ed-name" required maxLength={80} value={identity.full_name}
                       onChange={(e) => setIdentity({ ...identity, full_name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="ed-born">Birth year</label>
                <input id="ed-born" type="number" min="1950" max="2015" value={identity.born_year}
                       onChange={(e) => setIdentity({ ...identity, born_year: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="ed-nation">Nationality</label>
                <select id="ed-nation" value={identity.nation_id}
                        onChange={(e) => setIdentity({ ...identity, nation_id: e.target.value })}>
                  <option value="">—</option>
                  {nations.map((n) => <option key={n.nation_id} value={n.nation_id}>{n.code}</option>)}
                </select>
              </div>
            </div>
            <button className="primary" type="submit" disabled={busy} style={{ marginTop: 12 }}>
              Save player details
            </button>
          </form>

          {player.seasons.length > 0 && seasonForm && (
            <form className="panel" onSubmit={saveSeason}>
              <p className="form-section">Season</p>
              <div className="tabs" style={{ flexWrap: 'wrap' }}>
                {player.seasons.map((s) => (
                  <button key={s.player_season_id} type="button"
                          className={s.player_season_id === seasonId ? 'active' : ''}
                          onClick={() => selectSeason(s)}>
                    {s.season_label} · {s.team_name}
                  </button>
                ))}
              </div>

              <div className="quick-grid">
                <div className="field">
                  <label htmlFor="es-league">League</label>
                  <select id="es-league" value={seasonForm.league_id}
                          onChange={(e) => setSeasonForm({ ...seasonForm, league_id: e.target.value, team_id: '' })}>
                    {meta?.leagues.map((l) => <option key={l.league_id} value={l.league_id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="es-team">Club</label>
                  <select id="es-team" required value={seasonForm.team_id}
                          onChange={(e) => setSeasonForm({ ...seasonForm, team_id: e.target.value })}>
                    <option value="">— choose —</option>
                    {teams.map((t) => <option key={t.team_id} value={t.team_id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="es-pos">Position</label>
                  <select id="es-pos" value={seasonForm.position_code}
                          onChange={(e) => setSeasonForm({ ...seasonForm, position_code: e.target.value })}>
                    {meta?.positions.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="es-age">Age</label>
                  <input id="es-age" type="number" min="14" max="50" value={seasonForm.age_years}
                         onChange={(e) => setSeasonForm({ ...seasonForm, age_years: e.target.value })} />
                </div>
              </div>

              <p className="form-section">Stats</p>
              <StatFields stats={seasonForm.stats} prefix="es"
                          onChange={(stats) => setSeasonForm({ ...seasonForm, stats })} />
              <p className="form-hint">Saving recalculates per-90 figures and fantasy points.</p>
              <button className="primary" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save season'}
              </button>
            </form>
          )}
        </>
      )}
    </>
  );
}

// ----------------------------------------------------- delete tab ---

function DeletePlayer({ onAuthLost }) {
  const [player, setPlayer] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function pick(id) {
    setError(null); setResult(null); setConfirming(false);
    try { setPlayer(await api.adminPlayer(id)); } catch (err) {
      if (err.status === 401) return onAuthLost(err.message);
      setError(err.message);
    }
  }

  async function remove() {
    setBusy(true); setError(null);
    try {
      setResult(await api.adminDeletePlayer(player.player_id));
      setPlayer(null);
      setConfirming(false);
    } catch (err) {
      if (err.status === 401) return onAuthLost(err.message);
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="panel">
        <h3>Delete a player</h3>
        <PlayerPicker onPick={pick} label="Find the player to delete" />
      </div>

      {error && <Message kind="error">{error}</Message>}
      {result && (
        <Message kind="ok">
          Deleted {result.deleted}, together with {result.cascaded.seasons} season
          {result.cascaded.seasons === 1 ? '' : 's'}, {result.cascaded.stat_rows} stat row
          {result.cascaded.stat_rows === 1 ? '' : 's'}, {result.cascaded.shortlist_entries} shortlist
          {' '}{result.cascaded.shortlist_entries === 1 ? 'entry' : 'entries'} and {result.cascaded.squad_slots} squad
          {' '}{result.cascaded.squad_slots === 1 ? 'slot' : 'slots'}.
        </Message>
      )}

      {player && (
        <div className="panel danger-zone">
          <h3>{player.full_name}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Season</th><th>Club</th><th>Pos</th>
                  <th style={{ textAlign: 'right' }}>Min</th>
                  <th style={{ textAlign: 'right' }}>G</th>
                  <th style={{ textAlign: 'right' }}>A</th></tr>
              </thead>
              <tbody>
                {player.seasons.map((s) => (
                  <tr key={s.player_season_id}>
                    <td>{s.season_label}</td><td>{s.team_name}</td>
                    <td><PositionChip code={s.position_code} /></td>
                    <td className="num">{int(s.minutes)}</td>
                    <td className="num">{int(s.goals)}</td>
                    <td className="num">{int(s.assists)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 14 }}>
            This permanently deletes the player and all {player.seasons.length} of
            their seasons, including their stats, fantasy points, and any
            shortlist or squad places. It cannot be undone.
          </p>

          {!confirming ? (
            <button className="danger-button" onClick={() => setConfirming(true)}>
              Delete {player.full_name}…
            </button>
          ) : (
            <div className="row">
              <button className="danger-button solid" onClick={remove} disabled={busy}>
                {busy ? 'Deleting…' : `Yes, permanently delete ${player.full_name}`}
              </button>
              <button className="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------ page ---

export default function AdminPage() {
  const [session, setSession] = useState(null);   // null while checking
  const [tab, setTab] = useState('add');
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    api.adminSession()
      .then(setSession)
      .catch(() => setSession({ authenticated: false, configured: true }));
  }, []);

  const onAuthLost = useCallback((message) => {
    setNotice(message || 'Your session has ended. Please sign in again.');
    setSession((s) => ({ ...s, authenticated: false }));
  }, []);

  async function logout() {
    await api.adminLogout().catch(() => {});
    setNotice('Signed out.');
    setSession((s) => ({ ...s, authenticated: false }));
  }

  if (!session) return <Loading />;

  return (
    <>
      <div className="page-head">
        <h2>Admin</h2>
        <p>Add, edit and delete players. Everything else in ScoutLens is public.</p>
      </div>

      {!session.authenticated ? (
        <LoginForm
          configured={session.configured !== false}
          notice={notice}
          onLoggedIn={(s) => { setNotice(null); setSession({ authenticated: true, configured: true, ...s }); }}
        />
      ) : (
        <>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              Signed in as <b style={{ color: 'var(--text)' }}>{session.email}</b>
            </span>
            <button className="ghost small" onClick={logout}>Sign out</button>
          </div>

          <div className="tabs" role="tablist">
            {[['add', 'Add player'], ['edit', 'Edit player'], ['delete', 'Delete player']].map(([key, label]) => (
              <button key={key} role="tab" aria-selected={tab === key}
                      className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'add' && <AddPlayer onAuthLost={onAuthLost} />}
          {tab === 'edit' && <EditPlayer onAuthLost={onAuthLost} />}
          {tab === 'delete' && <DeletePlayer onAuthLost={onAuthLost} />}
        </>
      )}
    </>
  );
}
