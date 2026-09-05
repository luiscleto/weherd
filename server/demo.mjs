import { EventEmitter } from 'node:events';
import { planClose } from './herdr.mjs';

export function createDemoSnapshot() {
  const roster = [
    ['atlas', 'Atlas', 'codex', 'working', 'wDemo1'],
    ['nova', 'Nova', 'claude', 'blocked', 'wDemo1'],
    ['sage', 'Sage', 'gemini', 'idle', 'wDemo2'],
    ['pixel', 'Pixel', 'codex', 'done', 'wDemo2'],
    ['orbit', 'Orbit', 'claude', 'working', 'wDemo3'],
    ['echo', 'Echo', 'codex', 'unknown', 'wDemo3'],
  ];
  const workspaces = ['Studio', 'Product', 'Research'].map((label, index) => ({ workspace_id: `wDemo${index + 1}`, label }));
  const agents = roster.map(([id, name, agent, agent_status, workspace_id]) => ({
    pane_id: `${workspace_id}:p${id}`, terminal_id: `demo_${id}`, name, agent,
    agent_status, workspace_id, tab_id: `${workspace_id}:t1`, cwd: '/demo/office',
  }));
  return { version: 'demo', protocol: 20, workspaces, agents, panes: agents.map(agent => ({ ...agent })), tabs: [] };
}

export class DemoOffice {
  constructor() { this.state = createDemoSnapshot(); }
  reset() { this.state = createDemoSnapshot(); return { ok: true, message: 'Demo office reset.' }; }
  async snapshot() { return structuredClone(this.state); }
  async close(paneId, options) {
    const plan = planClose(this.state, paneId, options);
    const removed = item => options.deleteWorkspace ? item.workspace_id === plan.agent.workspaceId : item.pane_id === paneId;
    this.state.agents = this.state.agents.filter(item => !removed(item));
    this.state.panes = this.state.panes.filter(item => !removed(item));
    if (options.deleteWorkspace) this.state.workspaces = this.state.workspaces.filter(item => item.workspace_id !== plan.agent.workspaceId);
    return { ok: true, message: options.deleteWorkspace ? 'Demo workspace closed.' : 'Demo agent closed.' };
  }
  terminal(agent) { return new DemoTerminal(agent); }
}

class DemoTerminal extends EventEmitter {
  constructor(agent) {
    super(); this.closed = false; this.line = '';
    queueMicrotask(() => {
      if (this.closed) return;
      this.emit('status', 'Demo terminal · local simulation');
      this.emit('output', `\x1b[2J\x1b[H\x1b[1;36m${agent.name} / OFFICE TERMINAL\x1b[0m\r\nDemo mode. No Herdr terminal is connected.\r\nTry help, status, coffee, clear, or any message.\r\n\r\n\x1b[32m❯\x1b[0m `);
    });
  }
  send(message) {
    if (this.closed || message?.type === 'resize') return;
    if (message?.type !== 'input' || typeof message.data !== 'string') return;
    for (const character of message.data.slice(0, 65536)) {
      if (character === '\r' || character === '\n') {
        const command = this.line.trim(); this.line = '';
        const answers = { help: 'Commands: help, status, coffee, clear', status: 'All systems nominal. This is a safe demo terminal.', coffee: '☕ Fresh coffee acquired. Back in five.', clear: '\x1b[2J\x1b[H' };
        const answer = answers[command] ?? (command ? `Message received: ${command}` : '');
        this.emit('output', `\r\n${answer}\r\n\x1b[32m❯\x1b[0m `);
      } else if (character === '\x7f' || character === '\b') {
        if (this.line) { this.line = this.line.slice(0, -1); this.emit('output', '\b \b'); }
      } else if (character === '\x03') { this.line = ''; this.emit('output', '^C\r\n\x1b[32m❯\x1b[0m '); }
      else if (character >= ' ' && character !== '\x7f' && this.line.length < 4096) { this.line += character; this.emit('output', character); }
    }
  }
  close() { if (!this.closed) { this.closed = true; this.emit('closed'); } }
}
