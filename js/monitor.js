/* ============================================================================
   monitor.js · issue detection for every reply
   The expected output "shape" is LEARNED from the training examples (their
   JSON keys, which keys look categorical, which values are copied from the
   input), so the checks adapt to whatever the user teaches.
   Issue levels: error (unusable) · warn (probably wrong) · info (worth a look).
   Issues carrying a `repair` string are fixable by one automatic retry.
   ========================================================================== */
window.PF = window.PF || {};

PF.Monitor = (() => {
  const norm = v => String(v).replace(/\s+/g, ' ').trim().toLowerCase();

  /** Parse an object from raw text, tolerating ``` fences or surrounding prose. */
  function tryObj(text) {
    try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { /* try extraction */ }
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* not JSON */ } }
    return null;
  }

  /** Learn the expected shape from examples whose outputs are JSON objects (null if none are). */
  function profile(examples) {
    const rows = examples.map(e => ({ input: e.input, o: tryObj(e.output) })).filter(r => r.o);
    if (!rows.length) return null;
    const keys = Object.keys(rows[rows.length - 1].o);                 // most recent schema wins
    const enums = {}, extractive = {};
    keys.forEach(k => {
      const vals = rows.map(r => r.o[k]).filter(v => v != null && (typeof v === 'string' || typeof v === 'number'));
      const distinct = [...new Set(vals.map(norm))];
      if (vals.length >= 3 && distinct.length <= 6 && distinct.length < vals.length) { enums[k] = new Set(distinct); return; }  // repeated few values → categorical
      const strs = rows.filter(r => typeof r.o[k] === 'string' && r.o[k].length >= 2);
      // "extractive" = the value is normally copied straight from the input (ids, emails, prices…)
      extractive[k] = strs.length >= 2 && strs.filter(r => norm(r.input).includes(norm(r.o[k]))).length / strs.length >= 0.6;
    });
    return { keys, enums, extractive };
  }

  /** @returns {{level:'error'|'warn'|'info', msg:string, repair?:string}[]} */
  function check(examples, input, output) {
    const text = String(output || '').trim();
    if (!text) return [{ level: 'error', msg: 'Empty reply' }];
    const prof = profile(examples), issues = [];

    if (!prof) {   // free-text task: only catch obvious chatbot derailments
      if (/provide your (login|credentials|password)|as an ai\b|i (can't|cannot|am unable to) (help|assist)/i.test(text))
        issues.push({ level: 'warn', msg: 'Reply looks like a chatbot answer, not a task result' });
      return issues;
    }

    const keyList = prof.keys.join(', ');
    const o = tryObj(text);
    if (!o) return [{ level: 'error', msg: 'Not valid JSON', repair: `That was not valid JSON. Reply again with only one JSON object with keys: ${keyList}.` }];

    const missing = prof.keys.filter(k => !(k in o));
    if (missing.length) issues.push({ level: 'warn', msg: `Missing keys: ${missing.join(', ')}`, repair: `Your reply was missing: ${missing.join(', ')}. Reply again with only the complete JSON object with keys: ${keyList}.` });

    const vals = Object.values(o);
    if (vals.length && vals.every(v => v == null || v === '')) issues.push({ level: 'warn', msg: 'Every field is null: nothing was found in the input' });

    const inNorm = norm(input);
    Object.entries(o).forEach(([k, v]) => {
      if (v == null || v === '' || typeof v === 'object') return;
      if (prof.enums[k] && !prof.enums[k].has(norm(v))) issues.push({ level: 'info', msg: `${k} “${v}” is new (your examples only use: ${[...prof.enums[k]].join(', ')})` });
      else if (prof.extractive[k] && !inNorm.includes(norm(v))) issues.push({ level: 'warn', msg: `${k} “${v}” is not in the input: possible invention` });
    });
    return issues;
  }

  return { check, profile, tryObj };
})();
