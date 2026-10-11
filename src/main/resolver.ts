/**
 * SSH config resolution.
 *
 * The single source of truth for "what will this connection actually look
 * like" is `ssh -G <host>`: it expands `~/.ssh/config` (Host globs, Match
 * blocks, Include) and applies all defaults. We parse that, then overlay the
 * product config on top (product wins).
 *
 * This module is deliberately free of electron imports so it can be unit
 * tested from plain Node.
 *
 * Semantics note: port forwards are *additive* at the ssh level. If the
 * product config defines forwards, ssh still also applies the ones from
 * ~/.ssh/config, because `ClearAllForwardings=yes` would also wipe the
 * command-line forwards. So here we MERGE both sources and tag each entry with
 * where it came from; the UI can surface conflicts. Making product forwards
 * truly replace config forwards is deferred (see README roadmap).
 */
import { execFile } from 'child_process'
import type {
  ForwardEntry,
  ResolvedHop,
  ResolvedTunnel,
  TunnelConfig
} from '../shared/types'
import { sshConfigArgs } from './sshCommand'

const SSH_BIN = '/usr/bin/ssh'
const CACHE_TTL_MS = 15_000

interface RawConfig {
  hop: ResolvedHop
  forwards: ForwardEntry[]
}

// ---------------------------------------------------------------------------
// ssh -G
// ---------------------------------------------------------------------------

function sshG(alias: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      SSH_BIN,
      [...sshConfigArgs(), '-G', alias],
      { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error((stderr || '').trim() || err.message))
        } else {
          resolve(stdout)
        }
      }
    )
  })
}

function parseKeyValues(stdout: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const line of stdout.split('\n')) {
    const m = /^(\S+)[ \t]+(.*)$/.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2]
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }
  return map
}

const first = (m: Map<string, string[]>, key: string): string | undefined => m.get(key)?.[0]

/** Parse "[127.0.0.1]:1080" | "127.0.0.1:1080" | "8042" | "[::1]:80". */
function parseEndpoint(token: string): { address: string | null; port: number | null } {
  if (!token) return { address: null, port: null }
  if (token.startsWith('[')) {
    const end = token.lastIndexOf(']')
    const address = token.slice(1, end)
    const rest = token.slice(end + 1)
    const port = rest.startsWith(':') ? Number(rest.slice(1)) : NaN
    return { address, port: Number.isFinite(port) ? port : null }
  }
  const colon = token.lastIndexOf(':')
  if (colon === -1) {
    const port = Number(token)
    return { address: null, port: Number.isFinite(port) ? port : null }
  }
  const port = Number(token.slice(colon + 1))
  return { address: token.slice(0, colon), port: Number.isFinite(port) ? port : null }
}

function parseForward(
  direction: 'L' | 'R' | 'D',
  value: string,
  source: ForwardEntry['source']
): ForwardEntry {
  const parts = value.trim().split(/\s+/)
  if (direction === 'D') {
    const bind = parseEndpoint(parts[0] ?? '')
    return {
      direction,
      bindAddress: bind.address,
      bindPort: bind.port,
      targetHost: null,
      targetPort: null,
      label: `${bind.address ?? ''}${bind.address ? ':' : ''}${bind.port ?? ''}`,
      source
    }
  }
  const bind = parseEndpoint(parts[0] ?? '')
  const target = parseEndpoint(parts[1] ?? '')
  const bindText = `${bind.address ? bind.address + ':' : ''}${bind.port ?? ''}`
  const targetText =
    parts[1] && target.port !== null
      ? `${target.address ? target.address + ':' : ''}${target.port}`
      : (parts[1] ?? '')
  return {
    direction,
    bindAddress: bind.address,
    bindPort: bind.port,
    targetHost: target.address,
    targetPort: target.port,
    label: `${bindText} -> ${targetText}`,
    source
  }
}

function toForwardValue(entry: Pick<ForwardEntry, 'direction' | 'bindAddress' | 'bindPort' | 'targetHost' | 'targetPort'>): string {
  const bind = `${entry.bindAddress ? entry.bindAddress + ':' : ''}${entry.bindPort ?? ''}`
  if (entry.direction === 'D') return bind
  return `${bind} ${entry.targetHost ?? ''}:${entry.targetPort ?? ''}`.trim()
}

/**
 * Product config forwards are written in `-L` / `-R` / `-D` syntax, which is
 * NOT the same as the `ssh -G` output format:
 *   -L  [bind_address:]port:host:hostport   (one colon-packed token)
 *   -D  [bind_address:]port
 * Accepts the `ssh -G` whitespace form too, for robustness.
 */
function parseUserForward(direction: 'L' | 'R' | 'D', spec: string): ForwardEntry {
  const s = spec.trim()
  if (/\s/.test(s)) {
    // already in `ssh -G` whitespace form
    return parseForward(direction, s, 'product')
  }

  if (direction === 'D') {
    const bind = parseEndpoint(s)
    return {
      direction,
      bindAddress: bind.address,
      bindPort: bind.port,
      targetHost: null,
      targetPort: null,
      label: `${bind.address ? bind.address + ':' : ''}${bind.port ?? ''}`,
      source: 'product'
    }
  }

  let bindAddress: string | null = null
  let rest = s
  if (rest.startsWith('[')) {
    const end = rest.indexOf(']')
    bindAddress = rest.slice(1, end)
    rest = rest.slice(end + 1)
    if (rest.startsWith(':')) rest = rest.slice(1)
  }

  const parts = rest.split(':')
  let bindPort: number | null = null
  let targetHost: string | null = null
  let targetPort: number | null = null

  if (bindAddress === null) {
    if (parts.length === 3) {
      bindPort = Number(parts[0])
      targetHost = parts[1]
      targetPort = Number(parts[2])
    } else if (parts.length >= 4) {
      bindAddress = parts[0]
      bindPort = Number(parts[1])
      targetHost = parts[2]
      targetPort = Number(parts[3])
    }
  } else if (parts.length >= 3) {
    bindPort = Number(parts[0])
    targetHost = parts[1]
    targetPort = Number(parts[2])
  }

  const safePort = (n: number | null): number | null => (n !== null && Number.isFinite(n) ? n : null)
  const bindText = `${bindAddress ? bindAddress + ':' : ''}${safePort(bindPort) ?? ''}`
  return {
    direction,
    bindAddress,
    bindPort: safePort(bindPort),
    targetHost: targetHost || null,
    targetPort: safePort(targetPort),
    label: `${bindText} -> ${targetHost ?? ''}:${safePort(targetPort) ?? ''}`,
    source: 'product'
  }
}

function readConfig(alias: string): Promise<RawConfig> {
  return sshG(alias).then((stdout) => {
    const kv = parseKeyValues(stdout)

    const proxyJump = (kv.get('proxyjump') ?? [])
      .flatMap((v) => v.split(','))
      .map((s) => s.trim())
      .filter((s) => s && s.toLowerCase() !== 'none')

    const proxyCommandRaw = first(kv, 'proxycommand')
    const proxyCommand =
      proxyCommandRaw && proxyCommandRaw.toLowerCase() !== 'none' ? proxyCommandRaw : null

    const forwards: ForwardEntry[] = []
    for (const v of kv.get('localforward') ?? []) forwards.push(parseForward('L', v, 'ssh-config'))
    for (const v of kv.get('remoteforward') ?? []) forwards.push(parseForward('R', v, 'ssh-config'))
    for (const v of kv.get('dynamicforward') ?? []) forwards.push(parseForward('D', v, 'ssh-config'))

    const hop: ResolvedHop = {
      alias,
      hostname: first(kv, 'hostname') ?? alias,
      user: first(kv, 'user') ?? '',
      port: Number(first(kv, 'port') ?? 22) || 22,
      identityFiles: (kv.get('identityfile') ?? []).filter((f) => f.toLowerCase() !== 'none'),
      proxyJump,
      proxyCommand
    }

    return { hop, forwards }
  })
}

// ---------------------------------------------------------------------------
// caching + chain walking
// ---------------------------------------------------------------------------

const cache = new Map<string, { at: number; value: RawConfig }>()

async function readConfigCached(alias: string): Promise<RawConfig> {
  const hit = cache.get(alias)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  const value = await readConfig(alias)
  cache.set(alias, { at: Date.now(), value })
  return value
}

export function clearResolverCache(): void {
  cache.clear()
}

/** Resolve a single host alias (used by the ~/.ssh/config import flow). */
export async function resolveHop(alias: string): Promise<ResolvedHop> {
  return (await readConfigCached(alias)).hop
}

async function walkChain(
  alias: string,
  seen: Set<string>,
  depth: number,
  errors: string[]
): Promise<ResolvedHop[]> {
  if (depth > 8 || seen.has(alias)) return []
  seen.add(alias)

  let self: RawConfig
  try {
    self = await readConfigCached(alias)
  } catch (err) {
    errors.push(`${alias}: ${err instanceof Error ? err.message : String(err)}`)
    return [
      {
        alias,
        hostname: alias,
        user: '',
        port: 22,
        identityFiles: [],
        proxyJump: [],
        proxyCommand: null
      }
    ]
  }

  const out: ResolvedHop[] = []
  for (const jump of self.hop.proxyJump) {
    out.push(...(await walkChain(jump, seen, depth + 1, errors)))
  }
  out.push(self.hop)
  return out
}

function dedupeForwards(list: ForwardEntry[]): ForwardEntry[] {
  const seen = new Set<string>()
  const out: ForwardEntry[] = []
  for (const f of list) {
    const key = `${f.direction}|${toForwardValue(f)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out
}

/** Resolve one tunnel: chain from ~/.ssh/config, forks merged with product config. */
export async function resolveTunnel(cfg: TunnelConfig): Promise<ResolvedTunnel> {
  const errors: string[] = []
  const chain = await walkChain(cfg.host, new Set(), 0, errors)

  let inherited: ForwardEntry[] = []
  try {
    inherited = (await readConfigCached(cfg.host)).forwards
  } catch (err) {
    errors.push(`${cfg.host}: ${err instanceof Error ? err.message : String(err)}`)
  }

  const product: ForwardEntry[] = []
  for (const v of cfg.localForwards ?? []) product.push(parseUserForward('L', v))
  for (const v of cfg.remoteForwards ?? []) product.push(parseUserForward('R', v))
  for (const v of cfg.dynamicForwards ?? []) product.push(parseUserForward('D', v))

  // Product entries come first so they win visually when specs collide.
  const forwards = dedupeForwards([...product, ...inherited])

  return {
    id: cfg.id,
    name: cfg.name || cfg.host,
    host: cfg.host,
    chain,
    forwards,
    errors
  }
}

export async function resolveAll(tunnels: TunnelConfig[]): Promise<ResolvedTunnel[]> {
  return Promise.all(tunnels.map((t) => resolveTunnel(t)))
}
