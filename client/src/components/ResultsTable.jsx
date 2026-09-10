// Sortable, paginated results grid shared by the search and shortlist views.
import { PlayerLink, PositionChip } from './Bits.jsx';
import { int, num } from '../lib/format.js';

const COLUMNS = [
  { key: 'player_name', label: 'Player', sortable: true },
  { key: 'position_code', label: 'Pos', sortable: true },
  { key: 'age_years', label: 'Age', sortable: true, numeric: true },
  { key: 'team_name', label: 'Club', sortable: true },
  { key: 'league_name', label: 'League', sortable: true },
  { key: 'season_label', label: 'Season', sortable: true },
  { key: 'matches_played', label: 'MP', sortable: true, numeric: true },
  { key: 'minutes', label: 'Min', sortable: true, numeric: true },
  { key: 'goals', label: 'G', sortable: true, numeric: true },
  { key: 'assists', label: 'A', sortable: true, numeric: true },
  { key: 'goals_per90', label: 'G/90', sortable: true, numeric: true, digits: 2 },
  { key: 'shots_on_target', label: 'SoT', numeric: true },
  { key: 'clean_sheets', label: 'CS', sortable: true, numeric: true },
  { key: 'saves', label: 'Saves', sortable: true, numeric: true },
  { key: 'total_points', label: 'FPts', sortable: true, numeric: true, digits: 1 },
];

export default function ResultsTable({ rows, sort, dir, onSort, actionLabel, onAction }) {
  if (!rows?.length) {
    return <div className="empty">No player-seasons match these criteria.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={col.sortable ? 'sortable' : undefined}
                style={col.numeric ? { textAlign: 'right' } : undefined}
                onClick={col.sortable ? () => onSort(col.key) : undefined}
              >
                {col.label}
                {sort === col.key && <span className="arrow">{dir === 'asc' ? '▲' : '▼'}</span>}
              </th>
            ))}
            {onAction && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.player_season_id}>
              <td>
                <PlayerLink
                  id={row.player_id}
                  name={row.player_name}
                  nationCode={row.nation_code}
                  flagCode={row.flag_code}
                />
              </td>
              <td><PositionChip code={row.position_code} /></td>
              <td className="num">{int(row.age_years)}</td>
              <td>{row.team_name}</td>
              <td style={{ color: 'var(--text-dim)' }}>{row.league_name}</td>
              <td style={{ color: 'var(--text-dim)' }}>{row.season_label}</td>
              <td className="num">{int(row.matches_played)}</td>
              <td className="num">{int(row.minutes)}</td>
              <td className="num">{int(row.goals)}</td>
              <td className="num">{int(row.assists)}</td>
              <td className="num">{num(row.goals_per90, 2)}</td>
              <td className="num">{int(row.shots_on_target)}</td>
              <td className="num">{int(row.clean_sheets)}</td>
              <td className="num">{int(row.saves)}</td>
              <td className="num" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                {num(row.total_points, 1)}
              </td>
              {onAction && (
                <td>
                  <button className="small ghost" onClick={() => onAction(row)}>
                    {actionLabel}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
