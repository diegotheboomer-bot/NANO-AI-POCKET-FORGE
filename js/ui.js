/* ============================================================================
   ui.js · wires the DOM to the Store / Engine / Trainer / Exporter modules
   Sections: helpers · stepper · tabs · build · expand · preview · export
   ========================================================================== */
(() => {
  const { Store, Models, Engine, Trainer, Exporter, Starter, Tester } = PF;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function toast(msg, err = false) {
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
    $('#toasts').appendChild(t); setTimeout(() => t.remove(), 4200);
  }

  /* ── Stepper: animated step-by-step progress visualiser ─────────────────
     steps: [{label, detail, run?: async (api) => void}]. Steps without `run`
     just play a short simulated delay. api.progress(0..1) drives the bar.   */
  async function runStepper({ listEl, barEl, logEl, steps }) {
    listEl.innerHTML = steps.map((s, i) => `<li data-i="${i}"><span class="dot">${i + 1}</span><div><b>${esc(s.label)}</b><span>${esc(s.detail)}</span></div></li>`).join('');
    if (logEl) logEl.textContent = '';
    const items = $$('li', listEl);
    const setBar = p => { if (barEl) barEl.style.width = Math.round(p * 100) + '%'; };
    const api = { log: m => { if (logEl) { logEl.textContent += m + '\n'; logEl.scrollTop = 1e9; } }, progress: setBar };
    setBar(0);
    for (let i = 0; i < steps.length; i++) {
      items[i].classList.add('active');
      api.log(`▸ ${steps[i].label}`);
      const base = i / steps.length, span = 1 / steps.length;
      api.progress = p => setBar(base + span * Math.min(Math.max(p, 0), 1));
      try {
        steps[i].run ? await steps[i].run(api) : await sleep(550 + Math.random() * 450);
      } catch (e) { items[i].classList.replace('active', 'fail'); throw e; }
      api.progress(1);
      items[i].classList.replace('active', 'done');
    }
    setBar(1);
  }

  /* ── Tabs ───────────────────────────────────────────────────────────── */
  function showTab(name) {
    $$('.tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
    $$('.panel').forEach(p => p.hidden = p.id !== 'tab-' + name);
    if (name === 'export') renderExport();
    if (name === 'preview') renderPreviewHeader();
  }
  $$('.tabs [role=tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  /* ════════════════════ 1 · BUILD ════════════════════ */
  const PRESETS = ['Extract product info from messy text', 'Format support tickets', 'Classify feedback sentiment'];
  $('#task-presets').innerHTML = PRESETS.map(p => `<button type="button">${esc(p)}</button>`).join('');
  $('#task-presets').addEventListener('click', e => { if (e.target.matches('button')) { $('#task').value = e.target.textContent; $('#task').focus(); } });

  function renderModels() {
    const s = Store.get();
    $('#model-list').innerHTML = Models.list.map(m => `
      <button type="button" class="model" role="radio" aria-checked="${m.id === s.modelId}" data-id="${m.id}">
        <div><b>${esc(m.name)}</b><span>${esc(m.note)}</span></div>
        <div class="size">${m.params} · ≈${m.approxMB} MB</div>
      </button>`).join('');
    $$('#backend-seg button').forEach(b => b.setAttribute('aria-checked', b.dataset.backend === s.backend));
  }
  $('#model-list').addEventListener('click', e => { const b = e.target.closest('.model'); if (b) Store.set({ modelId: b.dataset.id }); });
  $('#backend-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) Store.set({ backend: b.dataset.backend }); });

  let forging = false;
  $('#forge-btn').addEventListener('click', async () => {
    const task = $('#task').value.trim();
    if (!task) { toast('Describe what your micro-AI should do first.', true); $('#task').focus(); return; }
    const s = Store.get();
    if (s.forged && s.history.length > 1 && !confirm('Re-forging resets everything you added and re-runs auto-teach. Continue?')) return;
    if (forging) return;
    forging = true; $('#forge-btn').disabled = true;

    const model = Models.get(s.modelId);
    let backend = s.backend;
    $('#forge-sub').textContent = `Forging “${task}” on ${model.name}…`;

    const steps = [
      { label: 'Analyzing task', detail: 'Inferring the input → output shape' },
      { label: 'Resolving base model', detail: `${model.hfId}` },
      { label: backend === 'real' ? 'Downloading weights' : 'Fetching & quantizing weights', detail: backend === 'real' ? 'Real download via Transformers.js (cached by the browser)' : 'Simulated: q4 for WebGPU, q8 for WASM',
        run: async api => {
          if (backend !== 'real') return sleep(900);
          try {
            await Engine.loadReal(model, (p, info) => { api.progress(p); if (info.status === 'init') api.log(`  trying ${info.note}`); });
            api.log('  model ready in memory');
          } catch (e) {
            backend = 'sim'; toast('Real model failed to load; using Simulated backend. ' + (e.message || ''), true);
            api.log('  ✗ ' + (e.message || e) + '\n  falling back to simulated backend');
          }
        } },
      { label: 'Compiling runtime', detail: 'WebGPU shaders / WASM fallback router' },
      { label: 'Auto-teaching from your task', detail: 'Matching a starter pack of examples & rules', run: async api => {
          pack = Starter.forTask(task);
          api.log(pack ? `  matched “${pack.label}”: ${pack.examples.length} examples, ${pack.rules.length} rules, ${pack.tests.length} held-out tests`
                       : '  no starter pack for this task. Add your own examples in Expand & Fine-Tune');
          await sleep(500);
        } },
      { label: 'Self-testing', detail: 'Scoring the widget on held-out cases', run: async api => {
          const tmp = { ...Store.get(), task, backend, forged: true, examples: pack ? pack.examples : [], rules: pack ? pack.rules : [], tests: pack ? pack.tests : [] };
          result = await Tester.run(tmp, (d, t) => api.progress(d / t));
          api.log(result.total ? `  ${result.passed}/${result.total} passed · score ${Math.round(result.score * 100)}%` : '  nothing to test yet');
        } },
    ];
    let pack = null, result = null;
    try {
      await runStepper({ listEl: $('#forge-steps'), barEl: $('#forge-bar'), logEl: $('#forge-log'), steps });
      Store.set({ task, backend, forged: true, version: [1, 0, 0],
        examples: pack ? pack.examples : [], rules: pack ? pack.rules : [], tests: pack ? pack.tests : [],
        packLabel: pack ? pack.label : null, lastTest: result, prevScore: null,
        history: [{ version: '1.0.0', at: Date.now(), note: `Forged on ${model.name}` + (pack ? ` · auto-taught ${pack.examples.length} examples` : '') }] });
      $('#forge-sub').textContent = pack ? `Done. v1.0.0 auto-taught with “${pack.label}”.` : 'Done. v1.0.0 forged. No starter pack matched, so add examples to teach it.';
      $('#forge-log').textContent += '✓ widget v1.0.0 ready\n';
      toast(result && result.total ? `Forged. Self-test ${Math.round(result.score * 100)}%. Try it in Live Preview.` : 'Forged. Try it in Live Preview.');
      resetChat();
    } catch (e) { toast('Forge failed: ' + (e.message || e), true); }
    finally { forging = false; $('#forge-btn').disabled = false; }
  });

  /* ════════════════════ 2 · EXPAND ════════════════════ */
  const SAMPLE = [
    'Selling a used Kindle Paperwhite for $65, email me at ana@mail.com => {"item_name":"Kindle Paperwhite","price":"$65","customer_email":"ana@mail.com"}',
    'Brand new Logitech MX Master 3S mouse 99 USD, call 555-010-2000 => {"item_name":"Logitech MX Master 3S mouse","price":"99 USD","customer_phone":"555-010-2000"}',
  ].join('\n');
  $('#ex-sample').addEventListener('click', () => { $('#ex-text').value = SAMPLE; $('#rules-text').value ||= 'Always include a confidence score'; });
  $('#ex-file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const { items, errors } = Trainer.parseFile(f.name, await f.text());
    $('#ex-text').value = ($('#ex-text').value.trim() ? $('#ex-text').value.trim() + '\n' : '') +
      items.map(x => `${x.input.replace(/\n/g, '\\n')} => ${x.output.replace(/\n/g, '\\n')}`).join('\n');
    toast(`Loaded ${items.length} example${items.length === 1 ? '' : 's'} from ${f.name}` + (errors.length ? ` (${errors.length} skipped)` : ''), !items.length);
    e.target.value = '';
  });

  let patching = false;
  $('#patch-btn').addEventListener('click', async () => {
    if (patching) return;
    const { items, errors } = Trainer.parseExamples($('#ex-text').value);
    const rules = Trainer.parseRules($('#rules-text').value);
    if (errors.length) toast(errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} more)` : ''), true);
    if (!items.length && !rules.length) { if (!errors.length) toast('Add examples or rules first.', true); return; }

    patching = true; $('#patch-btn').disabled = true;
    const line = $('#loss-line'); line.setAttribute('points', '');
    const steps = [
      { label: 'Validating data', detail: `${items.length} examples · ${rules.length} rules` },
      { label: 'Tokenizing & indexing', detail: 'Building the adapter shard' },
      { label: 'Training adapter (simulated)', detail: 'LoRA-style low-rank update', run: async api => {
          const pts = []; const N = 28;
          for (let i = 0; i < N; i++) {             // decaying loss curve with a little noise
            const y = 8 + 50 * (1 - Math.exp(-i / 8)) + Math.random() * 4;   // SVG y grows downward: high loss = small y
            pts.push(`${(i / (N - 1) * 300).toFixed(1)},${y.toFixed(1)}`);
            line.setAttribute('points', pts.join(' ')); api.progress((i + 1) / N); await sleep(55);
          } } },
      { label: 'Merging into bundle', detail: 'Bumping version, re-indexing' },
    ];
    try {
      await runStepper({ listEl: $('#patch-steps'), barEl: null, logEl: null, steps });
      const res = Trainer.commit(Store, items, rules);
      if (res) { Store.set({ tests: Store.get().tests.filter(t => !items.some(i => i.input === t.input)) });   // taught cases are no longer held-out
        $('#ex-text').value = ''; $('#rules-text').value = ''; await runTests(`Patched to ${Store.versionString(res.version)} (${res.note})`); }
      else toast('Nothing new: those examples/rules already exist.', true);
    } catch (e) { toast('Patch failed: ' + e.message, true); }
    finally { patching = false; renderExpand(); }
  });

  function renderExpand() {
    const s = Store.get();
    $('#patch-btn').disabled = !s.forged || patching;
    $('#patch-lock').hidden = s.forged;
    $('#n-ex').textContent = s.examples.length; $('#n-rules').textContent = s.rules.length;
    $('#n-ver').textContent = s.forged ? Store.versionString() : '—';
    const items = [
      ...s.rules.map((r, i) => `<li><span>⚙ ${esc(r)}</span><button data-rule="${i}" aria-label="Remove rule">×</button></li>`),
      ...s.examples.map((e, i) => `<li><span>${e.src === 'starter' ? '★ ' : ''}${esc(e.input)} → ${esc(e.output)}</span><button data-ex="${i}" aria-label="Remove example">×</button></li>`),
    ];
    $('#knowledge-list').innerHTML = items.join('') || '<li class="empty">Nothing added yet. The widget uses only its base model.</li>';
    renderTests();
    $('#history-list').innerHTML = s.history.map(h => `<li><span><b>v${esc(h.version)}</b>${esc(h.note)}</span><span>${new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></li>`).join('') || '<li class="empty">No versions yet.</li>';
  }
  $('#knowledge-list').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const s = Store.get();
    if (b.dataset.ex != null) Store.set({ examples: s.examples.filter((_, i) => i !== +b.dataset.ex) });
    if (b.dataset.rule != null) Store.set({ rules: s.rules.filter((_, i) => i !== +b.dataset.rule) });
  });

  /* ── Self-test card ─────────────────────────────────────────────────── */
  let testing = false;
  async function runTests(prefix = 'Tests finished') {
    const s = Store.get();
    if (testing || !s.forged) return;
    testing = true; $('#test-btn').disabled = true; $('#test-sub').textContent = 'Running…';
    try {
      if (s.backend === 'real' && !Engine.isRealLoaded(s.modelId)) {
        await Engine.loadReal(Models.get(s.modelId), p => { $('#test-sub').textContent = `Loading model… ${Math.round(p * 100)}%`; });
      }
      const res = await Tester.run(s, (d, t) => { $('#test-sub').textContent = `Running ${d}/${t}…`; });
      const before = s.lastTest && s.lastTest.total ? s.lastTest.score : null;
      Store.set({ lastTest: res, prevScore: before });
      if (res.total) {
        const delta = before == null ? '' : ` (${res.score >= before ? '+' : ''}${Math.round((res.score - before) * 100)} pts)`;
        toast(`${prefix}. Self-test ${Math.round(res.score * 100)}%${delta}`);
      } else toast(prefix);
    } catch (e) { toast('Tests failed: ' + (e.message || e), true); }
    finally { testing = false; renderTests(); }
  }
  $('#test-btn').addEventListener('click', () => runTests());

  function renderTests() {
    const s = Store.get(), t = s.lastTest;
    $('#test-btn').disabled = !s.forged || testing;
    if (!s.forged || !t || !t.total) {
      $('#score-num').textContent = '—'; $('#score-bar').style.width = '0';
      $('#test-sub').textContent = s.forged ? 'No tests yet. Add examples, then run tests: each is checked with itself held out.' : 'Forge a widget to run tests.';
      $('#test-list').innerHTML = ''; $('#fix-btn').hidden = true; return;
    }
    const pct = Math.round(t.score * 100), d = s.prevScore == null ? '' : ` · ${t.score >= s.prevScore ? '+' : ''}${Math.round((t.score - s.prevScore) * 100)} pts vs previous`;
    $('#score-num').textContent = pct + '%'; $('#score-bar').style.width = pct + '%';
    $('#test-sub').textContent = `${t.passed}/${t.total} passed${d}`;
    $('#test-list').innerHTML = t.cases.map(c => `<li><div class="row1"><span class="${c.pass ? 'ok' : 'no'}">${c.pass ? '✓' : '✗'}</span><span>${esc(c.input)}</span></div>` +
      (c.pass ? '' : `<small>expected ${esc(c.expected)}</small><small>got ${esc(c.got)}</small>`) + '</li>').join('');
    $('#fix-btn').hidden = !t.cases.some(c => !c.pass);
  }
  // Refine loop: put the failed cases (with the CORRECT answers) into the examples box for review.
  $('#fix-btn').addEventListener('click', () => {
    const fails = (Store.get().lastTest?.cases || []).filter(c => !c.pass && c.kind === 'held-out');
    const lines = fails.map(c => `${c.input.replace(/\n/g, '\\n')} => ${c.expected}`);
    if (!lines.length) return toast('Failures are on training examples. Edit or delete those instead.', true);
    const box = $('#ex-text'); box.value = (box.value.trim() ? box.value.trim() + '\n' : '') + lines.join('\n'); box.focus();
    toast('Review the lines, then click Update & Patch Model. Taught cases leave the held-out test set.');
  });

  /* ════════════════════ 3 · PREVIEW ════════════════════ */
  let runAs = 'current', busy = false;
  const msgs = $('#msgs');

  function resetChat() {
    msgs.innerHTML = Store.get().forged ? '<div class="msg sys">Widget ready. Paste some input below or pick a sample.</div>' : '<div class="msg sys">Forge a widget in the Build tab first.</div>';
    renderPreviewHeader();
  }
  function renderPreviewHeader() {
    const s = Store.get(), m = Models.get(s.modelId);
    $('#chat-sub').textContent = s.forged ? `${m.name} · ${Store.versionString()} · ${s.backend === 'real' ? 'real inference' : 'simulated inference'}` + (s.lastTest && s.lastTest.total ? ` · self-test ${Math.round(s.lastTest.score * 100)}%` : '') : 'Forge a widget to start testing.';
    $('#send-btn').disabled = !s.forged;
    $('#sample-inputs').innerHTML = s.forged ? (Engine.suggestInputs(s.task) || []).map((t, i) => `<button type="button" data-i="${i}">Sample ${i + 1}</button>`).join('') : '';
    $$('#run-as button').forEach(b => b.setAttribute('aria-checked', b.dataset.as === runAs));
  }
  $('#run-as').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { runAs = b.dataset.as; renderPreviewHeader(); } });
  $('#sample-inputs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $('#chat-input').value = Engine.suggestInputs(Store.get().task)[+b.dataset.i]; $('#chat-input').focus();
  });
  $('#chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });

  function addMsg(cls, html) { const d = document.createElement('div'); d.className = 'msg ' + cls; d.innerHTML = html; msgs.appendChild(d); msgs.scrollTop = 1e9; return d; }

  $('#composer').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('#chat-input').value.trim(), s = Store.get();
    if (!input || busy || !s.forged) return;
    busy = true; $('#send-btn').disabled = true; $('#chat-input').value = '';
    addMsg('user', esc(input));
    const bot = addMsg('bot', '<span class="typing"><i></i><i></i><i></i></span>');
    try {
      // Real mode after a page reload: the model is no longer in memory, so load it lazily.
      if (s.backend === 'real' && !Engine.isRealLoaded(s.modelId)) {
        await Engine.loadReal(Models.get(s.modelId), p => { bot.textContent = `Loading model… ${Math.round(p * 100)}%`; });
      }
      const { text, meta } = await Engine.run(s, input, { base: runAs === 'base' });
      bot.textContent = '';
      for (let i = 0; i < text.length; i += 6) { bot.textContent = text.slice(0, i + 6); msgs.scrollTop = 1e9; await sleep(8); }   // streamed feel
      bot.insertAdjacentHTML('beforeend', `<span class="meta">${esc(runAs === 'base' ? 'untrained · ' : '')}${esc(meta)}</span>`);
    } catch (err) {
      bot.textContent = 'Error: ' + (err.message || err);
    } finally { busy = false; $('#send-btn').disabled = false; msgs.scrollTop = 1e9; }
  });

  /* ════════════════════ 4 · EXPORT ════════════════════ */
  function renderExport() {
    const s = Store.get();
    if (!s.forged) { $('#snippet').textContent = 'Forge a widget to generate your snippet.'; $('#onnx-cmd').textContent = ''; $('#onnx-link').removeAttribute('href'); return; }
    $('#snippet').textContent = Exporter.snippet(s);
    $('#onnx-cmd').textContent = Exporter.onnxCommand(s);
    $('#onnx-link').href = `https://huggingface.co/${Models.get(s.modelId).hfId}/tree/main/onnx`;
  }
  $('#copy-btn').addEventListener('click', async () => {
    if (!Store.get().forged) return toast('Forge a widget first.', true);
    const text = $('#snippet').textContent;
    try { await navigator.clipboard.writeText(text); }
    catch { const r = document.createRange(); r.selectNodeContents($('#snippet')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand('copy'); }
    toast('Snippet copied to clipboard.');
  });
  $('#tab-export').addEventListener('click', e => {
    const b = e.target.closest('[data-dl]'); if (!b) return;
    const s = Store.get(); if (!s.forged) return toast('Forge a widget first.', true);
    const v = Exporter.ver(s);
    if (b.dataset.dl === 'manifest') Exporter.download('pocketforge.manifest.json', JSON.stringify(Exporter.manifest(s), null, 2));
    if (b.dataset.dl === 'adapter') Exporter.download(`adapter.v${v}.json`, JSON.stringify(Exporter.adapter(s), null, 2));
    if (b.dataset.dl === 'widget') Exporter.download(`pocketforge-widget-v${v}.html`, Exporter.widgetPage(s), 'text/html');
  });

  /* ════════════════════ Global ════════════════════ */
  $('#reset-btn').addEventListener('click', () => { if (confirm('Reset everything?')) { Store.reset(); $('#task').value = ''; resetChat(); showTab('build'); } });

  async function renderHardware() {
    const caps = await Engine.detect(), chip = $('#hw-chip');
    chip.textContent = caps.webgpu ? 'WebGPU ready' : caps.wasm ? 'WASM fallback' : 'No acceleration';
    chip.className = 'chip ' + (caps.webgpu ? 'ok' : 'warn');
    chip.title = caps.webgpu ? 'Real mode will use WebGPU (q4).' : 'WebGPU unavailable here: Real mode will use WASM (slower).';
  }

  function render() {
    const s = Store.get();
    renderModels(); renderExpand();
    $('#ver-chip').textContent = s.forged ? Store.versionString() : 'Not forged';
    if (!$('#tab-preview').hidden) renderPreviewHeader();
    if (!$('#tab-export').hidden) renderExport();
  }
  Store.onChange(render);

  // Boot
  $('#task').value = Store.get().task;
  render(); resetChat(); renderHardware();
})();
