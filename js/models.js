/* ============================================================================
   models.js · catalogue of small ONNX community models that run in-browser
   Sizes are rough q4 download sizes (approximate; check the HF repo).
   ========================================================================== */
window.PF = window.PF || {};

PF.Models = {
  /** Transformers.js build used by both the demo (real mode) and exported snippet. */
  TF_URL: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.0',

  list: [
    { id: 'smollm2-360m', name: 'SmolLM2 360M Instruct', hfId: 'onnx-community/SmolLM2-360M-Instruct',
      params: '360M', approxMB: 250, note: 'Fastest · good for extraction & formatting' },
    { id: 'qwen2.5-0.5b', name: 'Qwen2.5 0.5B Instruct', hfId: 'onnx-community/Qwen2.5-0.5B-Instruct',
      params: '500M', approxMB: 400, note: 'Balanced · better rule following' },
    { id: 'llama3.2-1b', name: 'Llama 3.2 1B Instruct', hfId: 'onnx-community/Llama-3.2-1B-Instruct',
      params: '1B', approxMB: 900, note: 'Most capable · heavier first load' },
  ],

  get(id) { return this.list.find(m => m.id === id) || this.list[0]; },
};
