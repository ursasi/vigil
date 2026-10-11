import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { TunnelConfig, VigilConfig } from '../shared/types'
import { log, tilde } from './logger'

/**
 * Configuration resolution (phase 1 logic lives in resolver.ts):
 *   1. product config (this file) — takes priority per field
 *   2. ~/.ssh/config — resolved via `ssh -G`
 */

export function configPath(): string {
  return process.env.VIGIL_CONFIG ?? join(app.getPath('userData'), 'config.json')
}

const DEFAULT_CONFIG: VigilConfig = {
  version: 1,
  notifyOnPowerEvents: true,
  tunnels: []
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function strList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.map((x) => String(x).trim()).filter(Boolean)
  return out.length ? out : undefined
}

export function normalizeTunnel(raw: Partial<TunnelConfig>, index: number): TunnelConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const host = str(raw.host)
  if (!host) {
    log.warn(`config: tunnel #${index} has no host, skipping`)
    return null
  }

  let sshOptions: Record<string, string> | undefined
  if (raw.sshOptions && typeof raw.sshOptions === 'object') {
    const entries = Object.entries(raw.sshOptions)
      .map(([k, v]) => [k.trim(), String(v).trim()] as const)
      .filter(([k, v]) => k && v)
    if (entries.length) sshOptions = Object.fromEntries(entries)
  }

  return {
    id: str(raw.id) ?? host,
    name: str(raw.name) ?? host,
    host,
    enabled: raw.enabled !== false,
    user: str(raw.user),
    port: typeof raw.port === 'number' && raw.port > 0 ? raw.port : undefined,
    identityFile: str(raw.identityFile),
    proxyJump: str(raw.proxyJump),
    localForwards: strList(raw.localForwards),
    remoteForwards: strList(raw.remoteForwards),
    dynamicForwards: strList(raw.dynamicForwards),
    sshOptions,
    extraArgs: strList(raw.extraArgs),
    autoReconnect: raw.autoReconnect !== false,
    notifyOnReconnect: raw.notifyOnReconnect !== false
  }
}

export function normalizeConfig(parsed: unknown): VigilConfig {
  const p = (parsed ?? {}) as Partial<VigilConfig>
  const tunnels = (Array.isArray(p.tunnels) ? p.tunnels : [])
    .map((t, i) => normalizeTunnel(t as Partial<TunnelConfig>, i))
    .filter((t): t is TunnelConfig => t !== null)

  // guarantee unique ids
  const seen = new Set<string>()
  for (const t of tunnels) {
    let id = t.id
    let n = 2
    while (seen.has(id)) id = `${t.id}-${n++}`
    t.id = id
    seen.add(id)
  }

  return {
    version: p.version ?? 1,
    notifyOnPowerEvents: p.notifyOnPowerEvents !== false,
    showDockIcon: p.showDockIcon === true,
    language: p.language === 'zh' || p.language === 'en' ? p.language : undefined,
    tunnels
  }
}

export function loadConfig(): VigilConfig {
  const path = configPath()
  if (!existsSync(path)) {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n', 'utf8')
      log.info(`config: wrote default config to ${tilde(path)}`)
    } catch (err) {
      log.error('config: failed to write default config', err)
    }
    return DEFAULT_CONFIG
  }

  try {
    const cfg = normalizeConfig(JSON.parse(readFileSync(path, 'utf8')))
    log.info(`config: loaded ${cfg.tunnels.length} tunnel(s) from ${tilde(path)}`)
    return cfg
  } catch (err) {
    log.error(`config: failed to parse ${tilde(path)}, using empty config`, err)
    return {
      version: 1,
      notifyOnPowerEvents: true,
      showDockIcon: false,
      tunnels: []
    }
  }
}

export function saveConfig(cfg: unknown): VigilConfig {
  const normalized = normalizeConfig(cfg)
  const path = configPath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(normalized, null, 2) + '\n', 'utf8')
    log.info(`config: saved ${normalized.tunnels.length} tunnel(s) to ${tilde(path)}`)
  } catch (err) {
    log.error('config: failed to save', err)
    throw err
  }
  return normalized
}
