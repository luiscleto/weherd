import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createOfficeServer } from './index.mjs';

async function start(t, options = {}) {
  const server = createOfficeServer({ defaultMode: 'demo', ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

test('demo and disconnected live state stay explicit; no silent fallback', async t => {
  const { base } = await start(t, { client: { snapshot: async () => { throw new Error('offline fixture'); } } });
  const demo = await (await fetch(`${base}/api/state?mode=demo`)).json();
  assert.equal(demo.mode, 'demo'); assert.equal(demo.agents.length, 6);
  const live = await (await fetch(`${base}/api/state?mode=live`)).json();
  assert.deepEqual(live, { mode: 'live', connected: false, agents: [], error: 'offline fixture' });
  assert.equal((await fetch(`${base}/api/state?mode=garbage`)).status, 400);
});

test('cross-origin, originless mutation and invalid body never close an agent', async t => {
  const { base } = await start(t);
  const state = await (await fetch(`${base}/api/state`)).json();
  const agent = state.agents.find(agent => agent.status === 'idle');
  const target = `${base}/api/agents/${encodeURIComponent(agent.id)}/close?mode=demo`;
  const body = JSON.stringify({ expectedIdentity: agent.identity, allowWorking: false, deleteWorkspace: false });
  assert.equal((await fetch(target, { method: 'POST', body, headers: { 'content-type': 'application/json' } })).status, 403);
  assert.equal((await fetch(target, { method: 'POST', body, headers: { 'content-type': 'application/json', origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(`${base}/api/state`, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(target, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', origin: base } })).status, 400);
  assert.equal((await fetch(target, { method: 'POST', body, headers: { 'content-type': 'application/json', origin: base } })).status, 200);
  const after = await (await fetch(`${base}/api/state`)).json();
  assert.equal(after.agents.some(item => item.id === agent.id), false);
});

test('WebSocket requires same origin and exact agent identity', async t => {
  const { base } = await start(t);
  const state = await (await fetch(`${base}/api/state`)).json();
  const agent = state.agents[0];
  const url = `${base.replace('http:', 'ws:')}/api/terminal?mode=demo&paneId=${encodeURIComponent(agent.id)}&identity=${agent.identity}`;
  const denied = new WebSocket(url, { origin: 'https://evil.example' });
  const error = await once(denied, 'error'); assert.match(error[0].message, /403/);
  const ws = new WebSocket(url, { origin: base });
  t.after(() => ws.terminate());
  const received = [];
  ws.on('message', data => received.push(JSON.parse(data)));
  await once(ws, 'open');
  await new Promise(resolve => setTimeout(resolve, 50));
  ws.send(JSON.stringify({ type: 'input', data: 'status\r' }));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(received.some(message => message.type === 'status' && message.message.includes('Demo')));
  assert.ok(received.some(message => message.type === 'output' && message.data.includes('All systems nominal')));
  ws.close(); await once(ws, 'close');
});

test('static server never serves files outside dist', async t => {
  const { base } = await start(t, { distDir: '/tmp/weherd-no-such-dist' });
  assert.equal((await fetch(`${base}/%2e%2e%2fpackage.json`)).status, 400);
  assert.equal((await fetch(`${base}/%00`)).status, 400);
  assert.equal((await fetch(`${base}/api/not-a-route`)).status, 404);
});
