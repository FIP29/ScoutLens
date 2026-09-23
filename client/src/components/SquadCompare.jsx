// ---------------------------------------------------------------------
// Head-to-head between two saved squads.
//
// Every number shown here is computed by MySQL in sp_compare_squads: the
// attack and defence indices, the expected goals, the outcome
// probabilities and the scoreline grid. This component only draws them.
// ---------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Loading, Message, PositionChip } from './Bits.jsx';
import { api } from '../lib/api.js';
import { int, num } from '../lib/format.js';

const A_COLOUR = '#4ade80';
const B_COLOUR = '#3d84c6';
const DRAW_COLOUR = '#64748b';

/** A single 0-5 scoreline heat cell. */
function gridCell(pct, max) {
  const intensity = max > 0 ? pct / max : 0;
  return {
    background: `color-mix(in srgb, var(--accent) ${Math.round(intensity * 70)}%, var(--surface-2))`,
    color: intensity > 0.55 ? '#06240f' : 'var(--text)',
  };
}

export default function SquadCompare({ squads }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Default to the two most recent squads so the page opens with a result.
  useEffect(() => {
    if (squads.length >= 2 && !a && !b) {
      setA(String(squads[0].squad_id));
      setB(String(squads[1].squad_id));
    }
  }, [squads, a, b]);

  useEffect(() => {
    if (!a || !b || a === b) { setData(null); return; }
    let cancelled = false;
    setBusy(true);
    setError(null);
    api.compareSquads(a, b)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) { setError(err.message); setData(null); } })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [a, b]);

  if (squads.length < 2) {
    return (
      <div className="panel">
        <h3>Head to head</h3>
        <div className="empty">
          Build at least two squads to compare them.
        </div>
      </div>
    );
  }

  const c = data?.comparison;
  const maxCell = data ? Math.max(...data.grid.map((g) => g.pct)) : 0;

  return (
    <>
      <div className="panel">
        <h3>Head to head</h3>
        <div className="row">
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="cmp-a">Squad A</label>
            <select id="cmp-a" value={a} onChange={(e) => setA(e.target.value)}>
              <option value="">— select —</option>
              {squads.map((s) => (
                <option key={s.squad_id} value={s.squad_id}>
                  {s.name} ({s.season_label})
                </option>
              ))}
            </select>
          </div>
          <div style={{ alignSelf: 'center', color: 'var(--text-dim)', fontSize: 13 }}>vs</div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="cmp-b">Squad B</label>
            <select id="cmp-b" value={b} onChange={(e) => setB(e.target.value)}>
              <option value="">— select —</option>
              {squads.map((s) => (
                <option key={s.squad_id} value={s.squad_id}>
                  {s.name} ({s.season_label})
                </option>
              ))}
            </select>
          </div>
        </div>
        {a && b && a === b && (
          <p style={{ marginTop: 10, marginBottom: 0, fontSize: 13, color: 'var(--text-dim)' }}>
            Pick two different squads.
          </p>
        )}
      </div>

      {error && <Message kind="error">{error}</Message>}
      {busy && <Loading>Simulating…</Loading>}

      {c && !busy && (
        <>
          {/* ------------------------------------------- outcome bar */}
          <div className="panel">
            <h3>Predicted outcome</h3>

            <div className="h2h-head">
              <div className="side">
                <div className="nm" style={{ color: A_COLOUR }}>{c.squad_a_name}</div>
                <div className="xg">{num(c.expected_goals_a, 2)} xG</div>
              </div>
              <div className="score">
                {c.likeliest_score}
                <span>likeliest · {num(c.likeliest_score_pct, 1)}%</span>
              </div>
              <div className="side right">
                <div className="nm" style={{ color: B_COLOUR }}>{c.squad_b_name}</div>
                <div className="xg">{num(c.expected_goals_b, 2)} xG</div>
              </div>
            </div>

            <div className="outcome-bar" role="img"
                 aria-label={`${c.squad_a_name} win ${c.pct_a_win} percent, draw ${c.pct_draw} percent, ${c.squad_b_name} win ${c.pct_b_win} percent`}>
              <div style={{ width: `${c.pct_a_win}%`, background: A_COLOUR }}>
                {c.pct_a_win >= 8 && `${num(c.pct_a_win, 1)}%`}
              </div>
              <div style={{ width: `${c.pct_draw}%`, background: DRAW_COLOUR }}>
                {c.pct_draw >= 8 && `${num(c.pct_draw, 1)}%`}
              </div>
              <div style={{ width: `${c.pct_b_win}%`, background: B_COLOUR }}>
                {c.pct_b_win >= 8 && `${num(c.pct_b_win, 1)}%`}
              </div>
            </div>
            <div className="outcome-key">
              <span><i style={{ background: A_COLOUR }} /> {c.squad_a_name} win {num(c.pct_a_win, 1)}%</span>
              <span><i style={{ background: DRAW_COLOUR }} /> Draw {num(c.pct_draw, 1)}%</span>
              <span><i style={{ background: B_COLOUR }} /> {c.squad_b_name} win {num(c.pct_b_win, 1)}%</span>
            </div>
          </div>

          {/* ------------------------------------------- the ratings */}
          <div className="panel">
            <h3>Where the difference comes from</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rating</th>
                    <th style={{ textAlign: 'right' }}>{c.squad_a_name}</th>
                    <th style={{ textAlign: 'right' }}>{c.squad_b_name}</th>
                    <th>What it means</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Attack index</td>
                    <td className="num" style={{ color: c.squad_a_attack > c.squad_b_attack ? 'var(--accent)' : undefined }}>
                      {num(c.squad_a_attack, 2)}
                    </td>
                    <td className="num" style={{ color: c.squad_b_attack > c.squad_a_attack ? 'var(--accent)' : undefined }}>
                      {num(c.squad_b_attack, 2)}
                    </td>
                    <td style={{ color: 'var(--text-dim)', whiteSpace: 'normal' }}>
                      Goal involvement per 90 vs an average XI. 1.00 is league average; higher is better.
                    </td>
                  </tr>
                  <tr>
                    <td>Defence index</td>
                    <td className="num" style={{ color: c.squad_a_defence < c.squad_b_defence ? 'var(--accent)' : undefined }}>
                      {num(c.squad_a_defence, 2)}
                    </td>
                    <td className="num" style={{ color: c.squad_b_defence < c.squad_a_defence ? 'var(--accent)' : undefined }}>
                      {num(c.squad_b_defence, 2)}
                    </td>
                    <td style={{ color: 'var(--text-dim)', whiteSpace: 'normal' }}>
                      Goals conceded while these players were on the pitch. <b>Lower is better.</b>
                    </td>
                  </tr>
                  <tr>
                    <td>Keeper save %</td>
                    <td className="num">{c.squad_a_save_pct ? num(c.squad_a_save_pct, 1) : '—'}</td>
                    <td className="num">{c.squad_b_save_pct ? num(c.squad_b_save_pct, 1) : '—'}</td>
                    <td style={{ color: 'var(--text-dim)', whiteSpace: 'normal' }}>
                      Only counts if a goalkeeper is in the XI.
                    </td>
                  </tr>
                  <tr>
                    <td>Avg fantasy points</td>
                    <td className="num">{num(c.squad_a_form, 1)}</td>
                    <td className="num">{num(c.squad_b_form, 1)}</td>
                    <td style={{ color: 'var(--text-dim)', whiteSpace: 'normal' }}>
                      Not used by the model — shown for context.
                    </td>
                  </tr>
                  <tr>
                    <td>Players rated</td>
                    <td className="num">{int(c.squad_a_starters)}</td>
                    <td className="num">{int(c.squad_b_starters)}</td>
                    <td style={{ color: 'var(--text-dim)', whiteSpace: 'normal' }}>
                      Bench players are excluded from the rating.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ------------------------------------------- scoreline grid */}
          <div className="panel">
            <h3>Scoreline probabilities</h3>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 0 }}>
              Chance of each exact result, from a Poisson distribution over both
              expected-goal figures. Rows are {c.squad_a_name}, columns are {c.squad_b_name}.
            </p>
            <div className="table-wrap">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th />
                    {[0, 1, 2, 3, 4, 5].map((n) => <th key={n}>{n}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2, 3, 4, 5].map((ga) => (
                    <tr key={ga}>
                      <th>{ga}</th>
                      {[0, 1, 2, 3, 4, 5].map((gb) => {
                        const cell = data.grid.find(
                          (g) => g.goals_a === ga && g.goals_b === gb);
                        const pct = cell?.pct ?? 0;
                        return (
                          <td key={gb} style={gridCell(pct, maxCell)}
                              title={`${ga}-${gb}: ${num(pct, 2)}%`}>
                            {pct >= 0.5 ? num(pct, 1) : ''}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ------------------------------------------- the two XIs */}
          <div className="grid cols-2">
            {['a', 'b'].map((side) => (
              <div className="panel" key={side}>
                <h3 style={{ color: side === 'a' ? A_COLOUR : B_COLOUR }}>
                  {side === 'a' ? c.squad_a_name : c.squad_b_name}
                </h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th><th>Pos</th>
                        <th style={{ textAlign: 'right' }}>Atk/90</th>
                        <th style={{ textAlign: 'right' }}>Conc/90</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.lineups[side].map((p) => (
                        <tr key={p.player_name + p.team_name}>
                          <td>{p.player_name}</td>
                          <td><PositionChip code={p.position_code} /></td>
                          <td className="num">{num(p.attack_per90, 2)}</td>
                          <td className="num">{num(p.conceded_per90, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          <div className="msg info" style={{ marginTop: 16 }}>
            <b>How to read this.</b> The model rates each XI from its players'
            season statistics, then treats goals as a Poisson process — the
            standard way football scorelines are modelled. It knows nothing
            about form, fitness, tactics or home advantage, so read it as
            “which squad is stronger, and by how much”, not as a real match
            prediction.
          </div>
        </>
      )}
    </>
  );
}
