import { powerMonitor } from 'electron'
import { log } from './logger'

export type PowerEventName = 'sleep' | 'wake' | 'lock' | 'unlock'

export interface PowerHandlers {
  onSleep: () => void
  onWake: () => void
  onLock: () => void
  onUnlock: () => void
}

/**
 * macOS power lifecycle. `suspend`/`resume` are the important ones for us:
 * closing the lid suspends the machine and drops TCP, so we reconnect on
 * `resume`. `lock`/`unlock` are exposed for future use (e.g. stricter policy
 * on unattended machines).
 */
export function registerPowerHandlers(handlers: PowerHandlers): void {
  const pm = powerMonitor

  pm.on('suspend', () => {
    log.info('power: suspend')
    handlers.onSleep()
  })

  pm.on('resume', () => {
    log.info('power: resume')
    handlers.onWake()
  })

  pm.on('lock-screen', () => {
    log.info('power: lock-screen')
    handlers.onLock()
  })

  pm.on('unlock-screen', () => {
    log.info('power: unlock-screen')
    handlers.onUnlock()
  })
}
