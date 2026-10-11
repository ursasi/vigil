import type { ResolvedTunnel } from '../../shared/types'

export type FwdStatus =
  | 'listening'
  | 'external-same'
  | 'conflict-ssh'
  | 'conflict-other'
  | 'failed'
  | 'remote'
  | 'unknown'

export const FST_KEY: Record<FwdStatus, string> = {
  listening: 'fst.listening',
  'external-same': 'fst.externalSame',
  'conflict-ssh': 'fst.conflictSsh',
  'conflict-other': 'fst.conflictOther',
  failed: 'fst.failed',
  remote: 'fst.remote',
  unknown: 'fst.unknown'
}

/** Hex colours for graph edges / css vars. */
export const FST_COLOR: Record<FwdStatus, string> = {
  listening: '#34d399',
  'external-same': '#38bdf8',
  'conflict-ssh': '#f87171',
  'conflict-other': '#fb923c',
  failed: '#f87171',
  remote: '#c084fc',
  unknown: '#6b7280'
}

export interface FwdInfo {
  status: FwdStatus
  conns: number
  /** who holds the port, when it is a conflict */
  owner: string
  /** local forward, or remote (-R) */
  where: 'local' | 'remote'
  /** end-to-end probe latency in ms (local forwards only) */
  ms?: number
}

export function classifyForward(
  f: ResolvedTunnel['forwards'][number],
  topo: ResolvedTunnel | undefined
): FwdInfo {
  const where = f.direction === 'R' ? 'remote' : 'local'
  if (!topo) return { status: 'unknown', conns: 0, owner: '', where }

  if (f.direction === 'R') {
    const chk = (topo.remoteChecks ?? []).find((c) => c.port === f.bindPort)
    if (!chk || chk.status === 'unknown') return { status: 'remote', conns: 0, owner: '', where }
    return {
      status: chk.status === 'listening' ? 'listening' : 'failed',
      conns: 0,
      owner: '',
      where
    }
  }

  if (f.bindPort === null) return { status: 'unknown', conns: 0, owner: '', where }

  const listening = (topo.runtime?.listening ?? []).some((s) => s.port === f.bindPort)
  const conns = (topo.runtime?.connections ?? []).filter((c) => c.localPort === f.bindPort).length
  if (listening) {
    const probe = (topo.probes ?? []).find((p) => p.port === f.bindPort)
    return { status: 'listening', conns, owner: '', where, ms: probe?.ms }
  }

  const ext = (topo.externalListeners ?? []).find((e) => e.port === f.bindPort)
  if (!ext) return { status: 'failed', conns: 0, owner: '', where }
  if (ext.isSsh && ext.sameTarget)
    return { status: 'external-same', conns: 0, owner: ext.command, where }
  if (ext.isSsh)
    return { status: 'conflict-ssh', conns: 0, owner: ext.sshDestination ?? 'ssh', where }
  return { status: 'conflict-other', conns: 0, owner: ext.command, where }
}

/** Ports already served by another ssh aimed at the same host. */
export function externalSamePorts(topo: ResolvedTunnel | undefined): Set<number> {
  return new Set(
    (topo?.externalListeners ?? []).filter((e) => e.isSsh && e.sameTarget).map((e) => e.port)
  )
}

/** Ports lost to a genuinely different owner (another ssh, or another app). */
export function conflictPorts(topo: ResolvedTunnel | undefined): Set<number> {
  return new Set(
    (topo?.externalListeners ?? [])
      .filter((e) => !(e.isSsh && e.sameTarget))
      .map((e) => e.port)
  )
}
