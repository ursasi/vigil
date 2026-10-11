import type { TunnelConfig } from '../shared/types'

export const SSH_BIN = '/usr/bin/ssh'

/** Args applied to every managed connection. */
export const SSH_BASE_ARGS = [
  '-N',
  '-o',
  'BatchMode=yes',
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ServerAliveCountMax=3',
  '-o',
  'TCPKeepAlive=yes',
  '-o',
  'ExitOnForwardFailure=no'
]

/** Config files ssh should read. `VIGIL_SSH_CONFIG` overrides them entirely. */
export function sshConfigArgs(): string[] {
  const override = process.env.VIGIL_SSH_CONFIG
  return override ? ['-F', override] : []
}

/** The exact argv Vigil passes to ssh for this tunnel. */
export function buildSshArgs(cfg: TunnelConfig): string[] {
  const args = [...sshConfigArgs(), ...SSH_BASE_ARGS]
  if (cfg.user) args.push('-l', cfg.user)
  if (cfg.port) args.push('-p', String(cfg.port))
  if (cfg.identityFile) args.push('-i', cfg.identityFile)
  if (cfg.proxyJump) args.push('-J', cfg.proxyJump)
  for (const f of cfg.dynamicForwards ?? []) args.push('-D', f)
  for (const f of cfg.localForwards ?? []) args.push('-L', f)
  for (const f of cfg.remoteForwards ?? []) args.push('-R', f)
  for (const [k, v] of Object.entries(cfg.sshOptions ?? {})) args.push('-o', `${k}=${v}`)
  if (cfg.extraArgs?.length) args.push(...cfg.extraArgs)
  args.push(cfg.host)
  return args
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** A copy-pasteable shell command equivalent to what Vigil runs. */
export function buildSshCommand(cfg: TunnelConfig): string {
  return ['ssh', ...buildSshArgs(cfg)].map(shellQuote).join(' ')
}
