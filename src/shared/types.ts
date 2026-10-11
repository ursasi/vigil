/**
 * Vigil — core data types.
 *
 * Phase 0 is intentionally narrow: we only model what the supervisor needs
 * to keep a set of SSH connections alive across sleep/wake. The topology
 * types (phase 2) will be layered on top of `ForwardSpec` without changing
 * these shapes.
 */

export interface TunnelConfig {
  /** Stable identifier, used by IPC and the UI. */
  id: string
  /** Human friendly label shown in the tray / UI. */
  name?: string
  /** SSH host: either a bare address or a Host alias from ~/.ssh/config. */
  host: string
  /** Whether the supervisor should keep this tunnel connected. */
  enabled: boolean

  // --- per-tunnel overrides (all optional; win over ~/.ssh/config) ---
  user?: string
  port?: number
  identityFile?: string
  proxyJump?: string
  /** `-L` specs, e.g. "18080:localhost:80" */
  localForwards?: string[]
  /** `-R` specs, e.g. "2222:localhost:22" */
  remoteForwards?: string[]
  /** `-D` socks specs, e.g. "127.0.0.1:11080" */
  dynamicForwards?: string[]
  /** Raw `-o Key=Value` options. */
  sshOptions?: Record<string, string>
  /** Anything else appended verbatim before the host. Escape hatch. */
  extraArgs?: string[]

  // --- behaviour ---
  /** Reconnect automatically when the process dies. Default: true. */
  autoReconnect?: boolean
  /** Show a system notification when an automatic reconnect starts. Default: true. */
  notifyOnReconnect?: boolean
}

export interface VigilConfig {
  version: number
  tunnels: TunnelConfig[]
  /** Notify on sleep/wake events globally. Default: true. */
  notifyOnPowerEvents?: boolean
  /** Show the app in the Dock (default: menu bar only). */
  showDockIcon?: boolean
  /** UI language. Unset = follow the system locale. */
  language?: 'zh' | 'en'
}

export type TunnelState =
  | 'stopped'
  | 'starting'
  | 'connected'
  | 'reconnecting'
  | 'error'
  /** a same-target ssh process already serves this tunnel's forwards */
  | 'external'

export interface TunnelStatus {
  id: string
  name: string
  host: string
  state: TunnelState
  pid?: number
  /** epoch ms when the tunnel last became `connected`. */
  since?: number
  /** epoch ms of the last attempt. */
  lastAttemptAt?: number
  /** consecutive reconnect attempts since last success. */
  attempts: number
  lastError?: string
  /** non-fatal ssh complaints, e.g. a forward that failed to bind. */
  warnings: string[]
  /** ports currently served by another same-target ssh, when state is 'external' */
  externalPorts?: number[]
  /** pid of the ssh process providing the forward when state is 'external' */
  externalPid?: number
}

// ---------------------------------------------------------------------------
// Resolved topology (from `ssh -G` + product config)
// ---------------------------------------------------------------------------

export interface ForwardEntry {
  direction: 'L' | 'R' | 'D'
  bindAddress: string | null
  bindPort: number | null
  targetHost: string | null
  targetPort: number | null
  /** human label, e.g. "18080 -> localhost:80" */
  label: string
  source: 'product' | 'ssh-config'
}

export interface ResolvedHop {
  /** the Host alias / name that matched */
  alias: string
  /** resolved HostName (relative to the previous hop, for localhost setups) */
  hostname: string
  user: string
  port: number
  identityFiles: string[]
  proxyJump: string[]
  proxyCommand: string | null
}

export interface ResolvedTunnel {
  id: string
  name: string
  host: string
  /** [ ...jumps, target ] — target is always last */
  chain: ResolvedHop[]
  forwards: ForwardEntry[]
  errors: string[]
  /** live process info, present only when we have our own ssh running */
  runtime?: TunnelRuntime
  /** who holds each local forward port when we could not bind it */
  externalListeners?: ExternalListener[]
  /** end-to-end reachability probe for each local listening forward */
  probes?: PortProbe[]
  /** remote-side listener check for -R forwards */
  remoteChecks?: RemoteCheck[]
}

// ---------------------------------------------------------------------------
// Runtime inspection (lsof over the ssh process tree)
// ---------------------------------------------------------------------------

export interface ListeningSocket {
  host: string
  port: number
  family: 'IPv4' | 'IPv6'
}

export interface SocketConn {
  localHost: string
  localPort: number
  remoteHost: string
  remotePort: number
}

/** A listener on a port this tunnel wanted, but held by another process. */
export interface ExternalListener {
  port: number
  pid: number
  /** short process name, e.g. "ssh" */
  command: string
  /** full command line when available */
  commandLine: string
  /** true when the owner is another ssh process */
  isSsh: boolean
  /** the ssh destination of the owning process, if it is an ssh */
  sshDestination: string | null
  /** true when that destination matches this tunnel's target */
  sameTarget: boolean
  /** how long the owning process has been running, in seconds */
  elapsedSec?: number
}

export interface TunnelRuntime {
  /** root ssh pid */
  pid: number
  /** root + all descendant ssh pids (ProxyJump forks children) */
  pids: number[]
  listening: ListeningSocket[]
  connections: SocketConn[]
  collectedAt: number
}

export interface PortProbe {
  port: number
  ok: boolean
  /** round-trip in ms */
  ms: number
  at: number
}

export interface RemoteCheck {
  port: number
  status: 'listening' | 'closed' | 'unknown'
  at: number
}

/** A concrete Host alias found in ~/.ssh/config, for the import flow. */
export interface SshHostEntry {
  alias: string
  hostname: string
  user: string
  port: number
  proxyJump: string[]
}

export type PowerEvent = 'sleep' | 'wake' | 'lock' | 'unlock'
