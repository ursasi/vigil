/**
 * Standalone resolver check. Run with:
 *   node --experimental-strip-types scripts/resolve-check.ts
 */
import { resolveAll } from '../src/main/resolver.ts'
import type { TunnelConfig } from '../src/shared/types.ts'

const tunnels: TunnelConfig[] = [
  { id: 'server100', host: 'server100', enabled: true },
  // same host, but with a product-level forward to test merging + tagging
  {
    id: 'server100+product',
    host: 'server100',
    enabled: true,
    localForwards: ['9999:localhost:9999']
  },
  { id: '4090', host: '4090', enabled: true },
  { id: 'jump57', host: 'jump57', enabled: true }
]

const resolved = await resolveAll(tunnels)

for (const t of resolved) {
  console.log('\n============================================================')
  console.log(`tunnel: ${t.id}   host=${t.host}`)
  if (t.errors.length) console.log('errors:', t.errors)
  console.log('chain:')
  t.chain.forEach((h, i) => {
    const last = i === t.chain.length - 1
    console.log(
      `  ${i + 1}. ${h.alias}  ->  ${h.user}@${h.hostname}:${h.port}` +
        (last ? '   [target]' : '') +
        (h.proxyCommand ? `   proxycommand=${h.proxyCommand}` : '')
    )
  })
  console.log('forwards:')
  for (const f of t.forwards) {
    console.log(`  [${f.direction}] ${f.label}   (${f.source})`)
  }
  if (!t.forwards.length) console.log('  (none)')
}
