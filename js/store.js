/* ============================================================================
   store.js · tiny persisted state container (localStorage, failure-tolerant)
   Everything the widget "is" lives here: task, model, backend, examples, rules,
   version and history. The export panel serialises this object.
   ========================================================================== */
window.PF = window.PF || {};

PF.Store = (() => {
  const KEY = 'pocketforge.v1';

  const defaults = () => ({
    task: '',
    modelId: 'smollm2-360m',
    backend: 'sim',            // 'sim' | 'real'
    forged: false,
    version: [1, 0, 0],        // [major, minor, patch]
    examples: [],              // [{input, output}]
    rules: [],                 // [string]
    history: [],               // [{version, at, note}]
    tests: [],                 // held-out cases [{input, expected}] from the starter pack
    lastTest: null,            // latest self-test result
    prevScore: null,           // score before the latest patch (for the delta)
    packLabel: null,           // which starter pack auto-taught the widget
  });

  const listeners = [];
  let state = load();

  function load() {
    try { return { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
    catch { return defaults(); }               // private mode / corrupt JSON
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } }
  function emit() { listeners.forEach(fn => fn(state)); }

  return {
    get: () => state,
    set(patch) { Object.assign(state, patch); save(); emit(); },
    onChange(fn) { listeners.push(fn); },
    reset() { state = defaults(); save(); emit(); },
    versionString: (v = state.version) => 'v' + v.join('.'),
  };
})();
