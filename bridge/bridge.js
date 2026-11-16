#!/usr/bin/env node
/* ============================================================================
   PocketForge local bridge (no dependencies, Node 18+)
   Lets the page's AI Teacher use your ALREADY-LOGGED-IN `claude` (Claude Code)
   or `codex` command-line tool, so no API key is needed.

   Security model:
     • listens on 127.0.0.1 only (not reachable from other machines)
     • browser requests must come from an allowed Origin (localhost pages)
     • every request needs the random token printed at startup
     • the command is fixed (claude -p / codex exec -); the page only supplies
       the prompt text, which is sent over stdin, never put in a command line
     • one request at a time, 2-minute timeout, 150 KB prompt limit

   Run:  node bridge/bridge.js
   Env:  PF_PORT (default 8787) · PF_TOKEN (default random) · PF_ORIGIN (extra origins, comma-separated)
   ========================================================================== */
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = Number(process.env.PF_PORT) || 8787;
const TOKEN = process.env.PF_TOKEN || crypto.randomBytes(16).toString('hex');
const ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080', 'http://127.0.0.1:8080',
  ...(process.env.PF_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)]);

// Fixed commands. Prompt goes through stdin.
const TOOLS = {
  claude: { cmd: 'claude', args: ['-p'] },
  codex: { cmd: 'codex', args: ['exec', '-'] },       // experimental / untested
};
const TIMEOUT_MS = 120000, MAX_BODY = 150000;
let busy = false;

const tokenOk = t => { const a = Buffer.from(String(t || '')), b = Buffer.from(TOKEN); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

function runTool(tool, prompt) {
  return new Promise((resolve, reject) => {
    const t = TOOLS[tool];
    // shell:true only on Windows, where CLIs are .cmd shims. Args are constants, so nothing user-supplied reaches the shell.
    const child = spawn(t.cmd, t.args, { shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => { child.kill(); finish(reject, new Error(`${tool} timed out after ${TIMEOUT_MS / 1000}s`)); }, TIMEOUT_MS);
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => finish(reject, new Error(e.code === 'ENOENT' ? `\`${t.cmd}\` was not found. Install it and log in first.` : e.message)));
    child.on('close', code => code === 0 ? finish(resolve, out.trim()) : finish(reject, new Error(`${tool} exited with code ${code}: ${(err || out).trim().slice(-400)}`)));
    child.stdin.on('error', () => {});   // ignore EPIPE if the tool exits early
    child.stdin.end(prompt);
  });
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const allowed = !!origin && ORIGINS.has(origin);
  if (allowed) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-headers', 'content-type, x-pf-token');
    res.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS');
  }
  if (!allowed) return send(res, 403, { error: 'Origin not allowed. Serve the page from http://localhost:3000 or set PF_ORIGIN.' });
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (!tokenOk(req.headers['x-pf-token'])) return send(res, 401, { error: 'Bad or missing token. Paste the token printed in the bridge window.' });

  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, tools: Object.keys(TOOLS) });
  if (req.method !== 'POST' || req.url !== '/ask') return send(res, 404, { error: 'Not found' });
  if (busy) return send(res, 429, { error: 'Bridge is busy with another request.' });

  let body = '', size = 0, tooBig = false;
  req.on('data', c => { size += c.length; if (size > MAX_BODY) { tooBig = true; req.destroy(); } else body += c; });
  req.on('close', () => { /* handled in 'end' */ });
  req.on('end', async () => {
    if (tooBig) return;
    let j; try { j = JSON.parse(body); } catch { return send(res, 400, { error: 'Invalid JSON body' }); }
    if (!TOOLS[j.tool]) return send(res, 400, { error: `Unknown tool. Use one of: ${Object.keys(TOOLS).join(', ')}` });
    if (typeof j.prompt !== 'string' || !j.prompt.trim() || j.prompt.length > MAX_BODY) return send(res, 400, { error: 'Missing or oversized prompt' });
    busy = true;
    try { send(res, 200, { text: await runTool(j.tool, j.prompt) }); }
    catch (e) { send(res, 500, { error: e.message }); }
    finally { busy = false; }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nPocketForge bridge running on http://127.0.0.1:${PORT}`);
  console.log(`\n  Token (paste into the AI Teacher "API key / token" box):\n\n    ${TOKEN}\n`);
  console.log(`  Allowed page origins: ${[...ORIGINS].join(', ')}`);
  console.log('  Needs `claude` (Claude Code) or `codex` installed and logged in. Ctrl+C to stop.\n');
});
