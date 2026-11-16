/* ============================================================================
   models.js · catalogue of small ONNX community models that run in-browser
   Sizes are rough q4 download sizes (approximate; check the HF repo).
   ========================================================================== */
window.PF = window.PF || {};

PF.Models = {
  /** Transformers.js build used by both the demo (real mode) and exported snippet. */
  // v4 adds Qwen3 / SmolLM3 / Gemma3n support (v3.5.0 cannot load them). Same pipeline API as v3.
  TF_URL: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2',

  // Best first. approxMB = rough q4 download (unverified: check the repo). noThink = Qwen3 "thinking" must be switched off.
  list: [
    { id: 'qwen3-4b', name: 'Qwen3 4B', hfId: 'onnx-community/Qwen3-4B-ONNX', params: '4B', approxMB: 2500, noThink: true,
      note: 'Best quality here · needs a decent GPU (≈6 GB+ VRAM)' },
    { id: 'smollm3-3b', name: 'SmolLM3 3B', hfId: 'onnx-community/SmolLM3-3B-ONNX', params: '3B', approxMB: 1900, noThink: true,
      note: 'Strong for its size · multilingual' },
    { id: 'qwen3-1.7b', name: 'Qwen3 1.7B', hfId: 'onnx-community/Qwen3-1.7B-ONNX', params: '1.7B', approxMB: 1100, noThink: true,
      note: 'Best balance · works on most GPUs' },
    { id: 'llama3.2-1b', name: 'Llama 3.2 1B Instruct', hfId: 'onnx-community/Llama-3.2-1B-Instruct', params: '1B', approxMB: 900,
      note: 'Lighter · decent instruction following' },
    { id: 'qwen2.5-0.5b', name: 'Qwen2.5 0.5B Instruct', hfId: 'onnx-community/Qwen2.5-0.5B-Instruct', params: '500M', approxMB: 400,
      note: 'Tiny · simple tasks only' },
    { id: 'smollm2-360m', name: 'SmolLM2 360M Instruct', hfId: 'onnx-community/SmolLM2-360M-Instruct', params: '360M', approxMB: 250,
      note: 'Fastest · weakest' },
  ],

  get(id) { return this.list.find(m => m.id === id) || this.list[0]; },
};
