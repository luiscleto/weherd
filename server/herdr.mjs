import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';

export class ApiError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function defaultSocketPath(env = process.env) {
  if (env.HERDR_SOCKET_PATH) return env.HERDR_SOCKET_PATH;
  const config = env.HERDR_CONFIG_PATH;
  const base = config ? path.dirname(config) : path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'herdr');
  if (env.HERDR_SESSION && env.HERDR_SESSION !== 'default') {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(env.HERDR_SESSION)) throw new Error('HERDR_SESSION must be a valid Herdr session name.');
    return path.join(base, 'sessions', env.HERDR_SESSION, 'herdr.sock');
  }
  return path.join(base, 'herdr.sock');
}

export function validIdentity(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\0]/u.test(value) && !value.startsWith('-');
}

export function agentIdentity(agent) {
  return createHash('sha256').update(JSON.stringify([
    agent.pane_id, agent.workspace_id, agent.terminal_id, agent.agent,
    agent.name ?? null, agent.agent_session ?? null,
  ])).digest('hex').slice(0, 32);
}

export function normalizeSnapshot(snapshot) {
  if (![19, 20].includes(snapshot?.protocol) || !Array.isArray(snapshot.agents) || !Array.isArray(snapshot.panes) || !Array.isArray(snapshot.workspaces)) {
    throw new ApiError('Unsupported Herdr snapshot. This bridge supports socket protocols 19 and 20.', 503);
  }
  const workspaces = new Map(snapshot.workspaces.map(workspace => [workspace.workspace_id, workspace]));
  const panes = new Map(snapshot.panes.map(pane => [pane.pane_id, pane]));
  const states = new Set(['working', 'blocked', 'idle', 'done', 'unknown']);
  const seen = new Set();
  return snapshot.agents.filter(agent => agent.agent || agent.display_agent || agent.launch_pending).map(agent => {
    const pane = panes.get(agent.pane_id);
    if (!validIdentity(agent.pane_id) || !validIdentity(agent.terminal_id) || seen.has(agent.pane_id) || !pane || pane.terminal_id !== agent.terminal_id || pane.workspace_id !== agent.workspace_id || !workspaces.has(agent.workspace_id)) {
      throw new ApiError('Herdr returned an inconsistent agent identity. Refresh once Herdr settles.', 503);
    }
    seen.add(agent.pane_id);
    const workspace = workspaces.get(agent.workspace_id);
    return {
      id: agent.pane_id,
      name: agent.name || agent.terminal_title_stripped || agent.title || `${agent.display_agent || agent.agent || 'Agent'} · ${agent.pane_id}`,
      kind: agent.display_agent || agent.agent || 'agent',
      status: agent.launch_pending ? 'working' : states.has(agent.agent_status) ? agent.agent_status : 'unknown',
      workspaceId: agent.workspace_id,
      workspaceName: workspace.label || agent.workspace_id,
      terminalId: agent.terminal_id,
      cwd: agent.foreground_cwd || agent.cwd || pane.cwd || '',
      identity: agentIdentity(agent),
    };
  });
}

export function selectAgent(snapshot, paneId, identity) {
  if (!validIdentity(paneId) || typeof identity !== 'string' || !/^[a-f0-9]{32}$/.test(identity)) throw new ApiError('A current agent identity is required. Refresh the office.', 400);
  const agent = normalizeSnapshot(snapshot).find(item => item.id === paneId);
  if (!agent) throw new ApiError('This agent is no longer in Herdr.', 404);
  if (agent.identity !== identity) throw new ApiError('This terminal now contains a different agent. Refresh the office.', 409);
  return agent;
}

export function planClose(snapshot, paneId, options) {
  if (!options || typeof options.allowWorking !== 'boolean' || typeof options.deleteWorkspace !== 'boolean') throw new ApiError('allowWorking and deleteWorkspace must be booleans.', 400);
  const agent = selectAgent(snapshot, paneId, options.expectedIdentity);
  const agents = normalizeSnapshot(snapshot);
  const workspace = snapshot.workspaces.find(item => item.workspace_id === agent.workspaceId);
  const affected = options.deleteWorkspace ? agents.filter(item => item.workspaceId === agent.workspaceId) : [agent];
  if (!options.allowWorking && affected.some(item => !['idle', 'done'].includes(item.status))) {
    throw new ApiError('Protected: working, blocked, and unknown agents can only be closed when “Allow closing active agents” is enabled.', 409);
  }
  if (options.deleteWorkspace) {
    const worktree = workspace.worktree;
    if (worktree && (typeof worktree.is_linked_worktree !== 'boolean' || typeof worktree.repo_key !== 'string')) throw new ApiError('Herdr workspace grouping is ambiguous; close it from Herdr.', 409);
    if (worktree && !worktree.is_linked_worktree && snapshot.workspaces.some(item => item.workspace_id !== agent.workspaceId && item.worktree?.repo_key === worktree.repo_key)) {
      throw new ApiError('Herdr would also close linked workspaces. Close this repository group from Herdr.', 409);
    }
    return { method: 'workspace.close', params: { workspace_id: agent.workspaceId }, agent };
  }
  return { method: 'pane.close', params: { pane_id: agent.id }, agent,
    preserveWorkspace: snapshot.panes.filter(pane => pane.workspace_id === agent.workspaceId).length <= 1 };
}

export class HerdrClient {
  constructor({ socketPath = defaultSocketPath(), timeout = 4000, binary = process.env.HERDR_BIN_PATH || 'herdr', spawnProcess = spawn } = {}) {
    this.socketPath = socketPath; this.timeout = timeout; this.binary = binary; this.spawnProcess = spawnProcess;
  }
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = `weherd:${randomUUID()}`;
      const socket = net.createConnection(this.socketPath);
      let buffer = '', settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true; socket.destroy(); error ? reject(error) : resolve(value);
      };
      socket.setEncoding('utf8');
      socket.setTimeout(this.timeout, () => finish(new ApiError('Herdr did not respond in time.', 503)));
      socket.on('error', error => finish(new ApiError(`Cannot reach Herdr (${error.code || 'socket error'}). Check the local socket path.`, 503)));
      socket.on('end', () => finish(new ApiError('Herdr disconnected before replying.', 503)));
      socket.on('connect', () => socket.write(`${JSON.stringify({ id, method, params })}\n`));
      socket.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 8 * 1024 * 1024) return finish(new ApiError('Herdr response exceeds the bridge limit.'));
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        try {
          const message = JSON.parse(buffer.slice(0, newline));
          if (message.id !== id) throw new ApiError('Herdr response identity mismatch.');
          if (message.error) throw new ApiError(message.error.message || 'Herdr rejected this action.', 409);
          if (!message.result || typeof message.result !== 'object') throw new ApiError('Herdr returned an invalid result.');
          finish(null, message.result);
        } catch (error) { finish(error instanceof ApiError ? error : new ApiError('Herdr returned invalid JSON.')); }
      });
    });
  }
  async snapshot() {
    const result = await this.request('session.snapshot');
    if (result.type !== 'session_snapshot') throw new ApiError('Herdr returned an unexpected snapshot response.');
    normalizeSnapshot(result.snapshot);
    return result.snapshot;
  }
  terminal(agent, options = {}) {
    return new TerminalSession(this, agent, options);
  }
}

// The supported Herdr CLI translates its versioned binary terminal transport to
// NDJSON. Spawn argv directly; browser input only reaches the terminal's stdin.
export class TerminalSession extends EventEmitter {
  constructor(client, agent, { cols = 100, rows = 30, observe = false } = {}) {
    super(); this.closed = false; this.lastSeq = 0; this.buffer = ''; this.stderr = '';
    const args = ['terminal', 'session', observe ? 'observe' : 'control', agent.terminalId, '--cols', String(cols), '--rows', String(rows)];
    this.child = client.spawnProcess(client.binary, args, {
      env: { ...process.env, HERDR_SOCKET_PATH: client.socketPath }, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
    });
    this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.accept(chunk));
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-8192); });
    this.child.stdin.on('error', () => this.fail('Terminal input closed.'));
    this.child.on('error', error => this.fail(`Could not start Herdr terminal bridge (${error.code || error.message}).`));
    this.child.on('exit', code => {
      if (!this.closed) this.fail(this.stderr.trim() || `Herdr terminal session ended${code ? ` (${code})` : ''}.`);
    });
    this.startup = setTimeout(() => this.fail('Herdr terminal did not send an initial frame.'), 8000);
    this.startup.unref();
  }
  accept(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 12 * 1024 * 1024) return this.fail('Terminal frame exceeded the bridge limit.');
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0 && !this.closed) {
      const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      try {
        const frame = JSON.parse(line);
        if (frame.type === 'terminal.closed') return this.fail(frame.reason || 'Terminal closed.');
        if (frame.type !== 'terminal.frame' || frame.encoding !== 'ansi' || typeof frame.full !== 'boolean' || !Number.isSafeInteger(frame.seq) || frame.seq <= this.lastSeq || (!this.lastSeq && !frame.full) || (this.lastSeq && !frame.full && frame.seq !== this.lastSeq + 1) || !Number.isInteger(frame.width) || frame.width < 1 || frame.width > 1000 || !Number.isInteger(frame.height) || frame.height < 1 || frame.height > 1000 || typeof frame.bytes !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.bytes)) {
          throw new Error('Invalid or out-of-order Herdr terminal frame.');
        }
        const bytes = Buffer.from(frame.bytes, 'base64');
        if (bytes.length > 4 * 1024 * 1024) throw new Error('Terminal output exceeded the bridge limit.');
        const first = !this.lastSeq; this.lastSeq = frame.seq; clearTimeout(this.startup);
        if (first) this.emit('status', 'Connected to Herdr. You control this terminal.');
        this.emit('output', bytes.toString('utf8'));
      } catch (error) { this.fail(error.message); }
    }
  }
  send(message) {
    if (this.closed) throw new ApiError('Terminal is closed.', 409);
    let command;
    if (message?.type === 'input' && typeof message.data === 'string' && Buffer.byteLength(message.data) <= 65536) command = { type: 'terminal.input', text: message.data };
    else if (message?.type === 'resize' && Number.isInteger(message.cols) && message.cols >= 2 && message.cols <= 500 && Number.isInteger(message.rows) && message.rows >= 1 && message.rows <= 300) command = { type: 'terminal.resize', cols: message.cols, rows: message.rows };
    else throw new ApiError('Invalid terminal input or dimensions.', 400);
    if (this.child.stdin.writableLength > 1024 * 1024) throw new ApiError('Terminal input is backlogged. Try again.', 429);
    this.child.stdin.write(`${JSON.stringify(command)}\n`);
  }
  fail(message) { if (!this.closed) { this.emit('statusError', message); this.close(); } }
  close() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.startup);
    if (this.child.stdin.writable) this.child.stdin.end(`${JSON.stringify({ type: 'terminal.release' })}\n`);
    this.child.kill('SIGTERM'); // Only this bridge subprocess; the Herdr PTY remains alive.
    this.emit('closed');
  }
}
