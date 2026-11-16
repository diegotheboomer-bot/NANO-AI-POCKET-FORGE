/* ============================================================================
   tester.js · self-test harness
   Test set = held-out cases saved at forge time + leave-one-out checks on the
   most recent training examples (the example is removed from context, then the
   widget must reproduce it). Works with both the sim and real backends.
   Scoring: JSON outputs → fraction of expected keys matched; plain text →
   token overlap. A case "passes" at ≥ 75%.
   ========================================================================== */
window.PF = window.PF || {};

PF.Tester = (() => {
  const PASS = 0.75, MAX_LOO = 6;
  const norm = v => (v == null ? 'null' : String(v)).trim().toLowerCase();

  /** Models sometimes wrap JSON in ``` fences or prose; pull out the first {...}. */
  function parseObj(text) {
    try { const v = JSON.parse(text); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* try extraction */ }
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* not JSON */ } }
    return null;
  }

  /** 0..1 similarity between expected and actual output. */
  function score(expected, got) {
    const e = parseObj(expected);
    if (e) {
      const g = parseObj(got); if (!g) return 0;
      const keys = Object.keys(e);
      return keys.filter(k => norm(g[k]) === norm(e[k])).length / (keys.length || 1);
    }
    const tok = s => new Set(String(s).toLowerCase().match(/[a-z0-9]+/g) || []);
    const a = tok(expected), b = tok(got); let i = 0; a.forEach(t => b.has(t) && i++);
    return (a.size + b.size - i) ? i / (a.size + b.size - i) : 0;
  }

  /**
   * Run every case through the widget.
   * @param {object} state   a PF.Store-shaped state (may be a temp copy)
   * @param {(done:number,total:number)=>void} onProgress
   */
  async function run(state, onProgress = () => {}) {
    const held = (state.tests || []).map(t => ({ kind: 'held-out', input: t.input, expected: t.expected, ctx: state }));
    const loo = state.examples.slice(-MAX_LOO).map(e => ({
      kind: 'example', input: e.input, expected: e.output,
      ctx: { ...state, examples: state.examples.filter(x => x !== e) },
    }));
    const cases = [...held, ...loo], out = [];
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      let got; try { got = (await PF.Engine.run(c.ctx, c.input)).text; } catch (err) { got = 'ERROR: ' + (err.message || err); }
      const s = score(c.expected, got);
      out.push({ kind: c.kind, input: c.input, expected: c.expected, got, score: s, pass: s >= PASS });
      onProgress(i + 1, cases.length);
    }
    const total = out.length, passed = out.filter(c => c.pass).length;
    return { at: Date.now(), total, passed, score: total ? out.reduce((a, c) => a + c.score, 0) / total : null, cases: out };
  }

  return { run, score, PASS };
})();
