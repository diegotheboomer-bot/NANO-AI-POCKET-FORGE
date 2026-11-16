/* ============================================================================
   exporter.js · builds everything the user ships:
     • embed snippet  (HTML + module script with WebGPU → WASM → rule fallback router)
     • bundle manifest + adapter shard (JSON)
     • standalone widget page
   The ONNX weights themselves are NOT generated here: they are hosted on
   Hugging Face. We hand over exact download instructions instead.
   ========================================================================== */
window.PF = window.PF || {};

PF.Exporter = (() => {
  const ver = s => s.version.join('.');

  /** The slice of state the runtime needs. */
  const widgetConfig = s => ({
    version: ver(s), task: s.task, model: PF.Models.get(s.modelId).hfId,
    rules: s.rules, examples: s.examples,
  });

  /** Adapter shard = the user's accumulated training data in portable form. */
  function adapter(s) {
    return { format: 'pocketforge-adapter/1', type: 'in-context (few-shot examples + rules)', version: ver(s),
      baseModel: PF.Models.get(s.modelId).hfId, rules: s.rules, examples: s.examples };
  }

  function manifest(s) {
    const m = PF.Models.get(s.modelId);
    return { format: 'pocketforge-bundle/1', name: 'pocketforge-widget', version: ver(s), createdAt: new Date().toISOString(),
      task: s.task,
      base: { id: m.id, hf: m.hfId, params: m.params, dtypeByDevice: { webgpu: 'q4', wasm: 'q8' }, files: ['onnx/model_q4.onnx', 'onnx/model_quantized.onnx', 'config.json', 'tokenizer.json', 'tokenizer_config.json', 'generation_config.json'] },
      adapter: { file: `adapter.v${ver(s)}.json`, examples: s.examples.length, rules: s.rules.length },
      runtime: { library: '@huggingface/transformers', url: PF.Models.TF_URL, router: ['webgpu', 'wasm', 'rule-fallback'] },
      history: s.history };
  }

  /** The copy-paste embed snippet. Plain string assembly (no nested template literals) to keep it readable. */
  function snippet(s) {
    const L = [];
    L.push(`<!-- PocketForge widget · v${ver(s)} · runs 100% in the visitor's browser -->`);
    L.push('<div id="pocketforge"></div>');
    L.push('<script type="module">');
    L.push('// ── 1. Config (your task + everything you taught it) ──');
    L.push('const CONFIG = ' + JSON.stringify(widgetConfig(s), null, 2) + ';');
    L.push('');
    L.push('// ── 2. Prompt builder (identical to the live preview) ──');
    L.push(PF.Engine.buildMessages.toString());
    L.push('');
    L.push(`// ── 3. Fallback router: WebGPU → WASM → rule-based ──
async function pickRoutes() {
  const routes = [];
  try {
    if (navigator.gpu && await navigator.gpu.requestAdapter()) routes.push({ device: 'webgpu', dtype: 'q4' });
  } catch (e) { /* no WebGPU */ }
  if (typeof WebAssembly === 'object') routes.push({ device: 'wasm', dtype: 'q8' });
  return routes;                       // empty → rule fallback
}

let generator = null;
async function loadModel(onStatus) {
  const routes = await pickRoutes();
  if (!routes.length) return null;
  const { pipeline } = await import('${PF.Models.TF_URL}');
  // To self-host weights: import { env } and set env.allowRemoteModels = false; env.localModelPath = '/models/';
  for (const route of routes) {
    try {
      const files = {};
      return await pipeline('text-generation', CONFIG.model, Object.assign({}, route, {
        progress_callback: p => {
          if (p.status !== 'progress' || !p.total) return;
          files[p.file] = p; const f = Object.values(files);
          onStatus('Downloading model… ' + Math.round(100 * f.reduce((a, x) => a + x.loaded, 0) / f.reduce((a, x) => a + x.total, 0)) + '%');
        }
      }));
    } catch (e) { console.warn('PocketForge route failed:', route, e); }
  }
  return null;
}

// Last-resort fallback: reply with the closest taught example (no model needed).
function nearest(input) {
  const tok = s => new Set(String(s).toLowerCase().match(/[a-z0-9]+/g) || []);
  const a = tok(input); let best = null, top = 0;
  CONFIG.examples.forEach(e => {
    const b = tok(e.input); let i = 0; a.forEach(t => b.has(t) && i++);
    const score = i / (a.size + b.size - i || 1);
    if (score > top) { top = score; best = e; }
  });
  return best ? best.output : '(No on-device model available in this browser.)';
}

async function run(input, onStatus) {
  if (generator === null) generator = (await loadModel(onStatus)) || false;
  if (!generator) return nearest(input);
  const out = await generator(buildMessages(CONFIG.task, CONFIG.rules, CONFIG.examples, input), { max_new_tokens: 256, do_sample: false });
  return out[0].generated_text.at(-1).content.trim();
}

// ── 4. Minimal UI (style freely) ──
const root = document.getElementById('pocketforge');
root.innerHTML = '<textarea rows="4" style="width:100%" placeholder="Paste input…"></textarea>' +
  '<button>Run</button> <small></small><pre style="white-space:pre-wrap"></pre>';
const [box, btn, note, out] = ['textarea', 'button', 'small', 'pre'].map(t => root.querySelector(t));
btn.onclick = async () => {
  btn.disabled = true; out.textContent = '';
  try { out.textContent = await run(box.value, t => (note.textContent = t)); note.textContent = ''; }
  finally { btn.disabled = false; }
};`);
    L.push('</script>');
    return L.join('\n');
  }

  /** Full HTML page wrapping the snippet. */
  function widgetPage(s) {
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n' +
      '<title>PocketForge widget</title>\n<style>body{font:16px system-ui;max-width:640px;margin:40px auto;padding:0 16px;background:#0b0d1f;color:#eef}textarea,button{font:inherit;padding:10px;border-radius:10px;border:1px solid #445;background:#161a3a;color:inherit}button{margin-top:8px;cursor:pointer}</style>\n' +
      '</head><body>\n' + snippet(s) + '\n</body></html>\n';
  }

  /** Trigger a browser download of a text file. */
  function download(filename, content, mime = 'application/json') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** Hugging Face CLI command to fetch the real ONNX weights for the chosen base. */
  const onnxCommand = s => `huggingface-cli download ${PF.Models.get(s.modelId).hfId} \\\n  --include "onnx/model_q4.onnx" "onnx/model_quantized.onnx" "*.json" \\\n  --local-dir ./model`;

  return { snippet, manifest, adapter, widgetPage, download, onnxCommand, ver };
})();
