import type { ResolvedTunnel, SshHostEntry, TunnelStatus, VigilConfig } from './types'

export const IPC = {
  getStatuses: 'vigil:get-statuses',
  getConfig: 'vigil:get-config',
  saveConfig: 'vigil:save-config',
  listSshHosts: 'vigil:list-ssh-hosts',
  agentStatus: 'vigil:agent-status',
  setAgent: 'vigil:set-agent',
  getTopology: 'vigil:get-topology',
  refreshTopology: 'vigil:refresh-topology',
  getSshCommand: 'vigil:get-ssh-command',
  copyText: 'vigil:copy-text',
  getLogs: 'vigil:get-logs',
  clearLogs: 'vigil:clear-logs',
  start: 'vigil:start',
  stop: 'vigil:stop',
  restart: 'vigil:restart',
  restartAll: 'vigil:restart-all',
  openLogs: 'vigil:open-logs',
  revealConfig: 'vigil:reveal-config',
  statusChanged: 'vigil:status-changed',
  topologyChanged: 'vigil:topology-changed',
  powerEvent: 'vigil:power-event'
} as const

/** The API surface exposed to the renderer via contextBridge. */
export interface VigilApi {
  getStatuses(): Promise<TunnelStatus[]>
  getConfig(): Promise<VigilConfig>
  saveConfig(config: VigilConfig): Promise<VigilConfig>
  listSshHosts(): Promise<SshHostEntry[]>
  getAgentStatus(): Promise<{ installed: boolean }>
  setAgent(enabled: boolean): Promise<{ installed: boolean }>
  getTopology(): Promise<ResolvedTunnel[]>
  refreshTopology(): Promise<ResolvedTunnel[]>
  getSshCommand(id: string): Promise<string>
  copyText(text: string): Promise<void>
  getLogs(): Promise<{ path: string; displayPath: string; lines: string[]; bytes: number }>
  clearLogs(): Promise<void>
  start(id: string): Promise<void>
  stop(id: string): Promise<void>
  restart(id: string): Promise<void>
  restartAll(): Promise<void>
  openLogs(): Promise<void>
  revealConfig(): Promise<void>
  onStatus(cb: (statuses: TunnelStatus[]) => void): () => void
  onTopology(cb: (topology: ResolvedTunnel[]) => void): () => void
  onPowerEvent(cb: (event: string) => void): () => void
}
