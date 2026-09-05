import './style.css';
import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Office } from './office';
import { statusLabel, type Agent, type Mode, type OfficeState } from './types';

const icons = {
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m9.2 3-.5 2.1-2 .9-1.9-.7-2.1 3.6 1.6 1.5v2.3l-1.6 1.5 2.1 3.6 2-.7 1.9 1 .5 2.1h4.2l.5-2.1 2-1 1.9.7 2.1-3.6-1.6-1.5v-2.3l1.6-1.5-2.1-3.6-1.9.7-2-.9-.5-2.1z"/><circle cx="11.3" cy="11.5" r="3.2"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 6 12 12M6 18 18 6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>',
  coffee: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 9h12v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3zm12 1h2a3 3 0 0 1 0 6h-2M3 22h15M7 3v3m5-3v3"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 9h4l5-4v14l-5-4H5zM18 8a7 7 0 0 1 0 8"/></svg>',
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="office-app">
    <div id="office" class="office-canvas"></div>
    <div class="vignette" aria-hidden="true"></div>
    <header class="topbar">
      <a class="brand" href="/" aria-label="Weherd home"><span class="brand-mark">w<span>•</span></span><span>weherd<span class="brand-period">.</span></span></a>
      <div class="topbar-right">
        <span class="connection" id="connection"><span class="connection-dot"></span><span id="connection-label">Connecting to Herdr</span></span>
        <div class="mode-switch" role="group" aria-label="Office data source"><button id="live-mode" aria-pressed="true">Live office</button><button id="demo-mode" aria-pressed="false">Demo</button></div>
        <button class="icon-button" id="settings-button" aria-label="Office settings" title="Office settings">${icons.gear}</button>
      </div>
    </header>

    <section class="intro" aria-label="Office overview">
      <div class="eyebrow"><span></span> A LITTLE OFFICE FOR YOUR AGENTS</div>
      <h1>Good work.<br>Good company.</h1>
      <p>Your agents have a place to be.<br>Drop in. Check in. Keep things moving.</p>
      <div class="office-meta"><span class="floor-number">01</span><span>THE OPEN SPACE<br><strong id="occupancy">Opening the office…</strong></span></div>
    </section>

    <aside class="roster-panel" aria-label="Office team">
      <div class="roster-heading"><div><span class="eyebrow">HERE TODAY</span><h2>The team <span id="team-count">0</span></h2></div><span class="live-pip" id="roster-pip"></span></div>
      <div class="status-summary"><span><i class="status-dot working"></i><b id="working-count">0</b> working</span><span><i class="status-dot blocked"></i><b id="blocked-count">0</b> need you</span></div>
      <div id="agent-list" class="agent-list" aria-live="polite"></div>
      <div class="roster-footer">${icons.coffee}<span>A break is part of the process.</span></div>
    </aside>

    <div id="mode-note" class="mode-note" hidden><span class="demo-badge">DEMO OFFICE</span><span>Fictional teammates. Make yourself at home.</span><button id="reset-demo">Reset demo ↻</button></div>
    <div id="bridge-error" class="bridge-error" role="status" hidden></div>
    <div id="interaction" class="interaction" hidden><kbd>E</kbd><div><span id="interaction-name"></span><small>Open terminal</small></div><span class="interaction-arrow">↗</span></div>
    <div class="bottom-bar">
      <div class="controls"><div class="control-group"><span class="key-cluster"><kbd>W</kbd><span><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></span><span>Move</span></div><i></i><div class="control-group"><kbd>E</kbd><span>Say hello</span></div><i></i><div class="control-group"><kbd>Q</kbd><span id="weapon-label">Equip shotgun</span></div><i></i><div class="control-group secondary-control"><span class="mouse-icon"></span><span>Scroll to zoom</span></div></div>
      <button id="equipment-button" class="equipment-button" aria-pressed="false"><span class="equipment-icon">↗</span><div><span id="equipment-title">JUST VISITING</span><small id="equipment-subtitle">Shotgun holstered</small></div><kbd>Q</kbd></button>
    </div>
    <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
    <div id="webgl-error" class="webgl-error" hidden><h2>This office needs WebGL</h2><p>Enable hardware acceleration in your browser and reload to step inside.</p><button onclick="location.reload()">Reload office</button></div>
  </main>

  <dialog id="settings-dialog" class="settings-dialog">
    <div class="dialog-heading"><div><span class="eyebrow">MAKE YOURSELF AT HOME</span><h2>Office settings</h2></div><button class="icon-button" id="settings-close" aria-label="Close settings">${icons.close}</button></div>
    <p class="dialog-description">A few ground rules for the open space.</p>
    <div class="setting-section-label">THE SHOTGUN</div>
    <label class="setting-row"><span><strong>Allow closing active agents</strong><small>Shots can close working, blocked, and unknown agents. With this off, only idle or done agents can be closed.</small></span><input type="checkbox" id="allow-working" role="switch"><span class="switch-track" aria-hidden="true"></span></label>
    <label class="setting-row"><span><strong>Close entire workspace</strong><small>A hit closes the agent’s workspace and every terminal in it. Active agent protection still applies. Checkout files are kept.</small></span><input type="checkbox" id="delete-workspace" role="switch"><span class="switch-track" aria-hidden="true"></span></label>
    <div class="setting-note"><span>↗</span><p>In the live office, a hit closes a real Herdr terminal. The demo office is a safe place to try it out.</p></div>
    <div class="setting-section-label">FIND YOUR FEET</div>
    <div class="settings-controls"><span>Move / sprint</span><span><kbd>W A S D</kbd> / <kbd>Shift</kbd></span><span>Interact with a nearby agent</span><kbd>E</kbd><span>Equip / holster shotgun</span><kbd>Q</kbd><span>Aim / fire</span><span>Mouse / left click</span><span>Close terminal / settings</span><span><kbd>Shift Esc</kbd> / <kbd>Esc</kbd></span></div>
    <button id="reset-view" class="text-button">Reset camera view ${icons.arrow}</button>
    <button id="settings-done" class="primary-button">Back to the office ${icons.arrow}</button>
  </dialog>

  <dialog id="terminal-dialog" class="terminal-dialog">
    <div class="terminal-heading"><div class="terminal-avatar" id="terminal-avatar">A</div><div class="terminal-title"><span class="eyebrow" id="terminal-workspace">HERDR TERMINAL</span><h2 id="terminal-name">Agent terminal</h2></div><span id="terminal-state" class="terminal-state">Connecting…</span><button class="terminal-close" id="terminal-close">Close <kbd>Shift Esc</kbd>${icons.close}</button></div>
    <div id="terminal-notice" class="terminal-notice" role="status" hidden></div>
    <div id="terminal-container" class="terminal-container"></div>
    <div class="terminal-footer"><span><span class="connection-dot"></span><span id="terminal-footer-label">Connecting to terminal</span></span><button id="terminal-reconnect" class="text-button">Reconnect ↻</button><span>Type directly · Ctrl+C sends interrupt</span></div>
  </dialog>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const settingsDialog = $<HTMLDialogElement>('settings-dialog');
const terminalDialog = $<HTMLDialogElement>('terminal-dialog');
let mode: Mode = new URL(location.href).searchParams.get('mode') === 'demo' ? 'demo' : 'live';
let agents: Agent[] = [];
let connected = false;
let office: Office | null = null;
let activeAgent: Agent | null = null;
let terminal: Terminal | null = null;
let terminalFit: FitAddon | null = null;
let terminalSocket: WebSocket | null = null;
let terminalObserver: ResizeObserver | null = null;
let lastTrigger: HTMLElement | null = null;
let stateVersion = 0;
let toastTimer = 0;
let polling = false;
let closing = new Set<string>();
const preferences = (() => { try { return JSON.parse(localStorage.getItem(`weherd-settings-${mode}`) || '{}') as { allowWorking?: boolean; deleteWorkspace?: boolean }; } catch { return {}; } })();
$<HTMLInputElement>('allow-working').checked = preferences.allowWorking === true;
$<HTMLInputElement>('delete-workspace').checked = preferences.deleteWorkspace === true;

function notify(message: string) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { $('toast').hidden = true; }, 4200); }
function syncPaused() { office?.setPaused(settingsDialog.open || terminalDialog.open); }
function setNear(agent: Agent | null) { $('interaction').hidden = !agent || terminalDialog.open || settingsDialog.open; if (agent) $('interaction-name').textContent = agent.name; }

try {
  office = new Office($('office'), {
    near: setNear,
    shoot: agent => { void closeAgent(agent); },
    equipped: value => {
      $('equipment-button').classList.toggle('is-equipped', value); $('equipment-button').setAttribute('aria-pressed', String(value));
      $('equipment-title').textContent = value ? 'SHOTGUN EQUIPPED' : 'JUST VISITING';
      $('equipment-subtitle').textContent = value ? 'Aim with mouse · click to fire' : 'Shotgun holstered';
      $('weapon-label').textContent = value ? 'Holster shotgun' : 'Equip shotgun';
      if (value) notify(mode === 'live' ? 'Shotgun equipped. Hits close real Herdr terminals.' : 'Demo shotgun equipped. Aim at a teammate and click.');
    },
    interact: () => { const agent = office?.getNearest(); if (agent) openTerminal(agent); else notify('Walk a little closer to an agent, then press E.'); },
  });
} catch (error) { console.error('Unable to initialize the office', error); $('webgl-error').hidden = false; }

function renderState(state: OfficeState) {
  agents = state.agents; connected = state.connected;
  office?.setAgents(agents);
  setNear(office?.getNearest() ?? null);
  $('connection').classList.toggle('is-connected', connected);
  $('connection-label').textContent = mode === 'demo' ? 'Demo playground' : connected ? 'Herdr connected' : 'Herdr disconnected';
  $('roster-pip').classList.toggle('offline', !connected);
  $('team-count').textContent = String(agents.length);
  $('occupancy').textContent = `${agents.length} ${agents.length === 1 ? 'agent' : 'agents'} in the office`;
  $('working-count').textContent = String(agents.filter(a => a.status === 'working').length);
  $('blocked-count').textContent = String(agents.filter(a => a.status === 'blocked').length);
  $('bridge-error').hidden = !state.error;
  if (state.error) $('bridge-error').textContent = state.error;
  const list = $('agent-list');
  const signature = agents.map(a => `${a.id}:${a.identity}:${a.name}:${a.status}:${a.workspaceName}`).join('|');
  if (list.dataset.signature !== signature) {
    list.dataset.signature = signature; list.replaceChildren();
    if (!agents.length) {
      const empty = document.createElement('div'); empty.className = 'empty-team';
      empty.textContent = connected ? 'The office is quiet. Start an agent in Herdr and they’ll move right in.' : 'Waiting for Herdr. You can explore the demo while the office reconnects.'; list.append(empty);
    }
    for (const agent of agents) {
      const button = document.createElement('button'); button.className = `agent-row ${agent.status}`; button.dataset.agentId = agent.id;
      button.title = `${agent.name} · ${agent.workspaceName} · ${statusLabel[agent.status]}. Locate in the office.`;
      const avatar = document.createElement('span'); avatar.className = 'agent-avatar'; avatar.textContent = agent.name.slice(0, 1).toUpperCase();
      const text = document.createElement('span'); text.className = 'agent-row-text';
      const name = document.createElement('strong'); name.textContent = agent.name;
      const subtitle = document.createElement('small'); subtitle.textContent = agent.workspaceName || agent.kind || 'Herdr workspace'; text.append(name, subtitle);
      const status = document.createElement('span'); status.className = `agent-status ${agent.status}`; status.textContent = statusLabel[agent.status];
      button.append(avatar, text, status);
      button.addEventListener('click', () => { office?.focusAgent(agent.id); notify(`${agent.name} is highlighted. Walk over and press E to open their terminal.`); }); list.append(button);
    }
  }
  if (activeAgent && !agents.some(a => a.id === activeAgent!.id && a.identity === activeAgent!.identity)) {
    terminalSocket?.close(); showTerminalNotice('This terminal is no longer in the office. Close this panel to return.');
  }
}

async function pollState() {
  if (polling) return;
  polling = true; const version = stateVersion;
  try {
    const response = await fetch(`/api/state?mode=${mode}`, { signal: AbortSignal.timeout(6500), cache: 'no-store' });
    if (!response.ok) throw new Error(`Office bridge returned ${response.status}`);
    const state = await response.json() as OfficeState;
    if (version === stateVersion) renderState(state);
  } catch (error) {
    if (version === stateVersion) renderState({ mode, connected: false, agents: [], error: `Can’t reach the office bridge. ${error instanceof Error ? error.message : 'Retrying shortly.'}` });
  } finally { polling = false; }
}

function setMode(next: Mode) {
  if (mode !== next) {
    closeTerminal(); mode = next; stateVersion++; office?.setEquipped(false); agents = []; office?.setAgents([]);
    if (next === 'live') { $<HTMLInputElement>('allow-working').checked = false; $<HTMLInputElement>('delete-workspace').checked = false; }
  }
  $('live-mode').setAttribute('aria-pressed', String(mode === 'live')); $('demo-mode').setAttribute('aria-pressed', String(mode === 'demo'));
  $('mode-note').hidden = mode !== 'demo';
  const url = new URL(location.href); url.searchParams.set('mode', mode); history.replaceState(null, '', url);
  void pollState();
}

async function closeAgent(agent: Agent) {
  if (closing.has(agent.id)) return;
  if (!connected) { notify('The office is disconnected. Reconnect before closing a terminal.'); return; }
  const allowWorking = $<HTMLInputElement>('allow-working').checked;
  const deleteWorkspace = $<HTMLInputElement>('delete-workspace').checked;
  if (!['idle', 'done'].includes(agent.status) && !allowWorking) { notify(`${agent.name} is protected. Enable closing active agents in settings to change this.`); return; }
  closing.add(agent.id);
  try {
    const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/close?mode=${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowWorking, deleteWorkspace, expectedIdentity: agent.identity }), signal: AbortSignal.timeout(10000) });
    const result = await response.json() as { ok?: boolean; message?: string; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to close this terminal.');
    notify(result.message || `${agent.name} has left the office.`); void pollState();
  } catch (error) { notify(error instanceof Error ? error.message : 'Unable to close terminal.'); }
  finally { closing.delete(agent.id); }
}

function showTerminalNotice(message: string) { $('terminal-notice').textContent = message; $('terminal-notice').hidden = false; }
function terminalSend(message: object) { if (terminalSocket?.readyState === WebSocket.OPEN) terminalSocket.send(JSON.stringify(message)); }
function fitTerminal() { if (!terminal || !terminalFit || !terminalDialog.open) return; try { terminalFit.fit(); terminalSend({ type: 'resize', cols: terminal.cols, rows: terminal.rows }); } catch { /* The next resize will fit after layout. */ } }

function connectTerminal(agent: Agent) {
  const previous = terminalSocket; terminalSocket = null; previous?.close();
  $('terminal-notice').hidden = true; $('terminal-state').textContent = 'Connecting…'; $('terminal-footer-label').textContent = 'Connecting to terminal';
  if (terminal) terminal.options.disableStdin = true;
  const url = new URL('/api/terminal', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('paneId', agent.id); url.searchParams.set('mode', mode); url.searchParams.set('identity', agent.identity);
  const socket = new WebSocket(url); terminalSocket = socket;
  socket.addEventListener('open', () => { if (terminalSocket !== socket) return; fitTerminal(); });
  socket.addEventListener('message', event => {
    if (terminalSocket !== socket || !terminal) return;
    try {
      const message = JSON.parse(String(event.data)) as { type: string; data?: string; message?: string; encoding?: string; full?: boolean; cols?: number; rows?: number };
      if (message.type === 'status' || message.type === 'output') {
        if (terminal.options.disableStdin) { terminal.options.disableStdin = false; terminal.focus(); }
        $('terminal-state').textContent = 'Connected';
      }
      if (message.type === 'output' && typeof message.data === 'string') {
        if (message.full) { terminal.reset(); if (message.cols && message.rows) terminal.resize(message.cols, message.rows); }
        terminal.write(message.encoding === 'base64' ? Uint8Array.from(atob(message.data), c => c.charCodeAt(0)) : message.data);
      } else if (message.type === 'error') { terminal.options.disableStdin = true; showTerminalNotice(message.message || 'Unable to control this terminal.'); $('terminal-state').textContent = 'Unavailable'; }
      else if (message.type === 'status') { $('terminal-footer-label').textContent = message.message || 'Connected'; }
    } catch { showTerminalNotice('The terminal bridge sent an unreadable message. Try reconnecting.'); }
  });
  socket.addEventListener('error', () => { if (terminalSocket === socket) showTerminalNotice('Could not connect to the terminal. The bridge may be restarting.'); });
  socket.addEventListener('close', () => { if (terminalSocket === socket) { if (terminal) terminal.options.disableStdin = true; $('terminal-state').textContent = 'Disconnected'; $('terminal-footer-label').textContent = 'Terminal disconnected'; if ($('terminal-notice').hidden) showTerminalNotice('Terminal connection closed. Reconnect to attach again.'); } });
}

function openTerminal(agent: Agent) {
  if (settingsDialog.open || terminalDialog.open) return;
  activeAgent = agent; lastTrigger = document.activeElement as HTMLElement;
  $('terminal-name').textContent = agent.name; $('terminal-workspace').textContent = agent.workspaceName || 'HERDR TERMINAL'; $('terminal-avatar').textContent = agent.name.slice(0, 1).toUpperCase();
  terminalDialog.showModal(); syncPaused(); $('interaction').hidden = true;
  terminal = new Terminal({ cursorBlink: true, disableStdin: true, fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', fontSize: 14, lineHeight: 1.28, scrollback: 7000, allowProposedApi: false, theme: { background: '#192923', foreground: '#e7eee4', cursor: '#d5e987', selectionBackground: '#63856880', black: '#192923', red: '#ed8277', green: '#c2d98a', yellow: '#edc38b', blue: '#8ab8d3', magenta: '#cda7ce', cyan: '#85cab5', white: '#e7eee4', brightBlack: '#718879' } });
  terminalFit = new FitAddon(); terminal.loadAddon(terminalFit); terminal.open($('terminal-container'));
  terminal.onData(data => terminalSend({ type: 'input', data }));
  terminal.attachCustomKeyEventHandler(event => { if (event.key === 'Escape' && event.shiftKey && event.type === 'keydown') { closeTerminal(); return false; } return true; });
  terminalObserver = new ResizeObserver(fitTerminal); terminalObserver.observe($('terminal-container'));
  requestAnimationFrame(() => { if (activeAgent === agent && terminalDialog.open) { fitTerminal(); connectTerminal(agent); } });
}

function closeTerminal() {
  activeAgent = null;
  const socket = terminalSocket; terminalSocket = null; socket?.close();
  terminalObserver?.disconnect(); terminalObserver = null; terminal?.dispose(); terminal = null; terminalFit = null;
  $('terminal-container').replaceChildren(); if (terminalDialog.open) terminalDialog.close(); syncPaused(); setNear(office?.getNearest() ?? null);
  lastTrigger?.focus({ preventScroll: true }); lastTrigger = null;
}

$('settings-button').addEventListener('click', () => { settingsDialog.showModal(); syncPaused(); $('interaction').hidden = true; });
function closeSettings() { settingsDialog.close(); syncPaused(); setNear(office?.getNearest() ?? null); }
$('settings-close').addEventListener('click', closeSettings); $('settings-done').addEventListener('click', closeSettings);
settingsDialog.addEventListener('cancel', () => { requestAnimationFrame(() => { syncPaused(); setNear(office?.getNearest() ?? null); }); });
settingsDialog.addEventListener('click', event => { if (event.target === settingsDialog) { const rect = settingsDialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeSettings(); } });
terminalDialog.addEventListener('cancel', event => { event.preventDefault(); });
terminalDialog.addEventListener('keydown', event => { if (event.key === 'Escape' && event.shiftKey) { event.preventDefault(); closeTerminal(); } });
$('terminal-close').addEventListener('click', closeTerminal); $('terminal-reconnect').addEventListener('click', () => { if (activeAgent) connectTerminal(activeAgent); });
$('live-mode').addEventListener('click', () => setMode('live')); $('demo-mode').addEventListener('click', () => setMode('demo'));
$('equipment-button').addEventListener('click', () => office?.toggleEquipped());
$('reset-view').addEventListener('click', () => { office?.resetView(); notify('Camera back in its happy place.'); });
for (const id of ['allow-working', 'delete-workspace']) $(id).addEventListener('change', () => { try { localStorage.setItem(`weherd-settings-${mode}`, JSON.stringify({ allowWorking: $<HTMLInputElement>('allow-working').checked, deleteWorkspace: $<HTMLInputElement>('delete-workspace').checked })); } catch { notify('Settings apply for this visit; browser storage is unavailable.'); } });
$('reset-demo').addEventListener('click', async () => { try { const response = await fetch('/api/demo/reset?mode=demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (!response.ok) throw new Error('Could not reset the demo.'); notify('Fresh coffee. Fresh demo teammates.'); void pollState(); } catch (error) { notify(error instanceof Error ? error.message : 'Could not reset the demo.'); } });
setMode(mode);
const interval = window.setInterval(() => void pollState(), 1800);
window.addEventListener('beforeunload', () => { clearInterval(interval); closeTerminal(); office?.dispose(); });

// Read-only diagnostics are available solely in the development demo office.
if (import.meta.env.DEV) Object.defineProperty(window, '__WEHERD_DEBUG__', { get: () => mode === 'demo' ? office?.debugSnapshot() : undefined });
