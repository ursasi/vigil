import { useCallback, useEffect, useState, type CSSProperties, type JSX } from 'react'
import type { ResolvedTunnel, TunnelStatus } from '../../shared/types'
import Topology from './Topology'
import Settings from './Settings'
import Logs from './Logs'
import { classifyForward, conflictPorts, externalSamePorts, FST_COLOR, FST_KEY } from './status'
import { useI18n } from './i18n'
import {
  IconAlert,
  IconEye,
  IconFolder,
  IconInfo,
  IconLaptop,
  IconRefresh,
  IconRelay,
  IconServer
} from './icons'

const STATE_KEY: Record<TunnelStatus['state'], string> = {
  connected: 'state.connected',
  starting: 'state.starting',
  reconnecting: 'state.reconnecting',
  error: 'state.error',
  stopped: 'state.stopped',
  external: 'state.external'
}

const DIR_KEY: Record<'L' | 'R' | 'D', string> = {
  L: 'dir.L',
  R: 'dir.R',
  D: 'dir.D'
}

type TFn = (key: string, params?: Record<string, string | number>) => string

function sinceText(ts: number | undefined, t: TFn): string {
  if (!ts) return '—'
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return t('unit.sec', { n: s })
  if (s < 3600) return t('unit.min', { m: Math.floor(s / 60), s: s % 60 })
  return t('unit.hour', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) })
}

export default function App(): JSX.Element {
  const { t } = useI18n()
  const [statuses, setStatuses] = useState<TunnelStatus[]>([])
  const [topology, setTopology] = useState<ResolvedTunnel[]>([])
  const [tab, setTab] = useState<'tunnels' | 'topology' | 'settings' | 'logs'>('tunnels')
  const [cmd, setCmd] = useState<{ id: string; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [, tick] = useState(0)

  const loadTopology = useCallback(async (refresh = false) => {
    setTopology(refresh ? await window.vigil.refreshTopology() : await window.vigil.getTopology())
  }, [])

  useEffect(() => {
    let mounted = true
    window.vigil.getStatuses().then((s) => mounted && setStatuses(s))
    window.vigil.getTopology().then((tp) => mounted && setTopology(tp))
    const offStatus = window.vigil.onStatus((s) => mounted && setStatuses(s))
    const offTopo = window.vigil.onTopology((tp) => mounted && setTopology(tp))
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => {
      mounted = false
      offStatus()
      offTopo()
      clearInterval(timer)
    }
  }, [])

  const topoById = new Map(topology.map((tp) => [tp.id, tp]))

  const showCmd = async (id: string): Promise<void> => {
    if (cmd?.id === id) {
      setCmd(null)
      return
    }
    setCmd({ id, text: await window.vigil.getSshCommand(id) })
  }

  const copyCmd = async (): Promise<void> => {
    if (!cmd) return
    await window.vigil.copyText(cmd.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const connected = statuses.filter(
    (s) => s.state === 'connected' || s.state === 'external'
  ).length
  const health =
    statuses.length === 0
      ? 'idle'
      : connected === statuses.length
        ? 'ok'
        : connected > 0
          ? 'warn'
          : 'down'

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark">
            <IconEye size={19} />
          </span>
          <div className="brand__text">
            <h1>Vigil</h1>
            <p>SSH tunnels that never sleep.</p>
          </div>
        </div>
        <div className={`health health--${health}`}>
          <span className="health__num">
            {connected}
            <i>/{statuses.length}</i>
          </span>
          <span className="health__label">{t('health.connected')}</span>
        </div>
      </header>

      <div className="controls">
        <div className="segmented">
          {(
            [
              ['tunnels', 'tab.tunnels'],
              ['topology', 'tab.topology'],
              ['settings', 'tab.settings'],
              ['logs', 'tab.logs']
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              data-tab={key}
              className={tab === key ? 'seg seg--on' : 'seg'}
              onClick={() => setTab(key)}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <div className="controls__spacer" />
        <button className="btn btn--primary" onClick={() => void window.vigil.restartAll()}>
          <IconRefresh size={14} /> {t('action.reconnectAll')}
        </button>
        <button className="btn" title={t('action.refreshTopology')} onClick={() => void loadTopology(true)}>
          <IconRefresh size={14} />
        </button>
        <button className="btn" title={t('action.openLogs')} onClick={() => void window.vigil.openLogs()}>
          <IconFolder size={14} />
        </button>
      </div>

      {tab === 'tunnels' ? (
        <main className="list">
          {statuses.length === 0 && (
            <div className="empty">
              <IconServer size={28} />
              <p>{t('empty.title')}</p>
              <span>{t('empty.hint')}</span>
            </div>
          )}

          {statuses.map((s) => {
            const topo = topoById.get(s.id)
            const conflicts = conflictPorts(topo)
            const sames = externalSamePorts(topo)
            const portWarnings = new Set([...conflicts, ...sames])
            const otherWarnings = s.warnings.filter(
              (w) => ![...portWarnings].some((p) => w.includes(':' + p))
            )
            const fmtPorts = (ports: Set<number>): string =>
              [...ports].map((p) => ':' + p).join(', ')

            return (
              <article key={s.id} className={`card card--${s.state}`}>
                <div className="card__head">
                  <span className={`dot dot--${s.state}`} />
                  <div className="card__id">
                    <h2>{s.name}</h2>
                    <span className="card__host">{s.host}</span>
                  </div>
                  <span className={`chip chip--${s.state}`}>{t(STATE_KEY[s.state])}</span>
                </div>

                <div className="metrics">
                  <span>
                    {t('metric.pid')} {s.pid ?? s.externalPid ?? '—'}
                  </span>
                  <span>
                    {s.state === 'external' ? t('metric.externalOnline') : t('metric.online')}{' '}
                    {sinceText(s.since, t)}
                  </span>
                  {s.attempts > 1 && (
                    <span className="metrics__retry">{t('metric.retry', { n: s.attempts })}</span>
                  )}
                </div>

                {topo && topo.chain.length > 0 && (
                  <div className="chain">
                    <span className="hop hop--local" title={t('topo.local')}>
                      <IconLaptop size={13} />
                    </span>
                    {topo.chain.map((h, i) => (
                      <span key={`${h.alias}-${i}`} className="chain__seg">
                        <span className="chain__arrow" />
                        <span
                          className={
                            i === topo.chain.length - 1 ? 'hop hop--target' : 'hop hop--jump'
                          }
                          title={`${h.user}@${h.hostname}:${h.port}`}
                        >
                          {i === topo.chain.length - 1 ? (
                            <IconServer size={13} />
                          ) : (
                            <IconRelay size={13} />
                          )}
                          <b>{h.alias}</b>
                          <em>:{h.port}</em>
                        </span>
                      </span>
                    ))}
                  </div>
                )}

                {topo && topo.forwards.length > 0 && (
                  <ul className="fwdlist">
                    {topo.forwards.map((f, i) => {
                      const st = classifyForward(f, topo)
                      return (
                        <li key={i} className="fwdrow">
                          <span className={`dir dir--${f.direction}`}>
                            {t(DIR_KEY[f.direction])}
                          </span>
                          <span className="fwdrow__map">{f.label}</span>
                          <span
                            className={`stat stat--${st.status}`}
                            style={{ '--stat': FST_COLOR[st.status] } as CSSProperties}
                            title={st.owner ? `${t('fst.conflictSsh')}: ${st.owner}` : undefined}
                          >
                            <i className="stat__dot" />
                            {st.where === 'remote'
                              ? t('fst.remotePrefix') + t(FST_KEY[st.status])
                              : t(FST_KEY[st.status])}
                            {st.conns > 0 && <em>{t('fst.conn', { n: st.conns })}</em>}
                            {st.ms !== undefined && st.status === 'listening' && (
                              <em>{t('fst.ms', { n: st.ms })}</em>
                            )}
                          </span>
                          <span className="srcpill">
                            {f.source === 'product' ? 'Vigil' : 'ssh'}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}

                {conflicts.size > 0 && (
                  <div className="notice notice--error">
                    <IconAlert size={14} />
                    <span>
                      {t('notice.conflict', { ports: fmtPorts(conflicts) })}
                      {topo?.externalListeners
                        ?.filter((e) => conflicts.has(e.port))
                        .map((e) => ` · ${e.isSsh ? e.sshDestination ?? 'ssh' : e.command}`)
                        .join('')}
                    </span>
                  </div>
                )}

                {sames.size > 0 && (
                  <div className="notice notice--info">
                    <IconInfo size={14} />
                    <span>{t('notice.same', { ports: fmtPorts(sames) })}</span>
                  </div>
                )}

                {otherWarnings.length > 0 && (
                  <div className="notice notice--warn">
                    <IconAlert size={14} />
                    <span>{otherWarnings.join(' · ')}</span>
                  </div>
                )}

                {s.lastError && s.state !== 'connected' && s.state !== 'external' && (
                  <pre className="error">{s.lastError}</pre>
                )}

                <div className="card__actions">
                  <button className="btn btn--sm" onClick={() => void window.vigil.restart(s.id)}>
                    {t('action.reconnect')}
                  </button>
                  <button className="btn btn--sm" onClick={() => void window.vigil.stop(s.id)}>
                    {t('action.stop')}
                  </button>
                  <button className="btn btn--sm" onClick={() => void window.vigil.start(s.id)}>
                    {t('action.start')}
                  </button>
                  <button
                    className="btn btn--sm"
                    data-action="command"
                    onClick={() => void showCmd(s.id)}
                  >
                    {cmd?.id === s.id ? t('action.hideCommand') : t('action.command')}
                  </button>
                </div>

                {cmd?.id === s.id && (
                  <div className="sshcmd">
                    <pre>{cmd.text}</pre>
                    <button className="btn btn--sm btn--primary" onClick={() => void copyCmd()}>
                      {copied ? t('action.copied') : t('action.copy')}
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </main>
      ) : tab === 'topology' ? (
        <Topology topology={topology} statuses={statuses} />
      ) : tab === 'logs' ? (
        <Logs />
      ) : (
        <Settings
          onSaved={() => {
            void loadTopology(true)
            window.vigil.getStatuses().then(setStatuses)
          }}
        />
      )}
    </div>
  )
}
