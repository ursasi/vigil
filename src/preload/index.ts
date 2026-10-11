import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type VigilApi } from '../shared/ipc'
import type { ResolvedTunnel, SshHostEntry, TunnelStatus, VigilConfig } from '../shared/types'

const api: VigilApi = {
  getStatuses: () => ipcRenderer.invoke(IPC.getStatuses) as Promise<TunnelStatus[]>,
  getConfig: () => ipcRenderer.invoke(IPC.getConfig) as Promise<VigilConfig>,
  saveConfig: (config) => ipcRenderer.invoke(IPC.saveConfig, config) as Promise<VigilConfig>,
  listSshHosts: () => ipcRenderer.invoke(IPC.listSshHosts) as Promise<SshHostEntry[]>,
  getAgentStatus: () =>
    ipcRenderer.invoke(IPC.agentStatus) as Promise<{ installed: boolean }>,
  setAgent: (enabled) =>
    ipcRenderer.invoke(IPC.setAgent, enabled) as Promise<{ installed: boolean }>,
  getTopology: () => ipcRenderer.invoke(IPC.getTopology) as Promise<ResolvedTunnel[]>,
  refreshTopology: () =>
    ipcRenderer.invoke(IPC.refreshTopology) as Promise<ResolvedTunnel[]>,
  getSshCommand: (id) => ipcRenderer.invoke(IPC.getSshCommand, id) as Promise<string>,
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text) as Promise<void>,
  getLogs: () =>
    ipcRenderer.invoke(IPC.getLogs) as Promise<{
      path: string
      displayPath: string
      lines: string[]
      bytes: number
    }>,
  clearLogs: () => ipcRenderer.invoke(IPC.clearLogs) as Promise<void>,
  start: (id) => ipcRenderer.invoke(IPC.start, id),
  stop: (id) => ipcRenderer.invoke(IPC.stop, id),
  restart: (id) => ipcRenderer.invoke(IPC.restart, id),
  restartAll: () => ipcRenderer.invoke(IPC.restartAll),
  openLogs: () => ipcRenderer.invoke(IPC.openLogs),
  revealConfig: () => ipcRenderer.invoke(IPC.revealConfig),
  onStatus: (cb) => {
    const listener = (_e: unknown, statuses: TunnelStatus[]): void => cb(statuses)
    ipcRenderer.on(IPC.statusChanged, listener)
    return () => ipcRenderer.removeListener(IPC.statusChanged, listener)
  },
  onTopology: (cb) => {
    const listener = (_e: unknown, topology: ResolvedTunnel[]): void => cb(topology)
    ipcRenderer.on(IPC.topologyChanged, listener)
    return () => ipcRenderer.removeListener(IPC.topologyChanged, listener)
  },
  onPowerEvent: (cb) => {
    const listener = (_e: unknown, event: string): void => cb(event)
    ipcRenderer.on(IPC.powerEvent, listener)
    return () => ipcRenderer.removeListener(IPC.powerEvent, listener)
  }
}

contextBridge.exposeInMainWorld('vigil', api)
