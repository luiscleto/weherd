import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once, EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { agentIdentity, HerdrClient, normalizeSnapshot, planClose, TerminalSession } from './herdr.mjs';
import { createDemoSnapshot } from './demo.mjs';
import { closeLiveAgent } from './index.mjs';

const options = (agent, extra = {}) => ({ allowWorking: false, deleteWorkspace: false, expectedIdentity: agentIdentity(agent), ...extra });

test('normalization preserves named agents, maps lifecycle states, excludes plain shells', () => {
  const snapshot = createDemoSnapshot();
  snapshot.agents.push({ ...snapshot.agents[0], pane_id: 'plain', agent: null });
  const result = normalizeSnapshot(snapshot);
  assert.equal(result.length, 6);
  assert.deepEqual(result.map(agent => agent.status), ['working', 'blocked', 'idle', 'done', 'working', 'unknown']);
  assert.equal(result[0].name, 'Atlas');
  assert.equal(result[0].workspaceName, 'Studio');
  snapshot.agents[2].launch_pending = true;
  assert.equal(normalizeSnapshot(snapshot)[2].status, 'working');
});

test('unsupported protocol and inconsistent pane identities fail closed', () => {
  const snapshot = createDemoSnapshot();
  snapshot.protocol = 21;
  assert.throws(() => normalizeSnapshot(snapshot), /Unsupported/);
  snapshot.protocol = 20;
  snapshot.panes[0].terminal_id = 'replacement';
  assert.throws(() => normalizeSnapshot(snapshot), /inconsistent/);
});

test('active, blocked, unknown, and launch-pending agents are protected by default', () => {
  const snapshot = createDemoSnapshot();
  for (const agent of snapshot.agents.filter(agent => !['idle', 'done'].includes(agent.agent_status))) {
    assert.throws(() => planClose(snapshot, agent.pane_id, options(agent)), /Protected/);
    assert.equal(planClose(snapshot, agent.pane_id, options(agent, { allowWorking: true })).method, 'pane.close');
  }
  snapshot.agents[2].launch_pending = true;
  assert.throws(() => planClose(snapshot, snapshot.agents[2].pane_id, options(snapshot.agents[2])), /Protected/);
});

test('workspace closure checks other agents and refuses repository group cascades', () => {
  const snapshot = createDemoSnapshot(), agent = snapshot.agents[0];
  agent.agent_status = 'idle';
  assert.throws(() => planClose(snapshot, agent.pane_id, options(agent, { deleteWorkspace: true })), /Protected/);
  assert.equal(planClose(snapshot, agent.pane_id, options(agent, { deleteWorkspace: true, allowWorking: true })).method, 'workspace.close');
  snapshot.workspaces[0].worktree = { repo_key: 'r', is_linked_worktree: false };
  snapshot.workspaces[1].worktree = { repo_key: 'r', is_linked_worktree: true };
  assert.throws(() => planClose(snapshot, agent.pane_id, options(agent, { deleteWorkspace: true, allowWorking: true })), /linked workspaces/);
});

test('replacement occupant cannot be closed with the old identity', () => {
  const snapshot = createDemoSnapshot(), agent = snapshot.agents[2];
  const original = options(agent);
  agent.agent_session = { kind: 'id', agent: 'codex', source: 'integration', value: 'new-session' };
  assert.throws(() => planClose(snapshot, agent.pane_id, original), /different agent/);
  assert.throws(() => planClose(snapshot, agent.pane_id, { ...options(agent), allowWorking: 'false' }), /booleans/);
});

test('direct Unix NDJSON client handles partial frames and response IDs', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'weherd-protocol-'));
  const socketPath = path.join(directory, 'api.sock');
  let wrongId = false;
  const server = net.createServer(socket => {
    socket.once('data', data => {
      const request = JSON.parse(data.toString());
      assert.equal(request.method, 'session.snapshot');
      const response = JSON.stringify({ id: wrongId ? 'wrong' : request.id, result: { type: 'session_snapshot', snapshot: createDemoSnapshot() } }) + '\n';
      socket.write(response.slice(0, 19));
      setTimeout(() => socket.end(response.slice(19)), 5);
    });
  });
  server.listen(socketPath); await once(server, 'listening');
  t.after(async () => { server.close(); await once(server, 'close'); await rm(directory, { recursive: true, force: true }); });
  const client = new HerdrClient({ socketPath });
  assert.equal((await client.snapshot()).agents.length, 6);
  wrongId = true;
  await assert.rejects(client.snapshot(), /identity mismatch/);
});

test('last-pane closure preserves workspace by creating and verifying a replacement shell first', async () => {
  const snapshot = createDemoSnapshot();
  snapshot.agents = [snapshot.agents[2]]; snapshot.panes = [{ ...snapshot.agents[0] }];
  const agent = snapshot.agents[0], calls = [];
  const replacement = { pane_id: 'new-pane', terminal_id: 'new-term', workspace_id: agent.workspace_id };
  const client = {
    async snapshot() { return structuredClone(snapshot); },
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'tab.create') { snapshot.panes.push(replacement); return { type: 'tab_created', root_pane: replacement }; }
      if (method === 'pane.close') { snapshot.panes = snapshot.panes.filter(pane => pane.pane_id !== params.pane_id); snapshot.agents = []; return { type: 'ok' }; }
      throw new Error('Unexpected method');
    },
  };
  assert.equal((await closeLiveAgent(client, agent.pane_id, options(agent))).ok, true);
  assert.deepEqual(calls.map(call => call.method), ['tab.create', 'pane.close']);
  assert.equal(calls[0].params.focus, false);
  assert.equal(calls[0].params.workspace_id, agent.workspace_id);
  assert.equal(snapshot.panes[0].pane_id, replacement.pane_id);
});

test('state changing to working during replacement creation aborts close', async () => {
  const snapshot = createDemoSnapshot();
  snapshot.agents = [snapshot.agents[2]]; snapshot.panes = [{ ...snapshot.agents[0] }];
  const agent = snapshot.agents[0], calls = [];
  const client = {
    async snapshot() { return structuredClone(snapshot); },
    async request(method) {
      calls.push(method); assert.equal(method, 'tab.create');
      const replacement = { pane_id: 'new-pane', terminal_id: 'new-term', workspace_id: agent.workspace_id };
      snapshot.panes.push(replacement); snapshot.agents[0].agent_status = 'working';
      return { root_pane: replacement };
    },
  };
  await assert.rejects(closeLiveAgent(client, agent.pane_id, options(agent)), /Protected/);
  assert.deepEqual(calls, ['tab.create']);
});

test('terminal adapter translates framed output, text, resize and releases only its subprocess', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  let killed = false, input = '', spawnArgs;
  child.stdin.on('data', data => { input += data; }); child.kill = () => { killed = true; };
  const client = new HerdrClient({ socketPath: '/tmp/explicit.sock', spawnProcess: (binary, args, config) => { spawnArgs = { binary, args, config }; return child; } });
  const terminal = new TerminalSession(client, { terminalId: 'term_owned' });
  assert.equal(spawnArgs.config.shell, false);
  assert.equal(spawnArgs.config.env.HERDR_SOCKET_PATH, '/tmp/explicit.sock');
  assert.equal(spawnArgs.args.includes('--takeover'), false);
  const output = once(terminal, 'output');
  child.stdout.write(JSON.stringify({ type: 'terminal.frame', encoding: 'ansi', full: true, seq: 1, width: 100, height: 30, bytes: Buffer.from('\x1b[Hhello').toString('base64') }) + '\n');
  assert.equal((await output)[0], '\x1b[Hhello');
  terminal.send({ type: 'input', data: 'echo $HOME\r' });
  terminal.send({ type: 'resize', cols: 80, rows: 24 });
  assert.throws(() => terminal.send({ type: 'resize', cols: 0, rows: 24 }), /Invalid/);
  terminal.close();
  const messages = input.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(messages, [{ type: 'terminal.input', text: 'echo $HOME\r' }, { type: 'terminal.resize', cols: 80, rows: 24 }, { type: 'terminal.release' }]);
  assert.equal(killed, true);
});
