/* ============================================================================
   trainer.js · the "growth engine"
   Parses pasted / uploaded training data and commits it to the bundle.
   NOTE: nothing is actually fine-tuned. "Patching" appends the data to the
   adapter shard (examples + rules), which the runtime applies as few-shot
   context. That is the honest, zero-server version of model adaptation.
   Real LoRA training would need a GPU training pipeline outside the browser.
   ========================================================================== */
window.PF = window.PF || {};

PF.Trainer = (() => {
  const clean = s => String(s ?? '').replace(/\\n/g, '\n').trim();
  const asText = v => (typeof v === 'string' ? v : JSON.stringify(v));

  /** Normalise an arbitrary object into {input, output} using common field names. */
  function fromObject(o) {
    const input = o.input ?? o.prompt ?? o.question ?? o.text ?? o.source;
    const output = o.output ?? o.completion ?? o.answer ?? o.response ?? o.target;
    return input != null && output != null ? { input: clean(asText(input)), output: clean(asText(output)) } : null;
  }

  /** Accepts a JSON array / {examples:[…]}, or lines of "input => output". */
  function parseExamples(text) {
    text = (text || '').trim();
    const items = [], errors = [];
    if (!text) return { items, errors };

    if (/^[[{]/.test(text)) {
      try {
        const v = JSON.parse(text);
        (Array.isArray(v) ? v : v.examples || [v]).forEach((o, i) => {
          const ex = o && typeof o === 'object' ? fromObject(o) : null;
          ex ? items.push(ex) : errors.push(`JSON item ${i + 1}: needs input/output fields`);
        });
        return { items, errors };
      } catch { /* not JSON after all → fall through to line mode */ }
    }
    text.split('\n').forEach((line, i) => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const at = line.indexOf('=>');
      if (at < 1) return errors.push(`Line ${i + 1}: missing "=>"`);
      const input = clean(line.slice(0, at)), output = clean(line.slice(at + 2));
      input && output ? items.push({ input, output }) : errors.push(`Line ${i + 1}: empty side`);
    });
    return { items, errors };
  }

  /** Minimal RFC-4180-ish CSV parser (quotes, escaped quotes, newlines in cells). */
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { text[i + 1] === '"' ? (cell += '"', i++) : (q = false); } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim()));
  }

  /** Dispatch by file extension / content. */
  function parseFile(name, text) {
    if (/\.csv$/i.test(name)) {
      const rows = parseCSV(text), items = [], errors = [];
      const head = (rows[0] || []).map(h => h.trim().toLowerCase());
      const ii = head.findIndex(h => /^(input|prompt|question|text)$/.test(h));
      const oi = head.findIndex(h => /^(output|completion|answer|response)$/.test(h));
      const hasHeader = ii >= 0 && oi >= 0;
      rows.slice(hasHeader ? 1 : 0).forEach((r, i) => {
        const a = clean(r[hasHeader ? ii : 0]), b = clean(r[hasHeader ? oi : 1]);
        a && b ? items.push({ input: a, output: b }) : errors.push(`Row ${i + 1}: needs two columns`);
      });
      return { items, errors };
    }
    return parseExamples(text);
  }

  const parseRules = text => (text || '').split('\n').map(l => l.replace(/^\s*[-*•\d.)]+\s*/, '').trim()).filter(Boolean);

  /**
   * Commit new knowledge to the store.
   * New examples → minor bump (1.0.0 → 1.1.0); rules only → patch bump (1.1.0 → 1.1.1).
   * Returns a summary, or null if nothing new was added (de-duplicated).
   */
  function commit(store, examples, rules) {
    const s = store.get();
    const seen = new Set(s.examples.map(e => e.input + '\u0000' + e.output));
    const newEx = examples.filter(e => !seen.has(e.input + '\u0000' + e.output));
    const newRules = rules.filter(r => !s.rules.includes(r));
    if (!newEx.length && !newRules.length) return null;

    const [maj, min, pat] = s.version;
    const version = newEx.length ? [maj, min + 1, 0] : [maj, min, pat + 1];
    const note = [newEx.length && `+${newEx.length} example${newEx.length > 1 ? 's' : ''}`, newRules.length && `+${newRules.length} rule${newRules.length > 1 ? 's' : ''}`].filter(Boolean).join(', ');
    store.set({
      examples: s.examples.concat(newEx), rules: s.rules.concat(newRules), version,
      history: [{ version: version.join('.'), at: Date.now(), note }, ...s.history],
    });
    return { note, version };
  }

  return { parseExamples, parseFile, parseRules, commit };
})();
