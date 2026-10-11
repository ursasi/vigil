import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import type { TunnelConfig, TunnelState, TunnelStatus } from '../shared/types'
import { log } from './logger'
import { buildSshArgs, SSH_BIN } from './sshCommand'

/** How long a process must survive before we call it "connected". */
const CONNECT_GRACE_MS = 2500
const MAX_BACKOFF_MS = 30_000

interface Runtime {
  cfg: TunnelConfig
  state: TunnelState
  child?: ChildProcess
  pid?: number
  attempts: number
  since?: number
  lastAttemptAt?: number
  lastError?: string
  stderrTail: string
  warnings: string[]
  externalPorts?: number[]
  externalPid?: number
  manualStop: boolean
  connectTimer?: NodeJS.Timeout
  restartTimer?: NodeJS.Timeout
  killTimer?: NodeJS.Timeout
}

function extractWarnings(stderr: string): string[] {
  return stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && /could not|failed|address already in use|warning/i.test(l))
    .slice(0, 8)
}

function backoffMs(attempts: number): number {
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempts - 1))
  const jitter = base * 0.2 * (Math.random() * 2 - 1)
  return Math.round(base + jitter)
}

export interface SupervisorEvents {
  'status-changed': (statuses: TunnelStatus[]) => void
}

export interface PreflightResult {
  /** true when another same-target ssh already serves every local forward */
  satisfied: boolean
  ports: number[]
  /** epoch ms when the providing ssh started (earliest, if several) */
  startedAt?: number
  /** pid of the providing ssh */
  holderPid?: number
}

export type Preflight = (cfg: TunnelConfig) => Promise<PreflightResult>

export class TunnelSupervisor extends EventEmitter {
  private runtimes = new Map<string, Runtime>()
  private started = false
  private preflight?: Preflight

  /**
   * Installed by the app: given a tunnel, decide whether an already-running
   * same-target ssh process serves all of its local forwards. If so we skip
   * spawning a redundant connection.
   */
  setPreflight(fn: Preflight): void {
    this.preflight = fn
  }

  /** Replace the whole set of tunnels (used on config reload). */
  setTunnels(tunnels: TunnelConfig[]): void {
    // Stop and drop tunnels that are gone.
    for (const id of [...this.runtimes.keys()]) {
      if (!tunnels.some((t) => t.id === id)) {
        this.stop(id)
        this.runtimes.delete(id)
      }
    }
    // Add/update.
    for (const cfg of tunnels) {
      const existing = this.runtimes.get(cfg.id)
      if (existing) {
        existing.cfg = cfg
      } else {
        this.runtimes.set(cfg.id, {
          cfg,
          state: 'stopped',
          attempts: 0,
          stderrTail: '',
          warnings: [],
          manualStop: false
        })
      }
    }
    this.emitStatus()
  }

  /** Start every enabled tunnel. Called once at boot. */
  startAll(reason = 'boot'): void {
    this.started = true
    log.info(`supervisor: startAll (${reason})`)
    for (const rt of this.runtimes.values()) {
      if (rt.cfg.enabled) this.start(rt.cfg.id)
    }
    this.emitStatus()
  }

  start(id: string): void {
    const rt = this.runtimes.get(id)
    if (!rt) return
    if (rt.child || rt.state === 'starting' || rt.state === 'connected') return
    this.clearRestartTimer(rt)
    rt.manualStop = false
    void this.spawn(rt)
  }

  /** Manual stop — will not be auto-restarted. */
  stop(id: string): void {
    const rt = this.runtimes.get(id)
    if (!rt) return
    rt.manualStop = true
    this.clearRestartTimer(rt)
    this.kill(rt)
    rt.state = 'stopped'
    rt.pid = undefined
    rt.since = undefined
    rt.attempts = 0
    this.emitStatus()
  }

  /** Full restart: kill + spawn immediately. Used on wake and by the UI. */
  restart(id: string): void {
    const rt = this.runtimes.get(id)
    if (!rt) return
    rt.manualStop = true
    this.clearRestartTimer(rt)
    this.kill(rt)

    // Give the socket a moment to release, then reconnect fresh.
    rt.restartTimer = setTimeout(() => {
      rt.restartTimer = undefined
      rt.manualStop = false
      rt.attempts = 0
      void this.spawn(rt)
    }, 300)
  }

  restartAll(reason: string, notify = true): void {
    const active = [...this.runtimes.values()].filter((r) => r.cfg.enabled)
    log.info(`supervisor: restartAll (${reason}) × ${active.length}`)
    for (const rt of active) {
      rt.manualStop = true
      this.clearRestartTimer(rt)
      this.kill(rt)
      rt.restartTimer = setTimeout(() => {
        rt.restartTimer = undefined
        rt.manualStop = false
        rt.attempts = 0
        void this.spawn(rt)
      }, 300)
    }
    if (notify && active.length > 0) {
      this.emit('wake-reconnect', active.length, reason)
    }
    this.emitStatus()
  }

  stopAll(): void {
    for (const id of this.runtimes.keys()) this.stop(id)
  }

  /**
   * Synchronously SIGKILL every child. Safe to call from a `process.on('exit')`
   * handler, where async timers no longer run — otherwise children would be
   * orphaned and keep holding local ports.
   */
  killAllNow(): void {
    for (const rt of this.runtimes.values()) {
      rt.manualStop = true
      this.clearRestartTimer(rt)
      this.clearConnectTimer(rt)
      const child = rt.child
      if (child && child.exitCode === null && child.signalCode === null) {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }
      rt.child = undefined
      rt.pid = undefined
    }
  }

  getStatuses(): TunnelStatus[] {
    return [...this.runtimes.values()].map((rt) => this.statusOf(rt))
  }

  private statusOf(rt: Runtime): TunnelStatus {
    return {
      id: rt.cfg.id,
      name: rt.cfg.name || rt.cfg.host,
      host: rt.cfg.host,
      state: rt.state,
      pid: rt.pid,
      since: rt.since,
      lastAttemptAt: rt.lastAttemptAt,
      attempts: rt.attempts,
      lastError: rt.lastError,
      warnings: rt.warnings,
      externalPorts: rt.externalPorts,
      externalPid: rt.externalPid
    }
  }

  private async spawn(rt: Runtime): Promise<void> {
    if (rt.manualStop || rt.child) return

    // If another ssh already serves this tunnel's forwards, don't duplicate it.
    if (this.preflight) {
      try {
        const res = await this.preflight(rt.cfg)
        if (rt.manualStop) return
        if (res.satisfied && res.ports.length) {
          rt.state = 'external'
          rt.externalPorts = res.ports
          rt.externalPid = res.holderPid
          rt.child = undefined
          rt.pid = undefined
          // Reflect the *other* ssh's uptime, not "just now".
          rt.since = res.startedAt ?? Date.now()
          rt.attempts = 0
          rt.lastError = undefined
          rt.warnings = []
          log.info(
            `supervisor: ${rt.cfg.id} already served by another ssh (ports ${res.ports.join(', ')})`
          )
          this.emitStatus()
          // Re-check periodically; if that ssh goes away we take over.
          this.clearRestartTimer(rt)
          rt.restartTimer = setTimeout(() => {
            rt.restartTimer = undefined
            if (!rt.manualStop) void this.spawn(rt)
          }, 20_000)
          return
        }
      } catch (err) {
        log.warn(`supervisor: preflight failed for ${rt.cfg.id}`, err)
      }
    }

    rt.externalPorts = undefined
    const args = buildSshArgs(rt.cfg)
    rt.state = 'starting'
    rt.lastAttemptAt = Date.now()
    rt.attempts += 1
    rt.lastError = undefined
    rt.stderrTail = ''
    rt.warnings = []
    this.emitStatus()

    log.info(`supervisor: spawning ssh ${args.join(' ')}`)

    let child: ChildProcess
    try {
      child = spawn(SSH_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (err) {
      rt.lastError = String(err)
      rt.state = 'error'
      log.error(`supervisor: spawn failed for ${rt.cfg.id}`, err)
      this.scheduleRestart(rt)
      return
    }

    rt.child = child
    rt.pid = child.pid ?? undefined

    child.stderr?.on('data', (buf: Buffer) => {
      rt.stderrTail = (rt.stderrTail + buf.toString()).slice(-4000)
    })

    child.on('error', (err) => {
      rt.lastError = err.message
      log.error(`supervisor: child error for ${rt.cfg.id}`, err)
    })

    child.on('exit', (code, signal) => {
      this.onExit(rt, code, signal)
    })

    // Consider it connected if it survives the grace period.
    rt.connectTimer = setTimeout(() => {
      rt.connectTimer = undefined
      if (rt.child && rt.state === 'starting') {
        rt.state = 'connected'
        rt.since = Date.now()
        rt.attempts = 0
        rt.warnings = extractWarnings(rt.stderrTail)
        log.info(
          `supervisor: ${rt.cfg.id} connected (pid ${rt.pid})` +
            (rt.warnings.length ? ` with ${rt.warnings.length} warning(s)` : '')
        )
        if (rt.warnings.length) log.warn(`supervisor: ${rt.cfg.id} warnings`, rt.warnings)
        this.emitStatus()
      }
    }, CONNECT_GRACE_MS)
  }

  private onExit(rt: Runtime, code: number | null, signal: NodeJS.Signals | null): void {
    this.clearConnectTimer(rt)
    rt.child = undefined
    rt.pid = undefined
    rt.since = undefined

    if (rt.manualStop) {
      rt.state = 'stopped'
      log.info(`supervisor: ${rt.cfg.id} stopped (code ${code}, signal ${signal})`)
      this.emitStatus()
      return
    }

    const detail = rt.stderrTail.trim()
    rt.lastError = detail || `ssh exited (code ${code ?? signal})`
    rt.state = 'reconnecting'
    log.warn(
      `supervisor: ${rt.cfg.id} exited (code ${code}, signal ${signal}), attempt ${rt.attempts}`
    )

    if (rt.cfg.autoReconnect === false) {
      rt.state = 'error'
      this.emitStatus()
      return
    }

    // Notify on the first automatic retry so the user knows why a tunnel bounced.
    if (rt.cfg.notifyOnReconnect !== false && rt.attempts <= 1) {
      this.emit('auto-reconnect', rt.cfg.id)
    }

    this.emitStatus()
    this.scheduleRestart(rt)
  }

  private scheduleRestart(rt: Runtime): void {
    this.clearRestartTimer(rt)
    const delay = backoffMs(rt.attempts)
    log.info(`supervisor: ${rt.cfg.id} will retry in ${delay}ms`)
    rt.restartTimer = setTimeout(() => {
      rt.restartTimer = undefined
      if (rt.manualStop) return
      void this.spawn(rt)
    }, delay)
  }

  private kill(rt: Runtime): void {
    this.clearConnectTimer(rt)
    const child = rt.child
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      rt.child = undefined
      rt.pid = undefined
      return
    }
    log.info(`supervisor: killing ${rt.cfg.id} (pid ${child.pid})`)
    try {
      child.kill('SIGTERM')
    } catch {
      /* ignore */
    }
    rt.killTimer = setTimeout(() => {
      rt.killTimer = undefined
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }, 3000)
    rt.child = undefined
    rt.pid = undefined
  }

  private clearConnectTimer(rt: Runtime): void {
    if (rt.connectTimer) {
      clearTimeout(rt.connectTimer)
      rt.connectTimer = undefined
    }
  }

  private clearRestartTimer(rt: Runtime): void {
    if (rt.restartTimer) {
      clearTimeout(rt.restartTimer)
      rt.restartTimer = undefined
    }
  }

  private emitStatus(): void {
    this.emit('status-changed', this.getStatuses())
  }
}
