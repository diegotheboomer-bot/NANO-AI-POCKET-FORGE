# PocketForge

Liquid-glass demo for building tiny, zero-server browser AI widgets (Transformers.js + WebGPU).

## Run
```bash
python3 -m http.server 8080   # then open http://localhost:8080
```
Opening `index.html` directly also works, but WebGPU needs a secure context (`localhost` counts).

## What is real vs. simulated
- **Simulated backend (default):** offline heuristics; your examples/rules genuinely change the output.
- **Real backend:** downloads an ONNX model from Hugging Face via Transformers.js (WebGPU → WASM). Needs internet on first load; not exercised in CI.
- **"Fine-tuning":** the progress and loss curve are simulated. A patch stores examples + rules in an adapter shard, applied as few-shot context. Real LoRA training needs an external GPU pipeline.
- **`.onnx` export:** weights are not generated; the Export tab gives the exact Hugging Face download command.

## Layout
`index.html` · `styles.css` · `js/{store,models,engine,starter,tester,trainer,exporter,ui}.js`



## Automatic testing
Forging auto-teaches a starter pack, self-tests, then (if "Auto-fix failures after forging" is ticked) teaches the failed held-out cases and re-tests. Tests re-run after patches and edits. Replies are checked for invalid JSON, missing keys, all-null output and invented values; 👍 / ✏ teach the widget from use.
