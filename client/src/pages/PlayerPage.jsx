// Career profile: headline totals, season-by-season trend charts, and the
// season table. Everything here comes from sp_player_trend and
// v_player_career — the client does no aggregation of its own.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Bar, BarChart,
} from 'recharts';
import { Loading, Message, PositionChip, Stat } from '../components/Bits.jsx';
import { api } from '../lib/api.js';
import { flag, int, num } from '../lib/format.js';

const CHART_THEME = {
  grid: '#2b3945',
  axis: '#8b9cad',
  tooltip: {
    background: '#1e2833',
    border: '1px solid #2b3945',
    borderRadius: 8,
    fontSize: 12,
  },
};

export default function PlayerPage() {
  const { playerId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api.player(playerId).then(setData).catch((err) => setError(err.message));
  }, [playerId]);

  if (error) return <Message kind="error">{error}</Message>;
  if (!data) return <Loading />;

  const { career, trend } = data;
  const isKeeper = trend.some((t) => t.position_code === 'GK');

  return (
    <>
      <div className="page-head">
        <h2>{career.player_name}</h2>
        <p>
          {career.nation_code ?? '—'} · born {career.born_year ?? '—'} ·{' '}
          {career.positions} · {career.seasons_played} seasons ·{' '}
          {career.clubs} {career.clubs === 1 ? 'club' : 'clubs'} · last at {career.latest_team}
        </p>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Appearances" value={int(career.matches_played)} sub={`${int(career.minutes)} minutes`} />
        <Stat label="Goals" value={int(career.goals)} sub={`${num(career.goals_per90, 2)} per 90`} />
        <Stat label="Assists" value={int(career.assists)} sub={`${num(career.assists_per90, 2)} per 90`} />
        <Stat label="Goal involvements" value={int(career.goals_assists)} />
      </div>

      <div className="grid cols-2">
        <div className="panel">
          <h3>Output by season</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={CHART_THEME.grid} strokeDasharray="3 3" />
              <XAxis dataKey="season_label" stroke={CHART_THEME.axis} fontSize={11} />
              <YAxis stroke={CHART_THEME.axis} fontSize={11} />
              <Tooltip contentStyle={CHART_THEME.tooltip} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="goals" name="Goals" stroke="#d1495b" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="assists" name="Assists" stroke="#3d84c6" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="panel">
          <h3>{isKeeper ? 'Clean sheets & saves' : 'Minutes & fantasy points'}</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={CHART_THEME.grid} strokeDasharray="3 3" />
              <XAxis dataKey="season_label" stroke={CHART_THEME.axis} fontSize={11} />
              {/* Minutes run to ~3,000 while points top out near 300, so the
                  two series get their own axes instead of one flattening
                  the other into an unreadable sliver. */}
              <YAxis yAxisId="left" stroke={CHART_THEME.axis} fontSize={11} />
              <YAxis yAxisId="right" orientation="right" stroke="#4ade80" fontSize={11} />
              <Tooltip contentStyle={CHART_THEME.tooltip} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {isKeeper ? (
                <>
                  <Bar yAxisId="left" dataKey="clean_sheets" name="Clean sheets" fill="#4c9f70" />
                  <Bar yAxisId="left" dataKey="saves" name="Saves" fill="#e0a458" />
                </>
              ) : (
                <>
                  <Bar yAxisId="left" dataKey="minutes" name="Minutes" fill="#334a5e" />
                  <Bar yAxisId="right" dataKey="total_points" name="Fantasy points" fill="#4ade80" />
                </>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel">
        <h3>Season by season</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Season</th><th>Club</th><th>League</th><th>Pos</th>
                <th style={{ textAlign: 'right' }}>Age</th>
                <th style={{ textAlign: 'right' }}>MP</th>
                <th style={{ textAlign: 'right' }}>Starts</th>
                <th style={{ textAlign: 'right' }}>Min</th>
                <th style={{ textAlign: 'right' }}>G</th>
                <th style={{ textAlign: 'right' }}>A</th>
                <th style={{ textAlign: 'right' }}>G/90</th>
                <th style={{ textAlign: 'right' }}>CS</th>
                <th style={{ textAlign: 'right' }}>Saves</th>
                <th style={{ textAlign: 'right' }}>FPts</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((row, i) => (
                <tr key={`${row.season_label}-${row.team_name}-${i}`}>
                  <td>{row.season_label}</td>
                  <td>{row.team_name}</td>
                  <td style={{ color: 'var(--text-dim)' }}>{row.league_name}</td>
                  <td><PositionChip code={row.position_code} /></td>
                  <td className="num">{int(row.age_years)}</td>
                  <td className="num">{int(row.matches_played)}</td>
                  <td className="num">{int(row.starts)}</td>
                  <td className="num">{int(row.minutes)}</td>
                  <td className="num">{int(row.goals)}</td>
                  <td className="num">{int(row.assists)}</td>
                  <td className="num">{num(row.goals_per90, 2)}</td>
                  <td className="num">{int(row.clean_sheets)}</td>
                  <td className="num">{int(row.saves)}</td>
                  <td className="num" style={{ color: 'var(--accent)' }}>{num(row.total_points, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
