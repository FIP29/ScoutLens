// Head-to-head comparison of two player-seasons, served by
// sp_compare_players in a single database round trip.
import { useState } from 'react';
import {
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Legend, Tooltip,
} from 'recharts';
import { Loading, Message, PositionChip } from '../components/Bits.jsx';
import { api } from '../lib/api.js';
import { int, num } from '../lib/format.js';

// Rows shown in the comparison table: [label, field, decimal places].
const ROWS = [
  ['Club', 'team_name'], ['League', 'league_name'], ['Season', 'season_label'],
  ['Age', 'age_years'], ['Appearances', 'matches_played'], ['Starts', 'starts'],
  ['Minutes', 'minutes'], ['Goals', 'goals'], ['Assists', 'assists'],
  ['Goals + assists', 'goals_assists'], ['Goals per 90', 'goals_per90', 2],
  ['Assists per 90', 'assists_per90', 2], ['Shots', 'shots'],
  ['Shots on target', 'shots_on_target'], ['Yellow cards', 'cards_yellow'],
  ['Red cards', 'cards_red'], ['Clean sheets', 'clean_sheets'], ['Saves', 'saves'],
  ['Fantasy points', 'total_points', 1], ['Points per 90', 'points_per90', 2],
];

function PlayerPicker({ side, onPick, chosen }) {
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [searching, setSearching] = useState(false);

  async function search() {
    if (term.trim().length < 2) return;
    setSearching(true);
    try {
      setOptions(await api.suggest(term));
      setSeasons([]);
    } finally {
      setSearching(false);
    }
  }

  // The season dropdown needs player_season_ids, which the suggest
  // endpoint does not carry, so the player's seasons are fetched through
  // search and then narrowed to this exact player id (two people can
  // share a name).
  async function pickPlayer(playerId) {
    const chosenName = options.find((o) => o.player_id === playerId)?.player_name;
    if (!chosenName) return;
    const { rows } = await api.search({
      filters: [{ field: 'player_name', op: 'like', value: chosenName }],
      sort: 'season_label',
      dir: 'desc',
      pageSize: 100,
    });
    setSeasons(rows.filter((r) => r.player_id === playerId));
    setOptions([]);
  }

  return (
    <div className="panel">
      <h3>{side} player</h3>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Search by name</label>
          <input
            value={term}
            placeholder="e.g. Bellingham"
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
        </div>
        <button onClick={search} disabled={searching}>Find</button>
      </div>

      {options.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {options.map((o) => (
            <button
              key={o.player_id}
              className="small ghost"
              style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }}
              onClick={() => pickPlayer(o.player_id)}
            >
              {o.player_name} — {o.latest_team} ({o.goals}G {o.assists}A)
            </button>
          ))}
        </div>
      )}

      {seasons.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="field">
            <label>Choose a season</label>
            <select onChange={(e) => onPick(Number(e.target.value))} defaultValue="">
              <option value="" disabled>— select season —</option>
              {seasons.map((s) => (
                <option key={s.player_season_id} value={s.player_season_id}>
                  {s.season_label} · {s.team_name} · {s.goals}G {s.assists}A
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {chosen && (
        <p style={{ marginTop: 10, color: 'var(--accent)', fontSize: 13 }}>
          Selected: {chosen.player_name} — {chosen.season_label}
        </p>
      )}
    </div>
  );
}

export default function ComparePage() {
  const [leftId, setLeftId] = useState(null);
  const [rightId, setRightId] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function compare(l = leftId, r = rightId) {
    if (!l || !r) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.compare(l, r));
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  // Per-90 radar puts two players on a common scale despite unequal minutes.
  const radarData = result ? [
    ['Goals /90', 'goals_per90'], ['Assists /90', 'assists_per90'],
    ['Shots /90', 'shots_per90'], ['Points /90', 'points_per90'],
  ].map(([axis, field]) => ({
    axis,
    left: Number(result.left?.[field] ?? 0),
    right: Number(result.right?.[field] ?? 0),
  })) : [];

  return (
    <>
      <div className="page-head">
        <h2>Compare players</h2>
        <p>Pick any two player-seasons from the database and set them side by side.</p>
      </div>

      <div className="grid cols-2">
        <PlayerPicker side="Left" onPick={(id) => { setLeftId(id); compare(id, rightId); }} chosen={result?.left} />
        <PlayerPicker side="Right" onPick={(id) => { setRightId(id); compare(leftId, id); }} chosen={result?.right} />
      </div>

      {error && <Message kind="error">{error}</Message>}
      {busy && <Loading />}

      {result && (
        <>
          <div className="panel">
            <h3>Per-90 profile</h3>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#2b3945" />
                <PolarAngleAxis dataKey="axis" stroke="#8b9cad" fontSize={11} />
                <PolarRadiusAxis stroke="#2b3945" fontSize={10} />
                <Tooltip contentStyle={{ background: '#1e2833', border: '1px solid #2b3945', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Radar name={result.left?.player_name} dataKey="left" stroke="#4ade80" fill="#4ade80" fillOpacity={0.3} />
                <Radar name={result.right?.player_name} dataKey="right" stroke="#3d84c6" fill="#3d84c6" fillOpacity={0.3} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          <div className="panel">
            <h3>Side by side</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th style={{ textAlign: 'right' }}>
                      {result.left?.player_name} <PositionChip code={result.left?.position_code} />
                    </th>
                    <th style={{ textAlign: 'right' }}>
                      {result.right?.player_name} <PositionChip code={result.right?.position_code} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map(([label, field, digits]) => {
                    const l = result.left?.[field];
                    const r = result.right?.[field];
                    const numeric = typeof l === 'number' || typeof r === 'number';
                    const leftWins = numeric && Number(l) > Number(r);
                    const rightWins = numeric && Number(r) > Number(l);
                    const fmt = (v) => (numeric ? (digits ? num(v, digits) : int(v)) : (v ?? '—'));
                    return (
                      <tr key={field}>
                        <td style={{ color: 'var(--text-dim)' }}>{label}</td>
                        <td className="num" style={{ color: leftWins ? 'var(--accent)' : undefined, fontWeight: leftWins ? 600 : 400 }}>
                          {fmt(l)}
                        </td>
                        <td className="num" style={{ color: rightWins ? 'var(--accent)' : undefined, fontWeight: rightWins ? 600 : 400 }}>
                          {fmt(r)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
