import { useEffect, useMemo, useState, type JSX } from 'react'
import type { SshHostEntry, TunnelConfig, VigilConfig } from '../../shared/types'
import type { Lang } from '../../shared/i18n'
import { IconAlert, IconFolder, IconLink, IconRefresh } from './icons'
import { useI18n } from './i18n'

type TFn = (key: string, params?: Record<string, string | number>) => string

function emptyTunnel(): TunnelConfig {
  return {
    id: '',
    name: '',
    host: '',
    enabled: true,
    autoReconnect: true,
    notifyOnReconnect: true
  }
}

/** Strip empty optional fields before saving. */
function clean(cfg: VigilConfig): VigilConfig {
  const tunnels = cfg.tunnels.map((t) => {
    const out: TunnelConfig = { ...t }
    const drop = (k: keyof TunnelConfig): void => {
      const v = out[k]
      if (v === '' || v === undefined || (Array.isArray(v) && v.length === 0)) delete out[k]
    }
    ;(
      [
        'user',
        'identityFile',
        'proxyJump',
        'localForwards',
        'remoteForwards',
        'dynamicForwards',
        'extraArgs'
      ] as const
    ).forEach(drop)
    if (out.sshOptions && Object.keys(out.sshOptions).length === 0) delete out.sshOptions
    if (!out.id) out.id = out.host
    if (!out.name) out.name = out.host
    return out
  })
  return { ...cfg, tunnels }
}

// ---------------------------------------------------------------------------

interface StringListProps {
  label: string
  hint?: string
  desc?: string
  placeholder?: string
  values: string[] | undefined
  onChange: (v: string[] | undefined) => void
  t: TFn
}

function StringList({
  label,
  hint,
  desc,
  placeholder,
  values,
  onChange,
  t
}: StringListProps): JSX.Element {
  const list = values ?? []
  const commit = (next: string[]): void => onChange(next.length ? next : undefined)
  return (
    <div className="field">
      <label className="field__label">
        {label} {hint && <em>{hint}</em>}
      </label>
      {desc && <span className="field__hint">{desc}</span>}
      <div className="stack">
        {list.map((v, i) => (
          <div className="row" key={i}>
            <input
              value={v}
              placeholder={placeholder}
              spellCheck={false}
              onChange={(e) => commit(list.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button className="iconx" onClick={() => commit(list.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
        <button className="addbtn" onClick={() => commit([...list, ''])}>
          {t('settings.add')}
        </button>
      </div>
    </div>
  )
}

interface KVProps {
  value: Record<string, string> | undefined
  onChange: (v: Record<string, string> | undefined) => void
  t: TFn
}

function KVEditor({ value, onChange, t }: KVProps): JSX.Element {
  const entries = useMemo(() => Object.entries(value ?? {}), [value])
  const put = (next: [string, string][]): void => {
    const obj: Record<string, string> = {}
    for (const [k, v] of next) if (k.trim()) obj[k.trim()] = v
    onChange(Object.keys(obj).length ? obj : undefined)
  }
  return (
    <div className="field">
      <label className="field__label">
        {t('settings.sshOptions')} <em>Key = Value</em>
      </label>
      <span className="field__hint">{t('settings.sshOptionsDesc')}</span>
      <div className="stack">
        {entries.map(([k, v], i) => (
          <div className="row" key={i}>
            <input
              value={k}
              placeholder="ExitOnForwardFailure"
              spellCheck={false}
              onChange={(e) =>
                put(entries.map(([kk, vv], j) => (j === i ? [e.target.value, vv] : [kk, vv])))
              }
            />
            <span className="eq">=</span>
            <input
              value={v}
              placeholder="no"
              spellCheck={false}
              onChange={(e) =>
                put(entries.map(([kk, vv], j) => (j === i ? [kk, e.target.value] : [kk, vv])))
              }
            />
            <button className="iconx" onClick={() => put(entries.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
        <button className="addbtn" onClick={() => put([...entries, ['', '']])}>
          {t('settings.add')}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

interface TunnelFormProps {
  tunnel: TunnelConfig
  onChange: (patch: Partial<TunnelConfig>) => void
  onRemove: () => void
  t: TFn
}

function TunnelForm({ tunnel, onChange, onRemove, t }: TunnelFormProps): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <article className="edcard">
      <div className="edcard__head">
        <span className={`dot dot--${tunnel.enabled ? 'connected' : 'stopped'}`} />
        <input
          className="edcard__name"
          value={tunnel.name ?? ''}
          placeholder={t('settings.namePh')}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <label className="switch" title={t('settings.autoReconnect')}>
          <input
            type="checkbox"
            checked={tunnel.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          <span />
        </label>
        <button className="iconx iconx--danger" title={t('settings.delete')} onClick={onRemove}>
          ×
        </button>
      </div>

      <div className="grid">
        <div className="field">
          <label className="field__label">
            {t('settings.host')} <b>*</b>
          </label>
          <input
            value={tunnel.host}
            placeholder="server100"
            spellCheck={false}
            onChange={(e) => onChange({ host: e.target.value })}
          />
          <span className="field__hint">{t('settings.hostHint')}</span>
        </div>
        <div className="field">
          <label className="field__label">{t('settings.user')}</label>
          <input
            value={tunnel.user ?? ''}
            placeholder={t('settings.userPh')}
            spellCheck={false}
            onChange={(e) => onChange({ user: e.target.value })}
          />
          <span className="field__hint">{t('settings.userHint')}</span>
        </div>
        <div className="field field--sm">
          <label className="field__label">{t('settings.port')}</label>
          <input
            type="number"
            value={tunnel.port ?? ''}
            placeholder="22"
            onChange={(e) =>
              onChange({ port: e.target.value ? Number(e.target.value) : undefined })
            }
          />
          <span className="field__hint">{t('settings.portHint')}</span>
        </div>
      </div>

      <button className="disclose" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} {t('settings.advanced')}
      </button>

      {open && (
        <div className="advanced">
          <p className="advanced__note">{t('settings.advancedNote')}</p>
          <div className="grid grid--2">
            <div className="field">
              <label className="field__label">{t('settings.identity')}</label>
              <input
                value={tunnel.identityFile ?? ''}
                placeholder="~/.ssh/id_ed25519"
                spellCheck={false}
                onChange={(e) => onChange({ identityFile: e.target.value })}
              />
              <span className="field__hint">{t('settings.identityHint')}</span>
            </div>
            <div className="field">
              <label className="field__label">{t('settings.proxyJump')}</label>
              <input
                value={tunnel.proxyJump ?? ''}
                placeholder="jump57"
                spellCheck={false}
                onChange={(e) => onChange({ proxyJump: e.target.value })}
              />
              <span className="field__hint">{t('settings.proxyJumpHint')}</span>
            </div>
          </div>

          <StringList
            t={t}
            label={t('settings.localForward')}
            hint="-L"
            desc={t('settings.localForwardDesc')}
            placeholder="8042:localhost:80"
            values={tunnel.localForwards}
            onChange={(v) => onChange({ localForwards: v })}
          />
          <StringList
            t={t}
            label={t('settings.remoteForward')}
            hint="-R"
            desc={t('settings.remoteForwardDesc')}
            placeholder="2222:localhost:22"
            values={tunnel.remoteForwards}
            onChange={(v) => onChange({ remoteForwards: v })}
          />
          <StringList
            t={t}
            label={t('settings.dynamicForward')}
            hint="-D, SOCKS"
            desc={t('settings.dynamicForwardDesc')}
            placeholder="127.0.0.1:1080"
            values={tunnel.dynamicForwards}
            onChange={(v) => onChange({ dynamicForwards: v })}
          />

          <KVEditor t={t} value={tunnel.sshOptions} onChange={(v) => onChange({ sshOptions: v })} />
          <StringList
            t={t}
            label={t('settings.extraArgs')}
            desc={t('settings.extraArgsDesc')}
            placeholder="-4"
            values={tunnel.extraArgs}
            onChange={(v) => onChange({ extraArgs: v })}
          />

          <div className="toggles">
            <label className="check">
              <input
                type="checkbox"
                checked={tunnel.autoReconnect !== false}
                onChange={(e) => onChange({ autoReconnect: e.target.checked })}
              />
              {t('settings.autoReconnect')}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={tunnel.notifyOnReconnect !== false}
                onChange={(e) => onChange({ notifyOnReconnect: e.target.checked })}
              />
              {t('settings.notifyOnReconnect')}
            </label>
          </div>
        </div>
      )}
    </article>
  )
}

// ---------------------------------------------------------------------------

export interface SettingsProps {
  onSaved: () => void
}

export default function Settings({ onSaved }: SettingsProps): JSX.Element {
  const { t, lang, setLang } = useI18n()
  const [draft, setDraft] = useState<VigilConfig | null>(null)
  const [savedJson, setSavedJson] = useState('')
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [agent, setAgent] = useState(false)
  const [hosts, setHosts] = useState<SshHostEntry[] | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const load = async (): Promise<void> => {
    const cfg = await window.vigil.getConfig()
    setDraft(cfg)
    setSavedJson(JSON.stringify(cfg))
  }

  useEffect(() => {
    void load()
    void window.vigil.getAgentStatus().then((s) => setAgent(s.installed))
  }, [])

  const toggleAgent = async (v: boolean): Promise<void> => {
    setAgent(v)
    const res = await window.vigil.setAgent(v)
    setAgent(res.installed)
    setStatus({ kind: 'ok', text: t(v ? 'settings.daemonOn' : 'settings.daemonOff') })
  }

  const openImport = async (): Promise<void> => {
    setImportOpen(true)
    setStatus(null)
    if (!hosts) setHosts(await window.vigil.listSshHosts())
  }

  const existingHosts = new Set((draft?.tunnels ?? []).map((x) => x.host))
  const importable = (hosts ?? []).filter((h) => !existingHosts.has(h.alias))

  const doImport = (): void => {
    const add = importable.filter((h) => selected.has(h.alias))
    setDraft((d) =>
      d
        ? {
            ...d,
            tunnels: [
              ...d.tunnels,
              ...add.map<TunnelConfig>((h) => ({
                id: h.alias,
                name: h.alias,
                host: h.alias,
                enabled: true,
                autoReconnect: true,
                notifyOnReconnect: true
              }))
            ]
          }
        : d
    )
    setSelected(new Set())
    setImportOpen(false)
    setStatus({ kind: 'ok', text: t('settings.importedN', { n: add.length }) })
  }

  if (!draft) return <main className="list" />

  const dirty = JSON.stringify(draft) !== savedJson
  const updateTunnel = (i: number, patch: Partial<TunnelConfig>): void =>
    setDraft((d) =>
      d ? { ...d, tunnels: d.tunnels.map((x, j) => (j === i ? { ...x, ...patch } : x)) } : d
    )
  const removeTunnel = (i: number): void =>
    setDraft((d) => (d ? { ...d, tunnels: d.tunnels.filter((_, j) => j !== i) } : d))
  const addTunnel = (): void =>
    setDraft((d) => (d ? { ...d, tunnels: [...d.tunnels, emptyTunnel()] } : d))
  const invalid = (draft.tunnels ?? []).some((x) => !x.host.trim())

  const save = async (): Promise<void> => {
    if (invalid) return
    setBusy(true)
    setStatus(null)
    try {
      const saved = await window.vigil.saveConfig(clean(draft))
      setDraft(saved)
      setSavedJson(JSON.stringify(saved))
      setStatus({ kind: 'ok', text: t('settings.saved') })
      onSaved()
    } catch (err) {
      setStatus({ kind: 'err', text: t('settings.saveFailed', { msg: String(err) }) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="settings">
      <div className="settings__bar">
        <label className="check">
          <input
            type="checkbox"
            checked={draft.notifyOnPowerEvents !== false}
            onChange={(e) => setDraft({ ...draft, notifyOnPowerEvents: e.target.checked })}
          />
          {t('settings.notifyPower')}
        </label>
        <label className="check" title={t('settings.daemonTip')}>
          <input
            type="checkbox"
            checked={agent}
            onChange={(e) => void toggleAgent(e.target.checked)}
          />
          {t('settings.daemon')}
        </label>
        <label className="check" title={t('settings.dockIconTip')}>
          <input
            type="checkbox"
            checked={draft.showDockIcon === true}
            onChange={(e) => setDraft({ ...draft, showDockIcon: e.target.checked })}
          />
          {t('settings.dockIcon')}
        </label>
        <select
          className="select select--sm"
          value={lang}
          title={t('settings.language')}
          onChange={(e) => {
            const next = e.target.value as Lang
            setLang(next)
            setDraft({ ...draft, language: next })
          }}
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
        <div className="settings__spacer" />
        {status && <span className={`savemsg savemsg--${status.kind}`}>{status.text}</span>}
        <button className="btn btn--sm import-open" onClick={() => void openImport()} disabled={busy}>
          <IconLink size={13} /> {t('settings.import')}
        </button>
        <button className="btn btn--sm" onClick={() => void load()} disabled={busy}>
          <IconRefresh size={13} /> {t('settings.reload')}
        </button>
        <button className="btn btn--sm" onClick={() => void window.vigil.revealConfig()}>
          <IconFolder size={13} /> {t('action.location')}
        </button>
        <button
          className="btn btn--sm btn--primary"
          onClick={() => void save()}
          disabled={busy || invalid || !dirty}
        >
          {busy ? t('settings.saving') : dirty ? t('settings.save') : t('settings.saved')}
        </button>
      </div>

      {importOpen && (
        <div className="importbox">
          <div className="importbox__head">
            <strong>{t('settings.importTitle')}</strong>
            {hosts === null ? (
              <span className="importbox__hint">{t('settings.importReading')}</span>
            ) : (
              <span className="importbox__hint">
                {t('settings.importCount', { total: hosts.length, n: importable.length })}
              </span>
            )}
            <div className="settings__spacer" />
            <button
              className="btn btn--sm"
              onClick={() =>
                setSelected(
                  selected.size === importable.length
                    ? new Set()
                    : new Set(importable.map((h) => h.alias))
                )
              }
            >
              {selected.size === importable.length && importable.length > 0
                ? t('settings.deselectAll')
                : t('settings.selectAll')}
            </button>
            <button className="btn btn--sm btn--primary" onClick={doImport} disabled={!selected.size}>
              {t('settings.importN', { n: selected.size || '' })}
            </button>
            <button className="btn btn--sm" onClick={() => setImportOpen(false)}>
              {t('settings.close')}
            </button>
          </div>
          <div className="importbox__list">
            {importable.length === 0 && (
              <div className="importbox__hint">{t('settings.noneImportable')}</div>
            )}
            {importable.map((h) => (
              <label key={h.alias} className="hostrow">
                <input
                  type="checkbox"
                  checked={selected.has(h.alias)}
                  onChange={(e) => {
                    const next = new Set(selected)
                    if (e.target.checked) next.add(h.alias)
                    else next.delete(h.alias)
                    setSelected(next)
                  }}
                />
                <span className="hostrow__alias">{h.alias}</span>
                <span className="hostrow__sub">
                  {h.user ? `${h.user}@` : ''}
                  {h.hostname}:{h.port}
                  {h.proxyJump.length ? `  ·  ${t('settings.via', { chain: h.proxyJump.join(' > ') })}` : ''}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {invalid && (
        <div className="notice notice--error">
          <IconAlert size={14} />
          <span>{t('settings.invalidHost')}</span>
        </div>
      )}

      <div className="settings__list">
        {draft.tunnels.map((tn, i) => (
          <TunnelForm
            key={i}
            t={t}
            tunnel={tn}
            onChange={(patch) => updateTunnel(i, patch)}
            onRemove={() => removeTunnel(i)}
          />
        ))}
        <button className="addcard" onClick={addTunnel}>
          {t('settings.newTunnel')}
        </button>
      </div>
    </main>
  )
}
