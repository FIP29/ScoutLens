// The main scouting screen.
//
// Two ways to search, one code path: the quick bar covers the six things
// scouts look up constantly (name, country, league, position, season,
// club), and the advanced builder handles everything else. Both are
// translated into the same filter list and sent to POST /players/search,
// so the server-side whitelist governs both equally.
import { useEffect, useState } from 'react';
import QuickSearch from '../components/QuickSearch.jsx';
import FilterBuilder from '../components/FilterBuilder.jsx';
import ResultsTable from '../components/ResultsTable.jsx';
import { Loading, Message } from '../components/Bits.jsx';
import { api } from '../lib/api.js';
import { useMeta } from '../lib/MetaContext.jsx';

const EMPTY_QUICK = {
  player_name: '',
  nation_code: '',
  league_id: '',
  position_code: '',
  season_id: '',
  team_id: '',
  min_minutes: '',
};

/** Turns the quick-search bar into the same filter objects the API expects. */
function quickToFilters(quick) {
  const filters = [];
  if (quick.player_name.trim())
    filters.push({ field: 'player_name', op: 'like', value: quick.player_name.trim() });
  if (quick.nation_code)
    filters.push({ field: 'nation_code', op: 'eq', value: quick.nation_code });
  if (quick.league_id)
    filters.push({ field: 'league_id', op: 'eq', value: Number(quick.league_id) });
  if (quick.position_code)
    filters.push({ field: 'position_code', op: 'eq', value: quick.position_code });
  if (quick.season_id)
    filters.push({ field: 'season_id', op: 'eq', value: Number(quick.season_id) });
  if (quick.team_id)
    filters.push({ field: 'team_id', op: 'eq', value: Number(quick.team_id) });
  if (quick.min_minutes !== '')
    filters.push({ field: 'minutes', op: 'gte', value: Number(quick.min_minutes) });
  return filters;
}

/** Drops criteria the user started but never filled in. */
function cleanAdvanced(filters) {
  return filters.filter((f) =>
    f.op === 'between'
      ? f.value?.[0] !== '' && f.value?.[1] !== ''
      : f.value !== '' && f.value !== null && f.value !== undefined);
}

export default function SearchPage() {
  const { meta } = useMeta();
  const [quick, setQuick] = useState(EMPTY_QUICK);
  const [advanced, setAdvanced] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [teams, setTeams] = useState([]);

  const [sort, setSort] = useState('total_points');
  const [dir, setDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [shortlists, setShortlists] = useState([]);
  const [targetList, setTargetList] = useState('');

  // The club dropdown only makes sense once a league or season narrows it.
  useEffect(() => {
    if (!quick.league_id && !quick.season_id) {
      setTeams([]);
      return;
    }
    let cancelled = false;
    const params = {};
    if (quick.league_id) params.league_id = quick.league_id;
    if (quick.season_id) params.season_id = quick.season_id;
    api.teams(params)
      .then((rows) => { if (!cancelled) setTeams(rows); })
      .catch(() => { if (!cancelled) setTeams([]); });
    return () => { cancelled = true; };
  }, [quick.league_id, quick.season_id]);

  useEffect(() => {
    api.shortlists()
      .then((lists) => {
        setShortlists(lists);
        if (lists.length) setTargetList((prev) => prev || String(lists[0].shortlist_id));
      })
      .catch(() => {});
  }, []);

  async function run(nextPage = 1, nextSort = sort, nextDir = dir) {
    setBusy(true);
    setError(null);
    try {
      const filters = [...quickToFilters(quick), ...cleanAdvanced(advanced)];
      const data = await api.search({
        filters, sort: nextSort, dir: nextDir, page: nextPage, pageSize: 25,
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

  // Search as you type. Nothing here needs a button press: a short debounce
  // absorbs keystrokes so a name search fires once the user pauses rather
  // than on every character, and dropdown changes apply immediately.
  useEffect(() => {
    if (!meta) return;
    const handle = setTimeout(() => run(1), quick.player_name ? 350 : 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, quick]);

  function handleSort(key) {
    const nextDir = sort === key && dir === 'desc' ? 'asc' : 'desc';
    setSort(key);
    setDir(nextDir);
    run(1, key, nextDir);
  }

  function clearAll() {
    setQuick(EMPTY_QUICK);
    setAdvanced([]);
    setNotice(null);
    setError(null);
    run(1);
  }

  async function addToShortlist(row) {
    try {
      let listId = targetList;
      let listName = shortlists.find((s) => String(s.shortlist_id) === String(listId))?.name;

      // No lists yet? Make one rather than sending the user away to create
      // it themselves and come back.
      if (!listId) {
        const created = await api.createShortlist({ name: 'My shortlist' });
        listId = String(created.shortlist_id);
        listName = created.name;
        setShortlists(await api.shortlists());
        setTargetList(listId);
      }

      await api.addToShortlist(listId, { player_season_id: row.player_season_id });
      setNotice({
        kind: 'ok',
        text: `Added ${row.player_name} (${row.season_label}) to “${listName ?? 'My shortlist'}”.`,
      });
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

      <QuickSearch
        value={quick}
        onChange={setQuick}
        onSubmit={() => run(1)}
        onClear={clearAll}
        busy={busy}
        teams={teams}
      />

      <div className="panel" style={{ paddingBlock: showAdvanced ? 16 : 10 }}>
        <button
          className="ghost small"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? '▾' : '▸'} Advanced filters
          {advanced.length > 0 && <span className="tag" style={{ marginLeft: 8 }}>{advanced.length}</span>}
        </button>

        {showAdvanced && (
          <div style={{ marginTop: 14 }}>
            <FilterBuilder
              filters={advanced}
              onChange={setAdvanced}
              onSubmit={() => run(1)}
              onReset={() => setAdvanced([])}
              busy={busy}
              embedded
            />
          </div>
        )}
      </div>

      {error && <Message kind="error">{error}</Message>}
      {notice && <Message kind={notice.kind}>{notice.text}</Message>}

      {busy && !result && <Loading>Searching 21,100 player-seasons…</Loading>}

      {result && (
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>
              {pagination.total.toLocaleString()} {pagination.total === 1 ? 'result' : 'results'}
            </h3>
            <div className="field">
              <label htmlFor="sl-target">Add to shortlist</label>
              <select id="sl-target" value={targetList}
                      onChange={(e) => setTargetList(e.target.value)}>
                <option value="">
                  {shortlists.length ? '— select —' : 'Creates “My shortlist”'}
                </option>
                {shortlists.map((s) => (
                  <option key={s.shortlist_id} value={s.shortlist_id}>{s.name}</option>
                ))}
              </select>
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
                <button className="small" disabled={page <= 1} onClick={() => run(page - 1)}>
                  ← Prev
                </button>
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
