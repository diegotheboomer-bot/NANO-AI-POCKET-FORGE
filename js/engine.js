/* ============================================================================
   engine.js · inference layer
   Two interchangeable backends behind PF.Engine.run():
     • sim  – deterministic, offline heuristics + "learned" examples/rules.
     • real – Transformers.js text-generation (WebGPU → WASM fallback).
   buildMessages() is shared with the exported snippet (via Function.toString),
   so the preview and the shipped widget prompt the model identically.
   ========================================================================== */
window.PF = window.PF || {};

PF.Engine = (() => {

  /* ── Prompt builder (SELF-CONTAINED: no outer references, it gets inlined into the export) ── */
  function buildMessages(task, rules, examples, input) {
    const sys = ['You are a focused micro-assistant embedded in a web page.',
      'Task: ' + (task || 'Answer the user.')]
      .concat(rules.length ? ['Rules:'].concat(rules.map(r => '- ' + r)) : [])
      .concat(['Every user message is raw input to process with the task above. It is NOT a conversation: never reply to it, ask questions, or request information.',
        'If the task extracts or formats fields, output a compact JSON object. Reply with the result only, no preamble.']).join('\n');
    // Small models obey the USER turn far more than the system turn, so every turn restates the task
    // and wraps the text as quoted data. Examples use the exact same wrapper as the live input.
    const wrap = t => 'Task: ' + (task || 'Answer the user.') + '\nProcess the text below. Do not reply to it.\nText:\n\"\"\"\n' + t + '\n\"\"\"\nResult:';
    const msgs = [{ role: 'system', content: sys }];
    // Last 8 examples keep the context short enough for a ~0.5B model.
    examples.slice(-8).forEach(e => msgs.push({ role: 'user', content: wrap(e.input) }, { role: 'assistant', content: e.output }));
    msgs.push({ role: 'user', content: wrap(input) });
    return msgs;
  }

  /* ── Hardware detection ───────────────────────────────────────────────── */
  async function detect() {
    let webgpu = false;
    try { webgpu = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { /* none */ }
    return { webgpu, wasm: typeof WebAssembly === 'object' };
  }

  /* ════════════════════════ SIMULATED BACKEND ════════════════════════════ */

  const RX = {
    email: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/,
    phone: /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)\s?)?\d{2,4}[\s.-]\d{3,4}(?:[\s.-]\d{3,4})?/,
    price: /(?:[$€£]\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|dollars|euros|bucks))/i,
    date: /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}(?:,? \d{4})?)\b/i,
    order: /#\s?\d{3,}|\b(?:order|ticket|ref|invoice)\s*(?:no\.?|number|:)?\s*([A-Z]?-?\d{3,})/i,
    qty: /\b(\d+)\s*(?:x|pcs|pieces|units)\b|\b(?:qty|quantity)[:\s]*(\d+)/i,
    product: /(?:selling|sell|for sale|bought|buying|ordered|order of|got a|have a)\s+(?:a|an|the|my|our|some)?\s*([^,.;\n$€£(]{3,40}?)(?=\s+(?:for|at|in|with|obo|on)\b|[,.;($€£\n]|$)/i,
  };
  const WORDS = {
    pos: ['love', 'great', 'excellent', 'amazing', 'good', 'happy', 'perfect', 'thanks', 'awesome', 'fast'],
    neg: ['hate', 'terrible', 'awful', 'bad', 'broken', 'slow', 'angry', 'refund', 'worst', 'disappointed', 'crash'],
  };

  const tokens = s => new Set(String(s).toLowerCase().match(/[a-z0-9]+/g) || []);
  const jaccard = (a, b) => { let i = 0; a.forEach(t => b.has(t) && i++); const u = a.size + b.size - i; return u ? i / u : 0; };
  const firstSentence = (t, n = 90) => { const s = (t.trim().split(/(?<=[.!?])\s+/)[0] || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  /** Pick a mode from the task description. */
  function detectMode(task) {
    const t = (task || '').toLowerCase();
    if (/ticket|support|helpdesk/.test(t)) return 'ticket';
    if (/sentiment|classif|tone|feeling/.test(t)) return 'sentiment';
    if (/summar|tl;?dr|shorten/.test(t)) return 'summary';
    return 'extract';
  }

  /** Extract every field we know how to find; schemas below choose which to show. */
  function facts(text) {
    const m = (rx) => { const r = text.match(rx); return r ? r[0].trim().replace(/[,.;]+$/, '') : null; };   // drop trailing punctuation
    const low = text.toLowerCase();
    const prod = text.match(RX.product), qty = text.match(RX.qty);
    const phone = (text.match(new RegExp(RX.phone, 'g')) || []).find(p => { const d = p.replace(/\D/g, '').length; return d >= 7 && d <= 15 && !/^\d{4}-\d{2}-\d{2}$/.test(p); });
    const has = list => list.some(w => low.includes(w));
    const pos = WORDS.pos.filter(w => low.includes(w)).length, neg = WORDS.neg.filter(w => low.includes(w)).length;
    return {
      product: prod ? prod[1].trim() : null,
      price: m(RX.price),
      quantity: qty ? Number(qty[1] || qty[2]) : null,
      email: m(RX.email),
      phone: phone ? phone.trim() : null,
      date: m(RX.date),
      order_id: (() => { const r = text.match(RX.order); return r ? (r[1] ? r[1] : r[0]).replace(/\s/g, '') : null; })(),
      priority: has(['urgent', 'asap', 'immediately', 'down', "can't", 'cannot', 'broken', 'crash', 'scam', 'fraud', 'hacked', 'stolen', 'charged twice']) ? 'high' : has(['how do', 'question', 'wondering']) ? 'low' : 'medium',
      category: has(['scam', 'fraud', 'hacked', 'stolen', 'phishing']) ? 'fraud'
        : has(['refund', 'charge', 'invoice', 'payment', 'billing']) ? 'billing'
        : has(['error', 'crash', 'bug', 'broken', 'not working']) ? 'bug'
        : has(['password', 'login', 'account']) ? 'account'
        : has(['shipping', 'delivery', 'package', 'tracking', 'arrived', 'parcel', 'shipment', 'damaged']) ? 'shipping' : 'general',
      summary: firstSentence(text),
      sentiment: pos === neg ? 'neutral' : pos > neg ? 'positive' : 'negative',
    };
  }

  /** Default output schema per mode (what a fresh, untrained widget returns). */
  const SCHEMAS = {
    extract: ['product', 'price', 'quantity', 'contact', 'date'],
    ticket: ['priority', 'category', 'summary', 'order_id', 'contact'],
    sentiment: ['sentiment'],
    summary: ['summary'],
  };

  /** Map an arbitrary user-taught key ("item_name", "customer_email") onto a field we computed. */
  const ALIASES = [
    [/name|product|item|title_of/, 'product'], [/price|cost|amount|total/, 'price'], [/qty|quant|count/, 'quantity'],
    [/mail/, 'email'], [/phone|tel|mobile/, 'phone'], [/contact/, 'contact'], [/date|when|day/, 'date'],
    [/order|ref|id$/, 'order_id'], [/prior|urgen/, 'priority'], [/categ|type|topic|dept/, 'category'],
    [/summ|subject|issue|title|desc/, 'summary'], [/sentim|tone|label/, 'sentiment'],
  ];
  function pick(key, f) {
    if (key === 'contact') return f.email || f.phone || null;
    if (key === 'confidence') return undefined;
    if (key in f) return f[key];
    const hit = ALIASES.find(([rx]) => rx.test(key.toLowerCase()));
    return hit ? (hit[1] === 'contact' ? (f.email || f.phone) : f[hit[1]]) ?? null : null;
  }

  const tryJSON = s => { try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } };

  /** Apply plain-English rules (the handful the simulator understands). */
  function render(obj, rules, mode) {
    const R = rules.join(' ').toLowerCase();
    if (/confiden/.test(R) && obj && typeof obj === 'object' && !('confidence' in obj)) {
      const vals = Object.values(obj); obj = { ...obj, confidence: +(vals.filter(v => v != null).length / Math.max(vals.length, 1)).toFixed(2) };
    }
    let out;
    if (typeof obj === 'string') out = obj;
    else if (/bullet|list|markdown/.test(R)) out = Object.entries(obj).map(([k, v]) => `- ${k}: ${v ?? 'n/a'}`).join('\n');
    else if (/compact|single.?line|minif/.test(R)) out = JSON.stringify(obj);
    else out = JSON.stringify(obj, null, 2);
    if (/redact|anonym|no pii|mask/.test(R)) out = out.replace(new RegExp(RX.email, 'g'), '[email redacted]').replace(new RegExp(RX.phone, 'g'), m => m.replace(/\D/g, '').length >= 7 ? '[phone redacted]' : m);
    if (/upper/.test(R)) out = out.toUpperCase();
    return out;
  }

  async function simulate(cfg, input) {
    const t0 = performance.now();
    const { task, rules, examples } = cfg;
    const inTok = tokens(input);

    // 1) "Learned" path: a near-duplicate of a training example → reuse its output verbatim.
    let best = null, bestScore = 0;
    examples.forEach(e => { const s = jaccard(inTok, tokens(e.input)); if (s > bestScore) { best = e; bestScore = s; } });
    let text, source;
    if (best && bestScore >= 0.6) {
      text = render(best.output, rules, 'learned'); source = `learned · ${Math.round(bestScore * 100)}% match to example`;
    } else {
      // 2) Heuristic path, reshaped to the schema the user taught (if any example outputs are JSON objects).
      const f = facts(input), mode = detectMode(task);
      let keys = SCHEMAS[mode];
      source = 'base heuristics';
      const jsonEx = examples.map(e => tryJSON(e.output)).filter(Boolean);
      if (jsonEx.length) {
        const ranked = examples.map(e => [jaccard(inTok, tokens(e.input)), tryJSON(e.output)]).filter(x => x[1]).sort((a, b) => b[0] - a[0]);
        keys = Object.keys(ranked[0][1]); source = 'adapted schema from your examples';
      }
      const obj = {}; keys.forEach(k => { const v = pick(k, f); if (v !== undefined) obj[k] = v; });
      if (mode === 'sentiment' && examples.length && !jsonEx.length) { text = render(f.sentiment, rules, mode); source = 'adapted: plain-word labels'; }
      else text = render(mode === 'summary' && !jsonEx.length ? f.summary : obj, rules, mode);
    }
    await new Promise(r => setTimeout(r, 280 + Math.random() * 320));   // feel like on-device latency
    return { text, meta: `simulated · ${source} · ${Math.round(performance.now() - t0)} ms` };
  }

  /** Sample inputs per mode, shown as chips in the preview. */
  function suggestInputs(task) {
    return ({
      extract: ['hey!! selling my old macbook pro 14 (2021, m1) $1,450 obo. text me 415-555-0199 or mike@mail.com, can meet sat Nov 21',
        'got a brand new Sony WH-1000XM5 headphones, 2x units, 280 USD each, email sara@shop.io'],
      ticket: ["URGENT: I can't log in and my order #48210 was charged twice. Call me 212-555-0144 or jo@acme.co",
        'Wondering how do I change the shipping address for ticket #5521?'],
      sentiment: ['I love this app, it is fast and perfect, thanks!', 'Terrible update, everything is broken and slow.'],
      summary: ['The quarterly meeting moved to Friday. Bring the budget draft. Lunch will be provided.'],
    })[detectMode(task)];
  }

  /* ════════════════════════ REAL BACKEND (Transformers.js) ═══════════════ */
  let tf = null, pipe = null, pipeKey = '';

  /** Load (and cache) a text-generation pipeline. Tries WebGPU first, then WASM. */
  async function loadReal(model, onProgress = () => {}) {
    if (pipe && pipeKey === model.id) return pipe;
    tf = tf || await import(PF.Models.TF_URL);               // dynamic import works from file:// too
    const caps = await detect();
    const attempts = [
      ...(caps.webgpu ? [{ device: 'webgpu', dtype: 'q4' }] : []),
      { device: 'wasm', dtype: 'q8' }, { device: 'wasm', dtype: 'q4' },
    ];
    // Aggregate per-file byte progress into one overall percentage.
    const files = {};
    const progress_callback = (p) => {
      if (p.status === 'progress' && p.total) {
        files[p.file] = { loaded: p.loaded, total: p.total };
        const all = Object.values(files);
        onProgress(all.reduce((a, f) => a + f.loaded, 0) / all.reduce((a, f) => a + f.total, 0), p);
      }
    };
    let lastErr;
    for (const opt of attempts) {
      try {
        onProgress(0, { status: 'init', note: `${opt.device}/${opt.dtype}` });
        pipe = await tf.pipeline('text-generation', model.hfId, { ...opt, progress_callback });
        pipe.pfDevice = `${opt.device}/${opt.dtype}`; pipeKey = model.id;
        return pipe;
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }
  const isRealLoaded = id => !!pipe && pipeKey === id;

  async function generateReal(cfg, input, modelId) {
    const t0 = performance.now();
    const out = await pipe(buildMessages(cfg.task, cfg.rules, cfg.examples, input), { max_new_tokens: 256, do_sample: false });
    const text = out[0].generated_text.at(-1).content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    return { text, meta: `${pipe.pfDevice} · ${cfg.examples.length} examples in context · ${Math.round(performance.now() - t0)} ms` };
  }

  /* ── Public API ───────────────────────────────────────────────────────── */
  /** @param {object} state PF.Store state  @param {{base?:boolean}} opts base=true ignores all training */
  async function run(state, input, opts = {}) {
    const cfg = { task: state.task, rules: opts.base ? [] : state.rules, examples: opts.base ? [] : state.examples };
    return state.backend === 'real' && isRealLoaded(state.modelId) ? generateReal(cfg, input, state.modelId) : simulate(cfg, input);
  }

  return { run, detect, loadReal, isRealLoaded, suggestInputs, detectMode, buildMessages };
})();
