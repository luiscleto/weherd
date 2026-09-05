import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { ApiError, HerdrClient, normalizeSnapshot, selectAgent, planClose } from './herdr.mjs';
import { DemoOffice } from './demo.mjs';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' };

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
  response.end(JSON.stringify(value));
}

export function originAllowed(request, extraOrigins = [], requireOrigin = false) {
  let host;
  try { host = new URL(`http://${request.headers.host}`); } catch { return false; }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname) || host.username || host.password) return false;
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  if (!origin) return !requireOrigin;
  return origin === host.origin || extraOrigins.includes(origin);
}

async function bodyJSON(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new ApiError('Send application/json.', 415);
  let data = '', size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new ApiError('Request body is too large.', 413);
    data += chunk.toString();
  }
  try {
    const result = JSON.parse(data);
    if (!result || Array.isArray(result) || typeof result !== 'object') throw new Error();
    if (Object.keys(result).some(key => !['allowWorking', 'deleteWorkspace', 'expectedIdentity'].includes(key))) throw new Error();
    return result;
  } catch { throw new ApiError('Invalid close request JSON.', 400); }
}

async function safeReplacementCwd(snapshot, agent) {
  const workspace = snapshot.workspaces.find(item => item.workspace_id === agent.workspaceId);
  for (const candidate of [agent.cwd, workspace?.worktree?.checkout_path, os.homedir(), os.tmpdir()]) {
    if (!candidate || !path.isAbsolute(candidate)) continue;
    try { if ((await stat(candidate)).isDirectory()) return candidate; } catch { /* Try next existing directory. */ }
  }
  throw new ApiError('Could not find a directory for the replacement shell; nothing was closed.', 409);
}

export async function closeLiveAgent(client, paneId, options) {
  let snapshot = await client.snapshot();
  let plan = planClose(snapshot, paneId, options);
  let replacement;
  if (plan.preserveWorkspace) {
    const cwd = await safeReplacementCwd(snapshot, plan.agent);
    const created = await client.request('tab.create', { workspace_id: plan.agent.workspaceId, cwd, label: 'Office · shell', focus: false });
    replacement = created.root_pane;
    if (!replacement?.pane_id || replacement.workspace_id !== plan.agent.workspaceId) throw new ApiError('Herdr did not confirm a replacement shell. The agent was left open; refresh Herdr.', 502);
    snapshot = await client.snapshot();
    plan = planClose(snapshot, paneId, options);
    if (plan.preserveWorkspace || !snapshot.panes.some(pane => pane.pane_id === replacement.pane_id && pane.terminal_id === replacement.terminal_id)) throw new ApiError('The replacement shell disappeared. The agent was left open.', 409);
  }
  await client.request(plan.method, plan.params);
  const after = await client.snapshot().catch(() => null);
  if (!after) throw new ApiError('Herdr accepted the close but its final state could not be checked. Refresh before trying again.', 502);
  const remains = options.deleteWorkspace ? after.workspaces.some(workspace => workspace.workspace_id === plan.agent.workspaceId) : after.panes.some(pane => pane.pane_id === paneId);
  if (remains) throw new ApiError('Herdr has not confirmed the close. Refresh before trying again.', 502);
  return { ok: true, message: options.deleteWorkspace ? 'Herdr workspace closed. Checkout files were kept.' : replacement ? 'Agent closed. Workspace kept open with a new shell.' : 'Agent terminal closed.' };
}

export function createOfficeServer({
  client = new HerdrClient(), demo = new DemoOffice(), defaultMode = process.env.WEHERD_MODE || 'live',
  distDir = path.join(projectRoot, 'dist'),
  allowedOrigins = (process.env.WEHERD_ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173').split(',').filter(Boolean),
} = {}) {
  if (!['live', 'demo'].includes(defaultMode)) throw new Error('WEHERD_MODE must be live or demo.');
  const sockets = new Set();
  let mutation = false;
  const modeFor = url => {
    const mode = url.searchParams.get('mode') || defaultMode;
    if (!['live', 'demo'].includes(mode)) throw new ApiError('mode must be live or demo.', 400);
    return mode;
  };
  const server = http.createServer(async (request, response) => {
    try {
      if (!originAllowed(request, allowedOrigins, request.method !== 'GET' && request.method !== 'HEAD')) throw new ApiError('Request origin is not allowed.', 403);
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (request.method === 'GET' && url.pathname === '/api/state') {
        const mode = modeFor(url);
        try {
          const snapshot = await (mode === 'demo' ? demo : client).snapshot();
          json(response, 200, { mode, connected: true, agents: normalizeSnapshot(snapshot), version: snapshot.version, protocol: snapshot.protocol });
        } catch (error) { json(response, 200, { mode, connected: false, agents: [], error: error.message }); }
        return;
      }
      const closeMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/close$/);
      if (request.method === 'POST' && url.pathname === '/api/demo/reset') {
        await bodyJSON(request);
        json(response, 200, demo.reset());
        return;
      }
      if (request.method === 'POST' && closeMatch) {
        const mode = modeFor(url), options = await bodyJSON(request);
        let paneId;
        try { paneId = decodeURIComponent(closeMatch[1]); } catch { throw new ApiError('Invalid agent identifier.', 400); }
        if (mutation) throw new ApiError('Another close is in progress. Try again in a moment.', 409);
        mutation = true;
        try { json(response, 200, mode === 'demo' ? await demo.close(paneId, options) : await closeLiveAgent(client, paneId, options)); }
        finally { mutation = false; }
        return;
      }
      if (url.pathname.startsWith('/api/')) throw new ApiError('API route not found.', 404);
      if (!['GET', 'HEAD'].includes(request.method)) throw new ApiError('Method not allowed.', 405);
      let decoded;
      try { decoded = decodeURIComponent(url.pathname); } catch { throw new ApiError('Invalid path.', 400); }
      if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) throw new ApiError('Invalid path.', 400);
      let file = path.resolve(distDir, `.${decoded === '/' ? '/index.html' : decoded}`);
      const root = await realpath(distDir).catch(() => null);
      if (!root) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('<!doctype html><title>Weherd server</title><body style="font:18px system-ui;background:#101913;color:#d8edc7;padding:60px"><h1>Weherd bridge is running</h1><p>Run <code>npm run dev</code> to open the office, or <code>npm run build</code> to serve the game here.</p></body>');
        return;
      }
      file = await realpath(file).catch(() => null);
      if (!file || (file !== root && !file.startsWith(`${root}${path.sep}`)) || !(await stat(file)).isFile()) throw new ApiError('File not found.', 404);
      const data = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', 'Cross-Origin-Resource-Policy': 'same-origin' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) { if (!response.headersSent) json(response, error.status || 500, { error: error.message || 'Request failed.' }); else response.end(); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    if (!originAllowed(request, allowedOrigins, true)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    let url;
    try { url = new URL(request.url, `http://${request.headers.host}`); modeFor(url); } catch { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
    if (url.pathname !== '/api/terminal') { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, url));
  });
  wss.on('connection', async (ws, url) => {
    sockets.add(ws);
    let terminal, timer, heartbeat, initialResize, source, paneId, identity, queueTimer;
    let pending = false, alive = true, flushing = false, queue = [], queuedBytes = 0;
    const send = message => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > 8 * 1024 * 1024) { ws.close(1013, 'Terminal client is too slow.'); return; }
      ws.send(JSON.stringify(message));
    };
    const stop = () => { clearInterval(timer); clearInterval(heartbeat); clearTimeout(queueTimer); queue = []; terminal?.close(); sockets.delete(ws); };
    const flush = async () => {
      if (flushing || !terminal || !queue.length || ws.readyState !== WebSocket.OPEN) return;
      flushing = true;
      const messages = queue; queue = []; queuedBytes = 0;
      try {
        selectAgent(await source.snapshot(), paneId, identity);
        if (ws.readyState !== WebSocket.OPEN || terminal.closed) return;
        for (const message of messages) terminal.send(message);
      } catch (error) { send({ type: 'error', message: error.message }); ws.close(1008, 'Terminal input refused.'); stop(); }
      finally { flushing = false; if (queue.length) queueTimer = setTimeout(flush, 16); }
    };
    ws.once('close', stop); ws.once('error', stop);
    ws.on('pong', () => { alive = true; });
    // Ignore commands until identity has been resolved and the bridge is ready.
    ws.on('message', raw => {
      try {
        const message = JSON.parse(raw.toString());
        if (!terminal) { if (message?.type === 'resize') initialResize = message; return; }
        queuedBytes += raw.length;
        if (queuedBytes > 256 * 1024 || queue.length > 256) throw new ApiError('Too much pending terminal input.', 429);
        queue.push(message);
        clearTimeout(queueTimer); queueTimer = setTimeout(flush, 16);
      }
      catch (error) { send({ type: 'error', message: error.message }); }
    });
    try {
      const mode = modeFor(url);
      source = mode === 'demo' ? demo : client;
      paneId = url.searchParams.get('paneId'); identity = url.searchParams.get('identity');
      const agent = selectAgent(await source.snapshot(), paneId, identity);
      if (ws.readyState !== WebSocket.OPEN) return;
      terminal = source.terminal(agent);
      terminal.on('output', data => send({ type: 'output', data }));
      terminal.on('status', message => send({ type: 'status', message }));
      terminal.on('statusError', message => send({ type: 'error', message }));
      terminal.on('closed', () => ws.close(1000, 'Terminal session ended.'));
      if (initialResize) terminal.send(initialResize);
      timer = setInterval(async () => {
        if (pending) return; pending = true;
        try { selectAgent(await source.snapshot(), paneId, identity); }
        catch (error) { send({ type: 'error', message: error.message }); ws.close(1000, 'Agent is no longer available.'); stop(); }
        finally { pending = false; }
      }, 1500);
      heartbeat = setInterval(() => { if (!alive) { ws.terminate(); stop(); } else { alive = false; ws.ping(); } }, 15000);
      timer.unref(); heartbeat.unref();
    } catch (error) { send({ type: 'error', message: error.message }); ws.close(1008, 'Terminal unavailable.'); }
  });
  server.on('close', () => { for (const ws of sockets) ws.terminate(); wss.close(); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
  const server = createOfficeServer();
  server.listen(port, '127.0.0.1', () => console.log(`Weherd office: http://127.0.0.1:${port} (${process.env.WEHERD_MODE || 'live'} mode)\nHerdr socket: ${new HerdrClient().socketPath}`));
  const shutdown = () => { server.close(); server.closeAllConnections(); setTimeout(() => process.exit(0), 250).unref(); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
