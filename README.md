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



## AI Teacher (optional)
Expand & Fine-Tune → AI Teacher. Paste an API key for Anthropic or any OpenAI-compatible endpoint (OpenAI, OpenRouter, Ollama/LM Studio on localhost). It can generate training data + held-out tests, diagnose failing tests, and judge single replies. Off by default. Using it sends your task, rules, examples and queried inputs to that provider. The key stays in sessionStorage unless "remember" is ticked and is never exported. Verified against a mocked API only.

### Use your Claude Code / Codex login (no API key)
```bash
node bridge/bridge.js        # prints a token; leave it running
```
In the AI Teacher card choose **Local CLI**, paste the token, click Save & test. The bridge listens on 127.0.0.1 only, requires the token and a localhost page origin, runs a fixed command (`claude -p` / `codex exec -`) and sends the prompt over stdin. The page must be served from `http://localhost:3000` or `:8080` (or set `PF_ORIGIN`). Claude path tested end to end; Codex path is untested.
