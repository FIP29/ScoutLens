// The main scouting screen: build a filter, run it, page through results,
// and push anything interesting onto a shortlist.
import { useState } from 'react';
import FilterBuilder from '../components/FilterBuilder.jsx';
import ResultsTable from '../components/ResultsTable.jsx';
import { Loading, Message } from '../components/Bits.jsx';
import { api } from '../lib/api.js';
import { useMeta } from '../lib/MetaContext.jsx';

const DEFAULT_FILTERS = [{ field: 'minutes', op: 'gte', value: '900' }];

export default function SearchPage() {
  const { meta } = useMeta();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sort, setSort] = useState('total_points');
  const [dir, setDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [shortlists, setShortlists] = useState([]);
  const [targetList, setTargetList] = useState('');

  async function run(nextPage = 1, nextSort = sort, nextDir = dir) {
    setBusy(true);
    setError(null);
    try {
      // Blank values are dropped so a half-filled row never reaches the API.
      const clean = filters.filter((f) =>
        f.op === 'between'
          ? f.value?.[0] !== '' && f.value?.[1] !== ''
          : f.value !== '' && f.value !== null);

      const data = await api.search({
        filters: clean, sort: nextSort, dir: nextDir, page: nextPage, pageSize: 25,
      });
      setResult(data);
      setPage(nextPage);
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  function handleSort(key) {
    const nextDir = sort === key && dir === 'desc' ? 'asc' : 'desc';
    setSort(key);
    setDir(nextDir);
    run(1, key, nextDir);
  }

  async function loadShortlists() {
    try {
      const lists = await api.shortlists();
      setShortlists(lists);
      if (lists.length && !targetList) setTargetList(String(lists[0].shortlist_id));
    } catch { /* the shortlist panel is optional here */ }
  }

  async function addToShortlist(row) {
    if (!targetList) {
      setNotice({ kind: 'error', text: 'Create a shortlist first, on the Shortlists page.' });
      return;
    }
    try {
      await api.addToShortlist(targetList, { player_season_id: row.player_season_id });
      setNotice({ kind: 'ok', text: `Added ${row.player_name} (${row.season_label}) to the shortlist.` });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
  }

  const pagination = result?.pagination;

  return (
    <>
      <div className="page-head">
        <h2>Player search</h2>
        <p>
          {meta
            ? `${meta.totals.player_seasons.toLocaleString()} player-seasons · ${meta.totals.players.toLocaleString()} players · ${meta.totals.teams} clubs`
            : 'Loading reference data…'}
        </p>
      </div>

      <FilterBuilder
        filters={filters}
        onChange={setFilters}
        onSubmit={() => run(1)}
        onReset={() => { setFilters(DEFAULT_FILTERS); setResult(null); }}
        busy={busy}
      />

      {error && <Message kind="error">{error}</Message>}
      {notice && <Message kind={notice.kind}>{notice.text}</Message>}

      {result && (
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>
              {pagination.total.toLocaleString()} results
            </h3>
            <div className="row">
              <div className="field">
                <label>Add to shortlist</label>
                <select
                  value={targetList}
                  onFocus={loadShortlists}
                  onChange={(e) => setTargetList(e.target.value)}
                >
                  <option value="">— select —</option>
                  {shortlists.map((s) => (
                    <option key={s.shortlist_id} value={s.shortlist_id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {busy ? <Loading /> : (
            <>
              <ResultsTable
                rows={result.rows}
                sort={sort}
                dir={dir}
                onSort={handleSort}
                actionLabel="+ shortlist"
                onAction={addToShortlist}
              />
              <div className="pagination">
                <button
                  className="small"
                  disabled={page <= 1}
                  onClick={() => run(page - 1)}
                >← Prev</button>
                <span>Page {pagination.page} of {pagination.totalPages}</span>
                <button
                  className="small"
                  disabled={page >= pagination.totalPages}
                  onClick={() => run(page + 1)}
                >Next →</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
