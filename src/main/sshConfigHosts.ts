import { existsSync, readFileSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import type { SshHostEntry } from '../shared/types'
import { resolveHop } from './resolver'

/** Expand a simple glob (* and ?) in the last path segment. */
function expandGlob(pattern: string): string[] {
  if (!/[*?]/.test(pattern)) return existsSync(pattern) ? [pattern] : []
  const dir = dirname(pattern)
  const base = pattern.slice(dir.length + 1)
  if (!existsSync(dir)) return []
  const re = new RegExp(
    '^' +
      base
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$'
  )
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => join(dir, f))
    .sort()
}

function collectAliases(file: string, seen: Set<string>, out: Set<string>, depth = 0): void {
  if (depth > 8 || seen.has(file) || !existsSync(file)) return
  seen.add(file)

  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return
  }
  const baseDir = dirname(file)

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const m = /^(\w+)\s+(.*)$/.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()

    if (key === 'host') {
      for (const tok of value.split(/\s+/)) {
        // skip wildcard / negation patterns — they are not connectable hosts
        if (!tok || /[*?!]/.test(tok)) continue
        out.add(tok)
      }
    } else if (key === 'include') {
      for (const p of value.split(/\s+/)) {
        if (!p) continue
        const abs = p.startsWith('~') ? p.replace(/^~/, homedir()) : resolve(baseDir, p)
        for (const f of expandGlob(abs)) collectAliases(f, seen, out, depth + 1)
      }
    }
  }
}

/** Every concrete Host alias in the ssh config (plus Include'd files). */
export async function listSshConfigHosts(): Promise<SshHostEntry[]> {
  const aliases = new Set<string>()
  const root = process.env.VIGIL_SSH_CONFIG ?? join(homedir(), '.ssh', 'config')
  collectAliases(root, new Set(), aliases)

  const entries: SshHostEntry[] = []
  for (const alias of [...aliases].sort()) {
    try {
      const hop = await resolveHop(alias)
      entries.push({
        alias,
        hostname: hop.hostname,
        user: hop.user,
        port: hop.port,
        proxyJump: hop.proxyJump
      })
    } catch {
      entries.push({ alias, hostname: alias, user: '', port: 22, proxyJump: [] })
    }
  }
  return entries
}
