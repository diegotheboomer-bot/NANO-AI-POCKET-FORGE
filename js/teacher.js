/* ============================================================================
   teacher.js · OPTIONAL "AI Teacher": a stronger cloud/local LLM that helps
   train and QA the tiny on-device widget.
     generate() → starter rules + examples + held-out tests for the task
     diagnose() → why tests fail + new targeted examples/rules
     judge()    → is this one reply correct? what should it have been?
   Providers: Anthropic Messages API, or any OpenAI-compatible endpoint
   (OpenAI, OpenRouter, Ollama / LM Studio on localhost).
   PRIVACY: using it sends the task, rules, examples and the inputs you ask
   about to that provider. The API key lives in sessionStorage (cleared when
   the tab closes) unless "remember" is ticked. It is never exported.
   ========================================================================== */
window.PF = window.PF || {};

PF.Teacher = (() => {
  const CFG_KEY = 'pocketforge.teacher', KEY_KEY = 'pf.teacherKey';
  const defaults = { provider: 'anthropic', model: 'claude-sonnet-5-5', base: 'https://api.openai.com/v1', remember: false };

  const safe = fn => { try { return fn(); } catch { return undefined; } };
  let cfg = { ...defaults, ...(safe(() => JSON.parse(localStorage.getItem(CFG_KEY) || '{}')) || {}) };
  let key = safe(() => sessionStorage.getItem(KEY_KEY) || localStorage.getItem(KEY_KEY)) || '';

  const isLocal = () => cfg.provider === 'openai' && /\/\/(localhost|127\.0\.0\.1)/.test(cfg.base);
  const ready = () => !!key || isLocal();           // local servers usually need no key
  const get = () => ({ ...cfg, hasKey: !!key });

  /** Persist settings; pass newKey (string) to change the key, undefined to leave it. */
  function save(next, newKey) {
    cfg = { ...cfg, ...next };
    safe(() => localStorage.setItem(CFG_KEY, JSON.stringify(cfg)));
    if (newKey !== undefined) {
      key = newKey.trim();
      safe(() => { sessionStorage.removeItem(KEY_KEY); localStorage.removeItem(KEY_KEY); });
      if (key) safe(() => (cfg.remember ? localStorage : sessionStorage).setItem(KEY_KEY, key));
    }
  }
  function forget() { save({}, ''); }

  /** One round-trip. Always resolves to a parsed JSON object or throws a readable Error. */
  async function call(system, user) {
    if (!ready()) throw new Error('Add an API key first.');
    let res;
    try {
      res = cfg.provider === 'anthropic'
        ? await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
            body: JSON.stringify({ model: cfg.model, max_tokens: 4096, system, messages: [{ role: 'user', content: user }] }),
          })
        : await fetch(cfg.base.replace(/\/+$/, '') + '/chat/completions', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) },
            body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
          });
    } catch (e) { throw new Error('Could not reach the provider (network, CORS or blocked). ' + (e.message || '')); }
    if (!res.ok) {
      let detail = ''; try { detail = (await res.json()).error?.message || ''; } catch { /* no body */ }
      throw new Error(`Provider error ${res.status}${res.status === 401 ? ' (check your API key)' : ''}${detail ? ': ' + detail : ''}`);
    }
    const data = await res.json();
    const text = cfg.provider === 'anthropic' ? (data.content || []).map(b => b.text || '').join('') : data.choices?.[0]?.message?.content || '';
    const obj = PF.Monitor.tryObj(text);
    if (!obj) throw new Error('The teacher did not return JSON. Try again.');
    return obj;
  }

  /* ── Normalisers: never trust model output shape ── */
  const str = v => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)).trim().slice(0, 1500);
  const pairs = (arr, a, b, max) => (Array.isArray(arr) ? arr : []).map(x => ({ [a]: str(x?.[a] ?? x?.input), [b]: str(x?.[b] ?? x?.output ?? x?.expected) })).filter(x => x[a] && x[b]).slice(0, max);
  const lines = (arr, max) => (Array.isArray(arr) ? arr : []).map(str).filter(Boolean).slice(0, max);
  const norm = o => ({ notes: str(o.notes || o.diagnosis), rules: lines(o.rules, 6), examples: pairs(o.examples, 'input', 'output', 12), tests: pairs(o.tests, 'input', 'expected', 8) });

  const SYS = 'You help build a tiny on-device AI widget (a 0.5B–1B parameter model). It copies the style of its few-shot examples closely. Reply with ONE JSON object only, no prose, no code fences.';
  const ctx = s => `TASK: ${s.task}\nRULES:\n${s.rules.map(r => '- ' + r).join('\n') || '(none)'}\nCURRENT EXAMPLES (input => output):\n${s.examples.slice(-8).map(e => `${e.input} => ${e.output}`).join('\n') || '(none)'}`;
  const FORMAT = 'Every "output"/"expected" must be a STRING containing exactly what the widget should emit (for JSON tasks, a compact JSON string with the same keys as the current examples; if there are no examples, choose a compact JSON schema and state it in a rule).';

  const generate = async s => norm(await call(SYS,
    `${ctx(s)}\n\nCreate: 8 diverse, realistic training examples (include messy text, missing info → null, and ambiguous cases), 4 held-out tests that are NOT copies of the examples, and up to 4 short rules.\n${FORMAT}\nReturn {"notes":"one sentence","rules":["..."],"examples":[{"input":"","output":""}],"tests":[{"input":"","expected":""}]}`));

  const diagnose = async (s, fails) => norm(await call(SYS,
    `${ctx(s)}\n\nTHE WIDGET FAILED THESE TESTS:\n${fails.slice(0, 6).map(f => `INPUT: ${f.input}\nEXPECTED: ${f.expected}\nGOT: ${f.got}`).join('\n---\n')}\n\nDiagnose the root cause patterns in one or two sentences ("notes"). Then propose up to 4 rules and up to 6 NEW training examples (different inputs from the failing ones) that teach the pattern.\n${FORMAT}\nReturn {"notes":"","rules":["..."],"examples":[{"input":"","output":""}]}`));

  async function judge(s, input, output) {
    const o = await call(SYS, `${ctx(s)}\n\nINPUT: ${input}\nWIDGET OUTPUT: ${output}\n\nIs the output correct for the task and rules? Return {"correct":true|false,"better":"the correct output as a string (same as the widget output if correct)","reason":"one short sentence"}`);
    return { correct: o.correct === true, better: str(o.better), reason: str(o.reason) };
  }

  return { ready, get, save, forget, call, generate, diagnose, judge };
})();
