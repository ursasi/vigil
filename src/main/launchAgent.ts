import { app } from 'electron'
import { execFile } from 'child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { log, tilde } from './logger'

/**
 * A LaunchAgent that starts Vigil at login and restarts it if it crashes
 * (KeepAlive on non-zero exit). This is what keeps tunnels alive in the
 * background without depending on the window being open.
 */

const LABEL = 'dev.vigil.mac'

export function agentPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function programArguments(): string[] {
  const exe = process.execPath
  // Packaged: the app binary is enough. Dev: also pass the project dir.
  return app.isPackaged ? [exe] : [exe, app.getAppPath()]
}

export function isAgentInstalled(): boolean {
  return existsSync(agentPlistPath())
}

function launchctl(args: string[]): Promise<void> {
  return new Promise((resolve) => {
    execFile('/bin/launchctl', args, (err, _stdout, stderr) => {
      if (err) log.warn(`launchctl ${args.join(' ')}: ${(stderr || err.message).trim()}`)
      resolve()
    })
  })
}

export async function installAgent(): Promise<boolean> {
  const args = programArguments()
    .map((a) => `    <string>${escapeXml(a)}</string>`)
    .join('\n')

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
`

  const path = agentPlistPath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, plist, 'utf8')
  } catch (err) {
    log.error('failed to write launch agent', err)
    return false
  }

  const uid = process.getuid?.() ?? 0
  await launchctl(['bootout', `gui/${uid}/${LABEL}`])
  await launchctl(['bootstrap', `gui/${uid}`, path])
  log.info(`launch agent installed: ${tilde(path)}`)
  return true
}

export async function uninstallAgent(): Promise<void> {
  const uid = process.getuid?.() ?? 0
  await launchctl(['bootout', `gui/${uid}/${LABEL}`])
  try {
    rmSync(agentPlistPath())
  } catch (err) {
    log.warn('failed to remove launch agent', err)
  }
  log.info('launch agent removed')
}
