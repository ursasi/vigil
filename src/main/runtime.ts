/**
 * Runtime inspection of a running ssh tunnel.
 *
 * `ProxyJump` makes ssh fork child processes (`ssh -W host:port jump`), and the
 * listening forward sockets can live in any of them — so we walk the whole
 * process tree and ask `lsof` for TCP sockets across all of them at once.
 *
 * Electron-free so it can be tested from plain Node.
 */
import { execFile } from 'child_process'
import { connect } from 'net'
import type {
  ExternalListener,
  ListeningSocket,
  PortProbe,
  RemoteCheck,
  SocketConn,
  TunnelRuntime
} from '../shared/types'

const LSOF_BIN = '/usr/sbin/lsof'
const PS_BIN = '/bin/ps'
const SSH_BIN_FOR_REMOTE = '/usr/bin/ssh'

export interface ProcNode {
  pid: number
  ppid: number
  command: string
  /** seconds this process has been running (from ps etime) */
  elapsedSec: number
}

/** Parse ps etime: `DD-HH:MM:SS` | `HH:MM:SS` | `MM:SS`. */
function parseEtime(s: string): number {
  let days = 0
  let rest = s
  const dash = rest.indexOf('-')
  if (dash !== -1) {
    days = Number(rest.slice(0, dash)) || 0
    rest = rest.slice(dash + 1)
  }
  const parts = rest.split(':').map((n) => Number(n) || 0)
  let h = 0
  let m = 0
  let sec = 0
  if (parts.length === 3) [h, m, sec] = parts
  else if (parts.length === 2) [m, sec] = parts
  else sec = parts[0] ?? 0
  return days * 86400 + h * 3600 + m * 60 + sec
}

export function listProcesses(): Promise<ProcNode[]> {
  return new Promise((resolve, reject) => {
    execFile(PS_BIN, ['-axo', 'pid=,ppid=,etime=,command='], (err, stdout) => {
      if (err) return reject(err)
      const out: ProcNode[] = []
      for (const line of stdout.split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
        if (!m) continue
        out.push({
          pid: Number(m[1]),
          ppid: Number(m[2]),
          elapsedSec: parseEtime(m[3]),
          command: m[4]
        })
      }
      resolve(out)
    })
  })
}

/** Root pid plus every descendant pid. */
export function collectProcessTree(procs: ProcNode[], rootPid: number): number[] {
  const byParent = new Map<number, number[]>()
  for (const p of procs) {
    const list = byParent.get(p.ppid)
    if (list) list.push(p.pid)
    else byParent.set(p.ppid, [p.pid])
  }
  const out: number[] = []
  const stack = [rootPid]
  const seen = new Set<number>()
  while (stack.length) {
    const pid = stack.pop() as number
    if (seen.has(pid)) continue
    seen.add(pid)
    out.push(pid)
    for (const child of byParent.get(pid) ?? []) stack.push(child)
  }
  return out
}

function splitHostPort(token: string): { host: string; port: number } {
  const t = token.trim()
  if (t.startsWith('[')) {
    const end = t.lastIndexOf(']')
    return { host: t.slice(1, end), port: Number(t.slice(end + 2)) || 0 }
  }
  const idx = t.lastIndexOf(':')
  if (idx === -1) return { host: t, port: 0 }
  return { host: t.slice(0, idx), port: Number(t.slice(idx + 1)) || 0 }
}

const SOCKET_RE = /\s(\S+?)(?:->(\S+))?\s+\((LISTEN|ESTABLISHED|SYN_SENT|CLOSE_WAIT|TIME_WAIT|FIN_WAIT_\d)\)/

export interface ParsedSockets {
  listening: ListeningSocket[]
  connections: SocketConn[]
}

export function parseLsof(stdout: string): ParsedSockets {
  const listening: ListeningSocket[] = []
  const connections: SocketConn[] = []
  for (const line of stdout.split('\n')) {
    if (!line || line.startsWith('COMMAND')) continue
    const m = SOCKET_RE.exec(line)
    if (!m) continue
    const [, localTok, remoteTok, state] = m
    const local = splitHostPort(localTok)
    const family: ListeningSocket['family'] = localTok.includes('[') || localTok.includes('::') ? 'IPv6' : 'IPv4'

    if (state === 'LISTEN') {
      listening.push({ host: local.host, port: local.port, family })
    } else if (state === 'ESTABLISHED' && remoteTok) {
      const remote = splitHostPort(remoteTok)
      connections.push({
        localHost: local.host,
        localPort: local.port,
        remoteHost: remote.host,
        remotePort: remote.port
      })
    }
  }
  return { listening, connections }
}

function lsofTcp(pids: number[]): Promise<string> {
  return new Promise((resolve) => {
    if (pids.length === 0) return resolve('')
    const args = ['-nP', '-iTCP', '-a']
    for (const pid of pids) args.push('-p', String(pid))
    execFile(LSOF_BIN, args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      // lsof exits non-zero when some pids are gone; stdout is still useful.
      resolve(err && !stdout ? '' : stdout)
    })
  })
}

function dedupeListening(list: ListeningSocket[]): ListeningSocket[] {
  const seen = new Set<string>()
  const out: ListeningSocket[] = []
  for (const s of list) {
    const key = `${s.host}|${s.port}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

export async function inspectSshProcess(rootPid: number): Promise<TunnelRuntime> {
  let pids = [rootPid]
  try {
    pids = collectProcessTree(await listProcesses(), rootPid)
  } catch {
    /* fall back to just the root pid */
  }
  const stdout = await lsofTcp(pids)
  const { listening, connections } = parseLsof(stdout)
  return {
    pid: rootPid,
    pids,
    listening: dedupeListening(listening),
    connections,
    collectedAt: Date.now()
  }
}

// ---------------------------------------------------------------------------
// health probes
// ---------------------------------------------------------------------------

const probeCache = new Map<number, PortProbe>()
const PROBE_TTL_MS = 10_000

/**
 * Open a real TCP connection to a locally forwarded port. For `-L` this goes
 * end-to-end through the tunnel to the remote target — a genuine health check,
 * not just "the process is alive".
 */
export function probePort(port: number, timeoutMs = 1500): Promise<PortProbe> {
  const cached = probeCache.get(port)
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) return Promise.resolve(cached)

  return new Promise((resolve) => {
    const start = Date.now()
    const sock = connect({ host: '127.0.0.1', port })
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      sock.destroy()
      const probe: PortProbe = { port, ok, ms: Date.now() - start, at: Date.now() }
      probeCache.set(port, probe)
      resolve(probe)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => finish(true))
    sock.once('timeout', () => finish(false))
    sock.once('error', () => finish(false))
  })
}

export async function probePorts(ports: number[]): Promise<PortProbe[]> {
  const uniq = [...new Set(ports)]
  return Promise.all(uniq.map((p) => probePort(p)))
}

// ---------------------------------------------------------------------------
// remote (-R) listener check
// ---------------------------------------------------------------------------

const remoteCache = new Map<string, RemoteCheck>()
const REMOTE_TTL_MS = 30_000

const REMOTE_CMD =
  'ss -H -ltn 2>/dev/null || netstat -ltn 2>/dev/null || netstat -an 2>/dev/null'

/**
 * Ask the remote host whether a `-R` forwarded port is actually listening.
 * Uses a throwaway connection with ClearAllForwardings so it never fights the
 * live tunnel for the same local ports.
 */
export function checkRemotePort(
  alias: string,
  port: number,
  timeoutMs = 12_000
): Promise<RemoteCheck> {
  const key = `${alias}:${port}`
  const cached = remoteCache.get(key)
  if (cached && Date.now() - cached.at < REMOTE_TTL_MS) return Promise.resolve(cached)

  return new Promise((resolve) => {
    execFile(
      SSH_BIN_FOR_REMOTE,
      [
        '-o',
        'ClearAllForwardings=yes',
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=8',
        alias,
        REMOTE_CMD
      ],
      { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        let status: RemoteCheck['status']
        if (err && !stdout) {
          status = 'unknown'
        } else {
          const re = new RegExp(`[:.]${port}(?!\\d)`)
          status = stdout
            .split('\n')
            .some((l) => re.test(l) && /LISTEN/i.test(l))
            ? 'listening'
            : 'closed'
        }
        const check: RemoteCheck = { port, status, at: Date.now() }
        remoteCache.set(key, check)
        resolve(check)
      }
    )
  })
}

/**
 * Pull the destination host out of an ssh command line.
 * Option flags that consume the next token are skipped; the first bare
 * token is the destination (ssh syntax: `ssh [options] destination [cmd]`).
 */
export function sshDestination(command: string): string | null {
  const tokens = command.trim().split(/\s+/)
  // find the ssh executable token (command may start with a path)
  let start = tokens.findIndex((t) => /(^|\/)ssh$/.test(t))
  if (start === -1) start = 0
  const rest = tokens.slice(start + 1)

  const WITH_ARG = new Set('bcDEeFIiJLlmOopQRSWw'.split(''))
  let i = 0
  while (i < rest.length) {
    const t = rest[i]
    if (t === '--') {
      i++
      break
    }
    if (t.startsWith('-') && t.length > 1) {
      const last = t[t.length - 1]
      // separate flag that takes a value -> skip its argument too
      i += WITH_ARG.has(last) && t.length === 2 ? 2 : 1
      continue
    }
    break
  }
  const dest = rest[i]
  if (!dest) return null
  // normalise: strip user@ and ]-ports
  let host = dest
  if (host.includes('@')) host = host.slice(host.lastIndexOf('@') + 1)
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    host = host.slice(1, end)
  } else if (host.includes(':')) {
    host = host.slice(0, host.lastIndexOf(':'))
  }
  return host || null
}

/**
 * Every TCP LISTEN socket on the machine, keyed by port. Used to work out who
 * is squatting on a port our tunnel failed to bind — and, when it is another
 * ssh, whether it targets the same host (i.e. it is already serving exactly
 * the forward we wanted).
 */
export async function listListeningOwners(): Promise<Map<number, ExternalListener>> {
  const map = new Map<number, ExternalListener>()
  const [stdout, procs] = await Promise.all([
    new Promise<string>((resolve) => {
      execFile(
        LSOF_BIN,
        ['-nP', '-iTCP', '-sTCP:LISTEN'],
        { maxBuffer: 8 * 1024 * 1024 },
        (_err, out) => resolve(out || '')
      )
    }),
    listProcesses().catch(() => [] as ProcNode[])
  ])
  const cmdByPid = new Map(procs.map((p) => [p.pid, p]))

  for (const line of stdout.split('\n')) {
    if (!line || line.startsWith('COMMAND')) continue
    const m = SOCKET_RE.exec(line)
    if (!m) continue
    const parts = line.trim().split(/\s+/)
    const command = parts[0] ?? ''
    const pid = Number(parts[1] || 0)
    const local = splitHostPort(m[1])
    if (!local.port || map.has(local.port)) continue
    const proc = cmdByPid.get(pid)
    const commandLine = proc?.command ?? command
    const isSsh = command === 'ssh' || command.endsWith('/ssh')
    map.set(local.port, {
      port: local.port,
      pid,
      command,
      commandLine,
      isSsh,
      sshDestination: isSsh ? sshDestination(commandLine) : null,
      elapsedSec: proc?.elapsedSec,
      sameTarget: false
    })
  }
  return map
}
