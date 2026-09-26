// Thin fetch wrapper. Every call goes through here so error handling and
// the /api prefix live in one place.

async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const api = {
  // above-average performers (public)
  peerStats: () => request('/peers/stats'),
  aboveAverage: (params) => request(`/peers/above-average?${new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== '' && v != null))}`),

  // admin - the session cookie is httpOnly and same-origin, so fetch sends
  // it automatically; nothing here ever touches the token itself
  adminSession: () => request('/admin/session'),
  adminLogin: (email, password) =>
    request('/admin/login', { method: 'POST', body: { email, password } }),
  adminLogout: () => request('/admin/logout', { method: 'POST' }),
  adminPlayer: (id) => request(`/admin/players/${id}`),
  adminCreatePlayer: (body) => request('/admin/players', { method: 'POST', body }),
  adminUpdatePlayer: (id, body) => request(`/admin/players/${id}`, { method: 'PUT', body }),
  adminUpdateSeason: (id, body) =>
    request(`/admin/player-seasons/${id}`, { method: 'PUT', body }),
  adminDeletePlayer: (id) => request(`/admin/players/${id}`, { method: 'DELETE' }),

  meta: () => request('/meta'),
  teams: (params) => request(`/meta/teams?${new URLSearchParams(params)}`),

  search: (body) => request('/players/search', { method: 'POST', body }),
  suggest: (q) => request(`/players/suggest?q=${encodeURIComponent(q)}`),
  player: (id) => request(`/players/${id}`),
  playerSeason: (id) => request(`/players/season/${id}`),

  compare: (left, right) => request(`/compare?left=${left}&right=${right}`),
  leaderboard: (params) => request(`/leaderboard?${new URLSearchParams(params)}`),
  leagues: (params = {}) => request(`/leagues?${new URLSearchParams(params)}`),
  teamSeason: (teamId, seasonId) => request(`/teams/${teamId}/seasons/${seasonId}`),
  rulesets: () => request('/rulesets'),
  activateRuleset: (id) => request(`/rulesets/${id}/activate`, { method: 'POST' }),

  shortlists: () => request('/shortlists'),
  shortlist: (id, params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v != null));
    return request(`/shortlists/${id}${qs.toString() ? `?${qs}` : ''}`);
  },
  createShortlist: (body) => request('/shortlists', { method: 'POST', body }),
  deleteShortlist: (id) => request(`/shortlists/${id}`, { method: 'DELETE' }),
  addToShortlist: (id, body) => request(`/shortlists/${id}/entries`, { method: 'POST', body }),
  removeFromShortlist: (id, psId) =>
    request(`/shortlists/${id}/entries/${psId}`, { method: 'DELETE' }),
  updateShortlistEntry: (id, psId, body) =>
    request(`/shortlists/${id}/entries/${psId}`, { method: 'PATCH', body }),
  moveShortlistEntry: (id, psId, targetId) =>
    request(`/shortlists/${id}/entries/${psId}/move`,
      { method: 'POST', body: { target_shortlist_id: targetId } }),

  squads: () => request('/squads'),
  squad: (id) => request(`/squads/${id}`),
  squadStrength: (id) => request(`/squads/${id}/strength`),
  squadSuggestions: (id, position) =>
    request(`/squads/${id}/suggestions${position ? `?position=${position}` : ''}`),
  autofillSquad: (id) => request(`/squads/${id}/autofill`, { method: 'POST', body: {} }),
  compareSquads: (a, b) => request(`/squads/compare?a=${a}&b=${b}`),
  createSquad: (body) => request('/squads', { method: 'POST', body }),
  deleteSquad: (id) => request(`/squads/${id}`, { method: 'DELETE' }),
  addToSquad: (id, body) => request(`/squads/${id}/players`, { method: 'POST', body }),
  removeFromSquad: (id, psId) => request(`/squads/${id}/players/${psId}`, { method: 'DELETE' }),
};
