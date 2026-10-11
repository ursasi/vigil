import { createContext, useContext, useEffect, useState, type JSX, type ReactNode } from 'react'
import { resolveLang, t as translate, type Lang } from '../../shared/i18n'

interface LangCtx {
  lang: Lang
  t: (key: string, params?: Record<string, string | number>) => string
  setLang: (l: Lang) => void
}

const Ctx = createContext<LangCtx>({
  lang: 'en',
  t: (key) => key,
  setLang: () => {}
})

export function LangProvider({ children }: { children: ReactNode }): JSX.Element {
  const [lang, setLang] = useState<Lang>(() =>
    resolveLang(undefined, navigator.language ?? 'en')
  )

  useEffect(() => {
    // Prefer the saved preference, fall back to the system locale.
    void window.vigil
      .getConfig()
      .then((c) => setLang(resolveLang(c.language, navigator.language ?? 'en')))
      .catch(() => {})
  }, [])

  const t = (key: string, params?: Record<string, string | number>): string =>
    translate(lang, key, params)

  return <Ctx.Provider value={{ lang, t, setLang }}>{children}</Ctx.Provider>
}

export function useI18n(): LangCtx {
  return useContext(Ctx)
}
