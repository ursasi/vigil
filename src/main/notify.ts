import { Notification } from 'electron'
import { log } from './logger'

export function notify(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) {
      log.warn('notify: system notifications not supported')
      return
    }
    new Notification({ title, body, silent: false }).show()
    log.info(`notify: ${title} — ${body}`)
  } catch (err) {
    log.error('notify: failed', err)
  }
}
