/**
 * Downloads the Electron binary that `pnpm dev` / `build` / `start` need.
 *
 * Electron >= 42 no longer downloads itself from its own postinstall script
 * (supply-chain hardening), so a fresh install leaves node_modules/electron
 * with no dist/ and no path.txt. electron-vite reads path.txt directly rather
 * than going through require('electron'), so it never triggers Electron's own
 * on-demand download and every entry point dies with "Electron uninstall" --
 * dev, build and preview alike.
 *
 * Idempotent: electron's install.js exits immediately once path.txt exists.
 *
 * No mirror is assumed. @electron/get reads ELECTRON_MIRROR straight from the
 * environment, so anyone who needs one just exports it:
 *   ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install
 * (See the README -- .npmrc's electron_mirror does not survive pnpm's lifecycle
 * scripts, so the env var is the only route.)
 *
 * Run: node scripts/ensure-electron.mjs
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const install = createRequire(import.meta.url).resolve('electron/install.js')
const { status } = spawnSync(process.execPath, [install], { stdio: 'inherit' })

if (status !== 0) {
  console.error(
    '\nelectron binary was not installed.\n' +
      'If the download failed, point ELECTRON_MIRROR at a reachable mirror:\n' +
      '  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install\n'
  )
}

process.exit(status ?? 1)
