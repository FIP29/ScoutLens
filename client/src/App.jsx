import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { MetaProvider } from './lib/MetaContext.jsx';
import SearchPage from './pages/SearchPage.jsx';
import PlayerPage from './pages/PlayerPage.jsx';
import ComparePage from './pages/ComparePage.jsx';
import LeaderboardPage from './pages/LeaderboardPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ShortlistPage from './pages/ShortlistPage.jsx';
import SquadPage from './pages/SquadPage.jsx';

const NAV = [
  ['/dashboard', 'Dashboard'],
  ['/search', 'Player search'],
  ['/compare', 'Compare'],
  ['/leaderboard', 'Fantasy board'],
  ['/shortlists', 'Shortlists'],
  ['/squads', 'Squad builder'],
];

export default function App() {
  return (
    <MetaProvider>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <h1>Scout<span>Lens</span></h1>
            <p>Big 5 European Leagues · 2020–2026</p>
          </div>
          <nav className="nav">
            {NAV.map(([to, label]) => (
              <NavLink key={to} to={to}>{label}</NavLink>
            ))}
          </nav>
        </aside>

        <main className="main">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/players/:playerId" element={<PlayerPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/shortlists" element={<ShortlistPage />} />
            <Route path="/squads" element={<SquadPage />} />
            <Route path="*" element={<div className="empty">Page not found.</div>} />
          </Routes>
        </main>
      </div>
    </MetaProvider>
  );
}
