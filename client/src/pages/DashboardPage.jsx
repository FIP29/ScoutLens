// Landing view: database scale, league totals per season, and the
// goal-scoring trend across the six seasons in the dataset.
import { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Loading, Message, Stat } from '../components/Bits.jsx';
import { api } from '../lib/api.js';
import { useMeta } from '../lib/MetaContext.jsx';
import { int, num } from '../lib/format.js';

const LEAGUE_COLOURS = {
  'Premier League': '#4ade80',
  'La Liga': '#f87171',
  'Serie A': '#60a5fa',
  Bundesliga: '#fbbf24',
  'Ligue 1': '#c084fc',
};

const tooltipStyle = {
  background: '#1e2833', border: '1px solid #2b3945', borderRadius: 8, fontSize: 12,
};

export default function DashboardPage() {
  const { meta, loading, error } = useMeta();
  const [leagues, setLeagues] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    api.leagues().then(setLeagues).catch((err) => setLoadError(err.message));
  }, []);

  if (loading) return <Loading />;
  if (error) {
    return (
      <Message kind="error">
        Could not reach the API: {error}. Check that the Express server is running
        and that MySQL is up.
      </Message>
    );
  }

  // Pivot league rows into one record per season for the grouped charts.
  const bySeason = {};
  for (const row of leagues ?? []) {
    bySeason[row.season_label] ??= { season: row.season_label, start_year: row.start_year };
    bySeason[row.season_label][row.league_name] = row.goals;
  }
  const seasonSeries = Object.values(bySeason).sort((a, b) => a.start_year - b.start_year);
  const leagueNames = [...new Set((leagues ?? []).map((l) => l.league_name))];

  const latest = (leagues ?? []).filter(
    (l) => l.season_label === meta?.seasons[0]?.label);

  return (
    <>
      <div className="page-head">
        <h2>Dashboard</h2>
        <p>Scouting database covering the Big 5 European leagues, 2020–21 to 2025–26.</p>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Player-seasons" value={int(meta.totals.player_seasons)} sub="rows in the fact table" />
        <Stat label="Players" value={int(meta.totals.players)} sub="distinct identities" />
        <Stat label="Clubs" value={int(meta.totals.teams)} />
        <Stat label="Seasons" value={int(meta.totals.seasons)} sub={`${meta.totals.leagues} leagues`} />
      </div>

      {loadError && <Message kind="error">{loadError}</Message>}
      {!leagues && !loadError && <Loading />}

      {leagues && (
        <>
          <div className="panel">
            <h3>Goals per league, by season</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={seasonSeries} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
                <CartesianGrid stroke="#2b3945" strokeDasharray="3 3" />
                <XAxis dataKey="season" stroke="#8b9cad" fontSize={11} />
                <YAxis stroke="#8b9cad" fontSize={11} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {leagueNames.map((name) => (
                  <Bar key={name} dataKey={name} fill={LEAGUE_COLOURS[name] ?? '#64748b'} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid cols-2">
            <div className="panel">
              <h3>Average squad age</h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart
                  data={Object.values(
                    (leagues ?? []).reduce((acc, row) => {
                      acc[row.season_label] ??= { season: row.season_label, start_year: row.start_year };
                      acc[row.season_label][row.league_name] = row.avg_age;
                      return acc;
                    }, {})).sort((a, b) => a.start_year - b.start_year)}
                  margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
                >
                  <CartesianGrid stroke="#2b3945" strokeDasharray="3 3" />
                  <XAxis dataKey="season" stroke="#8b9cad" fontSize={11} />
                  <YAxis stroke="#8b9cad" fontSize={11} domain={['dataMin - 0.5', 'dataMax + 0.5']} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {leagueNames.map((name) => (
                    <Line key={name} type="monotone" dataKey={name}
                      stroke={LEAGUE_COLOURS[name] ?? '#64748b'} strokeWidth={2} dot={{ r: 2 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="panel">
              <h3>Latest season · {meta.seasons[0]?.label}</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>League</th>
                      <th style={{ textAlign: 'right' }}>Clubs</th>
                      <th style={{ textAlign: 'right' }}>Players</th>
                      <th style={{ textAlign: 'right' }}>Goals</th>
                      <th style={{ textAlign: 'right' }}>Avg age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.map((row) => (
                      <tr key={row.league_id}>
                        <td>
                          <span className="chip" style={{ background: LEAGUE_COLOURS[row.league_name] ?? '#64748b' }}>
                            {row.country_code}
                          </span>{' '}
                          {row.league_name}
                        </td>
                        <td className="num">{int(row.teams)}</td>
                        <td className="num">{int(row.players)}</td>
                        <td className="num">{int(row.goals)}</td>
                        <td className="num">{num(row.avg_age, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
