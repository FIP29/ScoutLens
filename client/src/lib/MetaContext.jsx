// Reference data (seasons, leagues, positions, the filter grammar) is
// fetched once and shared, so every dropdown in the app is populated from
// the database rather than from hard-coded lists in the client.
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const MetaContext = createContext({ meta: null, loading: true, error: null });

export function MetaProvider({ children }) {
  const [state, setState] = useState({ meta: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    api.meta()
      .then((meta) => { if (!cancelled) setState({ meta, loading: false, error: null }); })
      .catch((err) => { if (!cancelled) setState({ meta: null, loading: false, error: err.message }); });
    return () => { cancelled = true; };
  }, []);

  return <MetaContext.Provider value={state}>{children}</MetaContext.Provider>;
}

export const useMeta = () => useContext(MetaContext);
