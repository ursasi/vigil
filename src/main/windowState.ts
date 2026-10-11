import { app, screen } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { log } from './logger'

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export const DEFAULT_BOUNDS: WindowBounds = { width: 920, height: 640 }

function statePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/** Restore the last window geometry, if it still lands on a connected display. */
export function loadWindowBounds(): WindowBounds {
  try {
    if (!existsSync(statePath())) return DEFAULT_BOUNDS
    const b = JSON.parse(readFileSync(statePath(), 'utf8')) as WindowBounds
    if (typeof b.width !== 'number' || typeof b.height !== 'number') return DEFAULT_BOUNDS

    const width = Math.max(620, Math.round(b.width))
    const height = Math.max(460, Math.round(b.height))
    const x = typeof b.x === 'number' ? Math.round(b.x) : undefined
    const y = typeof b.y === 'number' ? Math.round(b.y) : undefined

    if (x === undefined || y === undefined) return { width, height }

    const onScreen = screen.getAllDisplays().some((d) => {
      const wa = d.workArea
      return x < wa.x + wa.width && x + width > wa.x && y < wa.y + wa.height && y + height > wa.y
    })
    return onScreen ? { x, y, width, height } : { width, height }
  } catch (err) {
    log.warn('failed to load window state', err)
    return DEFAULT_BOUNDS
  }
}

export function saveWindowBounds(b: WindowBounds): void {
  try {
    writeFileSync(statePath(), JSON.stringify(b))
  } catch (err) {
    log.warn('failed to save window state', err)
  }
}
