import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/** Replace the home prefix with `~` so paths stay portable (and private). */
export function tilde(p: string): string {
  const home = homedir()
  return p.startsWith(home) ? '~' + p.slice(home.length) : p
}

let logPath = ''

export function initLogger(): void {
  try {
    const dir = app.getPath('logs')
    mkdirSync(dir, { recursive: true })
    logPath = join(dir, 'vigil.log')
  } catch {
    logPath = ''
  }
}

function stringify(x: unknown): string {
  if (x === undefined) return ''
  if (typeof x === 'string') return x
  if (x instanceof Error) return x.stack ?? x.message
  try {
    return JSON.stringify(x)
  } catch {
    return String(x)
  }
}

function write(level: string, msg: string, meta?: unknown): void {
  const extra = stringify(meta)
  const line = `${new Date().toISOString()} [${level}] ${msg}${extra ? ' ' + extra : ''}`
  // eslint-disable-next-line no-console
  console.log(line)
  if (logPath) {
    try {
      appendFileSync(logPath, line + '\n')
    } catch {
      /* ignore log write failures */
    }
  }
}

export const log = {
  info: (m: string, x?: unknown) => write('INFO', m, x),
  warn: (m: string, x?: unknown) => write('WARN', m, x),
  error: (m: string, x?: unknown) => write('ERROR', m, x),
  debug: (m: string, x?: unknown) => write('DEBUG', m, x)
}
