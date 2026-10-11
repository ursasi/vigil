import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { IconFolder, IconRefresh } from './icons'
import { useI18n } from './i18n'

interface LogData {
  path: string
  displayPath: string
  lines: string[]
  bytes: number
}

function Line({ text }: { text: string }): JSX.Element {
  const m = /^(\S+)\s+\[(\w+)\]\s?(.*)$/.exec(text)
  if (!m) return <div className="logline">{text}</div>
  const [, ts, level, rest] = m
  return (
    <div className="logline">
      <span className="logline__ts">{ts.slice(11, 23)}</span>
      <span className={`logline__lvl logline__lvl--${level}`}>{level}</span>
      <span className="logline__msg">{rest}</span>
    </div>
  )
}

export default function Logs(): JSX.Element {
  const { t } = useI18n()
  const [data, setData] = useState<LogData>({ path: '', displayPath: '', lines: [], bytes: 0 })
  const [query, setQuery] = useState('')
  const [autoscroll, setAutoscroll] = useState(true)
  const [problems, setProblems] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const tick = async (): Promise<void> => {
      const d = await window.vigil.getLogs()
      if (alive) setData(d)
    }
    void tick()
    const timer = setInterval(tick, 1500)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const lines = useMemo(() => {
    let ls = data.lines.filter((l) => l.length > 0)
    if (problems) ls = ls.filter((l) => /\[(WARN|ERROR)\]/.test(l))
    const q = query.trim().toLowerCase()
    if (q) ls = ls.filter((l) => l.toLowerCase().includes(q))
    return ls
  }, [data.lines, query, problems])

  useEffect(() => {
    if (autoscroll && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight
    }
  }, [lines.length, autoscroll])

  return (
    <div className="logs">
      <div className="logs__bar">
        <input
          className="logs__search"
          placeholder={t('logs.search')}
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={problems}
            onChange={(e) => setProblems(e.target.checked)}
          />
          {t('logs.onlyProblems')}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={autoscroll}
            onChange={(e) => setAutoscroll(e.target.checked)}
          />
          {t('logs.autoscroll')}
        </label>
        <div className="settings__spacer" />
        <span className="logs__count">{t('logs.lines', { n: lines.length })}</span>
        <button className="btn btn--sm" onClick={() => void window.vigil.getLogs().then(setData)}>
          <IconRefresh size={13} /> {t('action.refresh')}
        </button>
        <button
          className="btn btn--sm"
          onClick={async () => {
            await window.vigil.clearLogs()
            setData(await window.vigil.getLogs())
          }}
        >
          {t('logs.clear')}
        </button>
        <button className="btn btn--sm" onClick={() => void window.vigil.openLogs()}>
          <IconFolder size={13} /> {t('logs.dir')}
        </button>
      </div>
      <div className="logs__path" title={data.path}>
        {data.displayPath}
      </div>
      <div className="logs__box" ref={boxRef}>
        {lines.length === 0 && <div className="logs__empty">{t('logs.empty')}</div>}
        {lines.map((l, i) => (
          <Line key={i} text={l} />
        ))}
      </div>
    </div>
  )
}
