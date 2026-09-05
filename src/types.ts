export type AgentStatus = 'working' | 'blocked' | 'idle' | 'done' | 'unknown';
export type Mode = 'live' | 'demo';
export interface Agent {
  id: string;
  identity: string;
  name: string;
  kind: string;
  status: AgentStatus;
  workspaceId: string;
  workspaceName: string;
  terminalId?: string;
  cwd?: string;
}
export interface OfficeState {
  mode: Mode;
  connected: boolean;
  agents: Agent[];
  error?: string;
}
export const statusLabel: Record<AgentStatus, string> = {
  working: 'Working', blocked: 'Needs you', idle: 'On a break', done: 'All done', unknown: 'Standing by',
};
