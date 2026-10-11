import { app, BrowserWindow, Menu, Tray, ipcMain, shell, nativeImage, clipboard } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { TRAY_ICON_16, TRAY_ICON_32 } from './trayIcon'
import { IPC } from '../shared/ipc'
import type {
  ExternalListener,
  ResolvedTunnel,
  SshHostEntry,
  TunnelConfig,
  TunnelStatus
} from '../shared/types'
import { loadConfig, saveConfig, configPath } from './config'
import { initLogger, log } from './logger'
import { notify } from './notify'
import { registerPowerHandlers } from './power'
import { resolveAll, resolveTunnel, clearResolverCache } from './resolver'
import { checkRemotePort, inspectSshProcess, listListeningOwners, probePorts } from './runtime'
import { listSshConfigHosts } from './sshConfigHosts'
import { buildSshCommand } from './sshCommand'
import { clearLog, readLogTail } from './logs'
import { installAgent, isAgentInstalled, uninstallAgent } from './launchAgent'
import { TunnelSupervisor, type PreflightResult } from './supervisor'
import { loadWindowBounds, saveWindowBounds } from './windowState'
import { resolveLang, t, type Lang } from '../shared/i18n'

let currentLang: Lang = 'en'
function tr(key: string, params?: Record<string, string | number>): string {
  return t(currentLang, key, params)
}

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null
let supervisor: TunnelSupervisor | null = null
let lastStatuses: TunnelStatus[] = []

const isDev = !!process.env.ELECTRON_RENDERER_URL

// Single instance: a second launch just focuses the dashboard.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  main()
}

function main(): void {
  app.whenReady().then(onReady)

  // Menu-bar app: stay alive when all windows are closed.
  app.on('window-all-closed', () => {
    /* keep running in the tray */
  })

  app.on('before-quit', () => {
    supervisor?.stopAll()
  })

  // Make sure ssh children never outlive us, even on SIGINT/SIGTERM/SIGHUP.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      supervisor?.killAllNow()
      app.quit()
    })
  }
  process.on('exit', () => supervisor?.killAllNow())
}

/** Menu-bar-only by default; the config can opt into a Dock icon. */
function applyDockPreference(show: boolean): void {
  try {
    if (show) app.dock?.show()
    else app.dock?.hide()
    log.info(`dock: ${show ? 'shown' : 'hidden (menu bar only)'}`)
  } catch (err) {
    log.warn('failed to apply dock preference', err)
  }
}

function onReady(): void {
  initLogger()
  log.info(`Vigil starting (dev=${isDev}, packaged=${app.isPackaged})`)

  // Menu-bar only unless the config asks otherwise.
  const startupConfig = loadConfig()
  currentLang = resolveLang(startupConfig.language, app.getLocale())
  applyDockPreference(startupConfig.showDockIcon === true)

  if (app.isPackaged && !isAgentInstalled()) {
    // Fallback auto-start if the LaunchAgent hasn't been installed.
    try {
      app.setLoginItemSettings({ openAtLogin: true })
    } catch (err) {
      log.warn('failed to set login item', err)
    }
  }

  supervisor = new TunnelSupervisor()
  supervisor.setPreflight(preflight)
  supervisor.setTunnels(startupConfig.tunnels)
  wireSupervisor(supervisor)

  createWindow()
  createTray()
  registerIpc(supervisor)

  supervisor.startAll('boot')

  const triggerWake = (source: string): void => {
    broadcast(IPC.powerEvent, 'wake')
    supervisor?.restartAll(`wake:${source}`, true)
  }

  registerPowerHandlers({
    onSleep: () => {
      broadcast(IPC.powerEvent, 'sleep')
      // Don't kill connections here: if the wake event is missed, ssh keepalive
      // still recovers. We only need to be prompt on wake.
    },
    onWake: () => triggerWake('power'),
    onLock: () => broadcast(IPC.powerEvent, 'lock'),
    onUnlock: () => broadcast(IPC.powerEvent, 'unlock')
  })

  // Dev affordance: `VIGIL_SIMULATE_WAKE=1` fires the wake path a few seconds
  // after launch so the reconnect + notification flow can be tested without
  // actually closing the lid.
  if (process.env.VIGIL_SIMULATE_WAKE) {
    const delay = Number(process.env.VIGIL_SIMULATE_WAKE) || 6000
    log.info(`dev: will simulate wake in ${delay}ms`)
    setTimeout(() => triggerWake('simulated'), delay)
  }
}

function wireSupervisor(sup: TunnelSupervisor): void {
  sup.on('status-changed', (statuses: TunnelStatus[]) => {
    lastStatuses = statuses
    broadcast(IPC.statusChanged, statuses)
    rebuildTrayMenu()
    scheduleTopologyRefresh()
  })

  // Fired on wake for a batch reconnect.
  sup.on('wake-reconnect', (count: number, reason: string) => {
    log.info(`notify wake-reconnect × ${count} (${reason})`)
    notify(tr('notify.wakeTitle'), tr('notify.wakeBody', { n: count }))
  })

  // Fired when a single tunnel drops and we start retrying.
  sup.on('auto-reconnect', (id: string) => {
    const name = lastStatuses.find((s) => s.id === id)?.name ?? id
    notify(tr('notify.droppedTitle'), tr('notify.droppedBody', { name }))
  })
}

/**
 * Decide whether a tunnel is already being served by another ssh process that
 * targets the same host. If so the supervisor skips spawning a duplicate.
 */
async function preflight(cfg: TunnelConfig): Promise<PreflightResult> {
  const topo = await resolveTunnel(cfg)
  const wanted = [
    ...new Set(
      topo.forwards
        .filter((f) => f.direction !== 'R' && f.bindPort !== null)
        .map((f) => f.bindPort as number)
    )
  ]
  if (!wanted.length) return { satisfied: false, ports: [] }

  const owners = await listListeningOwners()
  const ourPids = new Set(
    (supervisor?.getStatuses() ?? [])
      .map((s) => s.pid)
      .filter((p): p is number => typeof p === 'number')
  )
  const targets = new Set(
    [cfg.host, topo.chain.at(-1)?.alias, topo.chain.at(-1)?.hostname]
      .filter((x): x is string => !!x)
      .map((s) => s.toLowerCase())
  )

  const satisfied = wanted.every((port) => {
    const o = owners.get(port)
    return (
      !!o &&
      !ourPids.has(o.pid) &&
      o.isSsh &&
      !!o.sshDestination &&
      targets.has(o.sshDestination.toLowerCase())
    )
  })
  if (!satisfied) return { satisfied: false, ports: [] }

  // Surface the providing ssh's own uptime so the UI doesn't claim "0s".
  let startedAt: number | undefined
  let holderPid: number | undefined
  for (const port of wanted) {
    const o = owners.get(port)
    if (!o) continue
    if (holderPid === undefined) holderPid = o.pid
    if (typeof o.elapsedSec === 'number') {
      const t = Date.now() - o.elapsedSec * 1000
      if (startedAt === undefined || t < startedAt) startedAt = t
    }
  }
  return { satisfied: true, ports: wanted, startedAt, holderPid }
}

function createWindow(): void {
  const bounds = loadWindowBounds()
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: 'Vigil',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b0d12',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  // remember geometry across launches
  let persistTimer: NodeJS.Timeout | undefined
  const persist = (): void => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
    saveWindowBounds(mainWindow.getBounds())
  }
  const debouncedPersist = (): void => {
    clearTimeout(persistTimer)
    persistTimer = setTimeout(persist, 500)
  }
  mainWindow.on('resize', debouncedPersist)
  mainWindow.on('move', debouncedPersist)
  mainWindow.on('close', persist)

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Verify the preload bridge + IPC end-to-end — cheap and very useful when debugging.
  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      const report = await mainWindow?.webContents.executeJavaScript(`
        (async () => {
          if (typeof window.vigil !== 'object') return 'bridge MISSING'
          const keys = Object.keys(window.vigil).length
          const topo = await window.vigil.getTopology()
          const brief = topo.map(t => ({
            id: t.id,
            chain: t.chain.map(h => h.alias).join(' > '),
            fwd: t.forwards.map(f => f.direction + ':' + f.label + '(' + f.source + ')').join(', '),
            listen: t.runtime ? (t.runtime.listening.map(s => s.host + ':' + s.port).join(', ') || 'none') : 'n/a',
            conns: t.runtime ? t.runtime.connections.length : 0
          }))
          return keys + ' api methods | ' + JSON.stringify(brief)
        })()
      `)
      log.info(`renderer bridge: ${report}`)
    } catch (err) {
      log.error('renderer bridge check failed', err)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env.VIGIL_SELFTEST) {
    mainWindow.webContents.once('did-finish-load', async () => {
      const win = mainWindow
      if (!win) return
      const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
      const evalJs = (js: string): Promise<unknown> => win.webContents.executeJavaScript(js)
      try {
        win.showInactive()
        await delay(6000)
        writeFileSync('/tmp/vigil-list.png', (await win.webContents.capturePage()).toPNG())
        const listInfo = await evalJs(`JSON.stringify({
          badges: [...document.querySelectorAll('.stat')].map(n => n.textContent),
          metrics: [...document.querySelectorAll('.metrics')].map(n => n.textContent.trim()),
          notices: [...document.querySelectorAll('.notice')].map(n => n.className.replace('notice ','') + ':' + n.textContent.trim()),
          hops: [...document.querySelectorAll('.hop')].map(n => n.textContent.trim())
        })`)
        log.info(`SELFTEST list: ${listInfo}`)

        await evalJs(`document.querySelector('[data-tab="topology"]')?.click()`)
        await delay(2200)
        writeFileSync('/tmp/vigil-graph.png', (await win.webContents.capturePage()).toPNG())
        const graphInfo = await evalJs(`JSON.stringify({
          nodes: document.querySelectorAll('.react-flow__node').length,
          edges: document.querySelectorAll('.react-flow__edge').length,
          nodeLabels: [...document.querySelectorAll('.rfnode__title')].map(n => n.textContent)
        })`)
        log.info(`SELFTEST graph: ${graphInfo}`)

        await evalJs(
          `document.querySelector('[data-tab="settings"]')?.click()`
        )
        await delay(1400)
        writeFileSync('/tmp/vigil-settings.png', (await win.webContents.capturePage()).toPNG())
        const settingsInfo = await evalJs(`JSON.stringify({
          cards: document.querySelectorAll('.edcard').length,
          hosts: [...document.querySelectorAll('.field input')].slice(0,3).map(n => n.value)
        })`)
        log.info(`SELFTEST settings: ${settingsInfo}`)

        // expand advanced options and capture
        await evalJs(`document.querySelector('.disclose')?.click()`)
        await delay(700)
        writeFileSync('/tmp/vigil-settings-adv.png', (await win.webContents.capturePage()).toPNG())

        // logs tab — clear the dev noise first, then trigger a real reconnect so
        // the screenshot shows genuine output
        await evalJs(`document.querySelector('[data-tab="logs"]')?.click()`)
        await delay(600)
        await evalJs(
          `(async () => { await window.vigil.clearLogs(); await window.vigil.restartAll() })()`
        )
        await delay(4500)
        writeFileSync('/tmp/vigil-logs.png', (await win.webContents.capturePage()).toPNG())
        const logsInfo = await evalJs(`JSON.stringify({
          lines: document.querySelectorAll('.logline').length,
          path: document.querySelector('.logs__path')?.textContent
        })`)
        log.info(`SELFTEST logs: ${logsInfo}`)

        // copyable ssh command on the first tunnel
        await evalJs(`document.querySelector('[data-tab="tunnels"]')?.click()`)
        await delay(700)
        await evalJs(`document.querySelector('[data-action="command"]')?.click()`)
        await delay(700)
        writeFileSync('/tmp/vigil-cmd.png', (await win.webContents.capturePage()).toPNG())
        const cmdInfo = await evalJs(`document.querySelector('.sshcmd pre')?.textContent ?? 'MISSING'`)
        log.info(`SELFTEST sshcmd: ${cmdInfo}`)

        // State-changing checks are opt-in so the default selftest never touches
        // the user's real config.
        if (process.env.VIGIL_SELFTEST_WRITE) {
          const saveInfo = await evalJs(`(async () => {
            const cfg = await window.vigil.getConfig()
            const saved = await window.vigil.saveConfig(cfg)
            return JSON.stringify({ tunnels: saved.tunnels.length })
          })()`)
          log.info(`SELFTEST save: ${saveInfo}`)

          await evalJs(`document.querySelector('[data-tab="settings"]')?.click()`)
          await delay(700)
          await evalJs(`document.querySelector('.import-open')?.click()`)
          await delay(2600)
          writeFileSync('/tmp/vigil-import.png', (await win.webContents.capturePage()).toPNG())
          const imp = await evalJs(`JSON.stringify({
            rows: document.querySelectorAll('.hostrow').length,
            aliases: [...document.querySelectorAll('.hostrow__alias')].map(n => n.textContent)
          })`)
          log.info(`SELFTEST import: ${imp}`)
        }

        if (process.env.VIGIL_SELFTEST_AGENT) {
          const a1 = await evalJs(`window.vigil.setAgent(true).then(r => JSON.stringify(r))`)
          log.info(`SELFTEST agent install: ${a1} file=${isAgentInstalled()}`)
          await delay(800)
          const a2 = await evalJs(`window.vigil.setAgent(false).then(r => JSON.stringify(r))`)
          log.info(`SELFTEST agent uninstall: ${a2} file=${isAgentInstalled()}`)
        }
      } catch (err) {
        log.error('SELFTEST failed', err)
      }
    })
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  mainWindow.show()
  mainWindow.focus()
}

function createTray(): void {
  const icon = nativeImage.createEmpty()
  icon.addRepresentation({ scaleFactor: 1, dataURL: TRAY_ICON_16 })
  icon.addRepresentation({ scaleFactor: 2, dataURL: TRAY_ICON_32 })
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Vigil — SSH tunnels that never sleep')
  tray.on('click', () => showWindow())
  rebuildTrayMenu()
}

function rebuildTrayMenu(): void {
  if (!tray) return

  const connected = lastStatuses.filter(
    (s) => s.state === 'connected' || s.state === 'external'
  ).length
  const total = lastStatuses.length
  // Show a compact counter next to the menu-bar icon.
  tray.setTitle(total ? `${connected}/${total}` : '')

  const items: Electron.MenuItemConstructorOptions[] = []

  if (lastStatuses.length === 0) {
    items.push({ label: tr('tray.noTunnels'), enabled: false })
  } else {
    for (const s of lastStatuses) {
      const up = s.state === 'connected' || s.state === 'external'
      items.push({
        label: `${stateGlyph(s.state)}  ${s.name}`,
        type: 'checkbox',
        checked: up,
        click: () => (up ? supervisor?.stop(s.id) : supervisor?.start(s.id))
      })
    }
  }

  items.push(
    { type: 'separator' },
    { label: tr('tray.openDashboard'), accelerator: 'Cmd+O', click: () => showWindow() },
    { label: tr('tray.reconnectAll'), click: () => supervisor?.restartAll('manual', true) },
    { type: 'separator' },
    { label: tr('tray.openLogs'), click: () => void openLogs() },
    { label: tr('tray.revealConfig'), click: () => shell.showItemInFolder(configPath()) },
    {
      label: tr('tray.daemon'),
      type: 'checkbox',
      checked: isAgentInstalled(),
      click: async (item) => {
        if (item.checked) await installAgent()
        else await uninstallAgent()
        rebuildTrayMenu()
      }
    },
    { type: 'separator' },
    { label: tr('tray.quit'), accelerator: 'Cmd+Q', click: () => app.quit() }
  )

  tray.setContextMenu(Menu.buildFromTemplate(items))
}

function stateGlyph(state: TunnelStatus['state']): string {
  switch (state) {
    case 'connected':
      return '●'
    case 'external':
      return '⇄'
    case 'starting':
    case 'reconnecting':
      return '◐'
    case 'error':
      return '✕'
    default:
      return '○'
  }
}

function registerIpc(sup: TunnelSupervisor): void {
  ipcMain.handle(IPC.getStatuses, () => sup.getStatuses())
  ipcMain.handle(IPC.getConfig, () => loadConfig())
  ipcMain.handle(IPC.saveConfig, (_e, cfg: unknown) => {
    const saved = saveConfig(cfg)
    currentLang = resolveLang(saved.language, app.getLocale())
    applyDockPreference(saved.showDockIcon === true)
    rebuildTrayMenu()
    clearResolverCache()
    sup.setTunnels(saved.tunnels)
    sup.restartAll('config', false)
    scheduleTopologyRefresh()
    return saved
  })
  ipcMain.handle(IPC.getTopology, () => buildTopology(sup, false))
  ipcMain.handle(IPC.refreshTopology, () => {
    clearResolverCache()
    return buildTopology(sup, true)
  })
  ipcMain.handle(IPC.listSshHosts, () => listSshConfigHosts())
  ipcMain.handle(IPC.getSshCommand, (_e, id: string) => {
    const cfg = loadConfig().tunnels.find((t) => t.id === id)
    return cfg ? buildSshCommand(cfg) : ''
  })
  ipcMain.handle(IPC.copyText, (_e, text: string) => {
    clipboard.writeText(String(text ?? ''))
  })
  ipcMain.handle(IPC.getLogs, () => readLogTail())
  ipcMain.handle(IPC.clearLogs, () => clearLog())
  ipcMain.handle(IPC.agentStatus, () => ({ installed: isAgentInstalled() }))
  ipcMain.handle(IPC.setAgent, async (_e, enabled: boolean) => {
    if (enabled) await installAgent()
    else await uninstallAgent()
    return { installed: isAgentInstalled() }
  })
  ipcMain.handle(IPC.start, (_e, id: string) => sup.start(id))
  ipcMain.handle(IPC.stop, (_e, id: string) => sup.stop(id))
  ipcMain.handle(IPC.restart, (_e, id: string) => sup.restart(id))
  ipcMain.handle(IPC.restartAll, () => sup.restartAll('manual', true))
  ipcMain.handle(IPC.openLogs, () => openLogs())
  ipcMain.handle(IPC.revealConfig, () => shell.showItemInFolder(configPath()))
}

async function buildTopology(sup: TunnelSupervisor, deep = false): Promise<ResolvedTunnel[]> {
  const resolved = await resolveAll(loadConfig().tunnels)
  const statuses = sup.getStatuses()
  await Promise.all(
    resolved.map(async (t) => {
      const st = statuses.find((s) => s.id === t.id)
      if (st?.pid) {
        try {
          t.runtime = await inspectSshProcess(st.pid)
        } catch (err) {
          log.warn(`runtime inspect failed for ${t.id}`, err)
        }
      }
    })
  )

  // Figure out who holds each local forward port we are not serving ourselves.
  // This runs even when we have no process of our own (state = external), so the
  // UI can still explain why a forward is being provided by another ssh.
  try {
    const owners = await listListeningOwners()
    for (const t of resolved) {
      const ours = new Set((t.runtime?.listening ?? []).map((s) => s.port))
      const targets = new Set(
        [t.host, t.chain.at(-1)?.alias, t.chain.at(-1)?.hostname]
          .filter((x): x is string => !!x)
          .map((s) => s.toLowerCase())
      )
      const wanted = new Set(
        t.forwards
          .filter((f) => f.direction !== 'R')
          .map((f) => f.bindPort)
          .filter((p): p is number => p !== null)
      )
      t.externalListeners = [...wanted]
        .filter((p) => !ours.has(p))
        .map((p) => owners.get(p))
        .filter((x): x is ExternalListener => !!x)
        .map((e) => ({
          ...e,
          sameTarget: !!e.sshDestination && targets.has(e.sshDestination.toLowerCase())
        }))
    }
  } catch (err) {
    log.warn('listing port owners failed', err)
  }

  // End-to-end health probes for local forwards (cached ~10s).
  for (const t of resolved) {
    if (!t.runtime) continue
    const localPorts = t.runtime.listening
      .map((s) => s.port)
      .filter((p) => t.forwards.some((f) => f.direction !== 'R' && f.bindPort === p))
    if (localPorts.length) t.probes = await probePorts(localPorts)
  }

  // Remote (-R) listener checks. Each one opens a throwaway ssh connection, so
  // only do it on an explicit refresh.
  if (deep) {
    for (const t of resolved) {
      const remotePorts = t.forwards
        .filter((f) => f.direction === 'R' && f.bindPort !== null)
        .map((f) => f.bindPort as number)
      if (!remotePorts.length) continue
      const alias = t.chain.at(-1)?.alias ?? t.host
      t.remoteChecks = await Promise.all(remotePorts.map((p) => checkRemotePort(alias, p)))
    }
  }

  return resolved
}

let topoDebounce: NodeJS.Timeout | undefined

/** Rebuild topology (throttled) and push it to the renderer. */
function scheduleTopologyRefresh(): void {
  if (topoDebounce) return
  topoDebounce = setTimeout(() => {
    topoDebounce = undefined
    void (async () => {
      if (!supervisor) return
      try {
        const topo = await buildTopology(supervisor, false)
        checkExternalNotifications(topo)
        broadcast(IPC.topologyChanged, topo)
      } catch (err) {
        log.warn('topology refresh failed', err)
      }
    })()
  }, 1200)
}

const notifiedExternal = new Map<string, Set<string>>()

/**
 * Report ports we could not bind, split by cause:
 *  - held by another ssh aiming at the SAME host  -> informational (no need to duplicate)
 *  - held by a different ssh, or by another app   -> a real conflict, report it
 * Each is only announced once per situation.
 */
function checkExternalNotifications(topo: ResolvedTunnel[]): void {
  for (const t of topo) {
    const same: number[] = []
    const conflict: { port: number; who: string }[] = []
    const keys = new Set<string>()

    for (const e of t.externalListeners ?? []) {
      if (e.isSsh && e.sameTarget) {
        same.push(e.port)
        keys.add(`same:${e.port}`)
      } else {
        conflict.push({
          port: e.port,
          who: e.isSsh ? `另一个 SSH (${e.sshDestination ?? 'unknown'})` : e.command
        })
        keys.add(`conflict:${e.port}`)
      }
    }

    const prev = notifiedExternal.get(t.id) ?? new Set<string>()
    const freshSame = same.filter((p) => !prev.has(`same:${p}`))
    const freshConflict = conflict.filter((c) => !prev.has(`conflict:${c.port}`))

    if (freshSame.length) {
      notify(
        tr('notify.externalTitle'),
        tr('notify.externalBody', {
          name: t.name,
          ports: freshSame.map((p) => ':' + p).join(', ')
        })
      )
    }
    if (freshConflict.length) {
      notify(
        tr('notify.conflictTitle'),
        tr('notify.conflictBody', {
          name: t.name,
          detail: freshConflict
            .map((c) => `:${c.port} — ${c.who}`)
            .join(', ')
        })
      )
    }

    notifiedExternal.set(t.id, keys)
  }
}

async function openLogs(): Promise<void> {
  const dir = app.getPath('logs')
  await shell.openPath(dir)
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}
