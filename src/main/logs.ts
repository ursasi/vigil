import { app } from 'electron'
import { closeSync, existsSync, fstatSync, openSync, readSync, truncateSync } from 'fs'
import { join } from 'path'
import { tilde } from './logger'

export function logFilePath(): string {
  return join(app.getPath('logs'), 'vigil.log')
}

const MAX_TAIL_BYTES = 256 * 1024

/** Read the tail of the log file without loading the whole thing. */
export function readLogTail(
  maxLines = 1000
): { path: string; displayPath: string; lines: string[]; bytes: number } {
  const path = logFilePath()
  const displayPath = tilde(path)
  if (!existsSync(path)) return { path, displayPath, lines: [], bytes: 0 }

  let text = ''
  let bytes = 0
  try {
    const fd = openSync(path, 'r')
    try {
      const size = fstatSync(fd).size
      bytes = size
      const start = Math.max(0, size - MAX_TAIL_BYTES)
      const len = size - start
      const buf = Buffer.alloc(len)
      readSync(fd, buf, 0, len, start)
      text = buf.toString('utf8')
    } finally {
      closeSync(fd)
    }
  } catch {
    return { path, displayPath, lines: [], bytes: 0 }
  }

  const lines = text.split('\n')
  // drop a leading partial line when we started mid-file
  if (bytes > MAX_TAIL_BYTES) lines.shift()
  return { path, displayPath, lines: lines.slice(-maxLines), bytes }
}

export function clearLog(): void {
  const path = logFilePath()
  if (!existsSync(path)) return
  try {
    truncateSync(path, 0)
  } catch {
    /* ignore */
  }
}
