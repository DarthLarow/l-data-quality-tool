'use client'

import { createContext, useContext, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

export type ThemeColors = {
  /* status */
  green:   string
  amber:   string
  red:     string
  blue:    string
  greenBg: string
  amberBg: string
  redBg:   string
  blueBg:  string
  /* backgrounds */
  bg1: string  /* app shell, sticky nav */
  bg2: string  /* content area, input bg */
  bg3: string  /* cards, nav pills */
  bg4: string  /* inline panels, section headers */
  bg5: string  /* sidebar */
  /* text hierarchy */
  text1: string  /* primary */
  text2: string  /* secondary */
  text3: string  /* entity names, card body */
  text4: string  /* field labels */
  text5: string  /* muted mono */
  text6: string  /* section sub-labels */
  text7: string  /* dim */
  text8: string  /* separators, appId */
  /* borders */
  border1: string  /* page / sidebar */
  border2: string  /* card */
  border3: string  /* input / button */
  border4: string  /* strong */
  /* primary button */
  btnBg: string
  btnFg: string
  /* logo mark */
  logoBg: string
  logoFg: string
}

const DARK: ThemeColors = {
  green:   '#3fb950',
  amber:   '#d29922',
  red:     '#f85149',
  blue:    '#4493f8',
  greenBg: 'rgba(63,185,80,0.12)',
  amberBg: 'rgba(210,153,34,0.12)',
  redBg:   'rgba(248,81,73,0.08)',
  blueBg:  'rgba(68,147,248,0.12)',
  bg1:     '#0a0a0a',
  bg2:     '#080808',
  bg3:     '#0f0f0f',
  bg4:     '#0d0d0d',
  bg5:     '#0c0c0c',
  text1:   '#ededed',
  text2:   '#cfcfcf',
  text3:   '#bdbdbd',
  text4:   '#9a9a9a',
  text5:   '#8a8a8a',
  text6:   '#7a7a7a',
  text7:   '#6b6b6b',
  text8:   '#5e5e5e',
  border1: 'rgba(255,255,255,0.07)',
  border2: 'rgba(255,255,255,0.08)',
  border3: 'rgba(255,255,255,0.1)',
  border4: 'rgba(255,255,255,0.13)',
  btnBg:   '#ededed',
  btnFg:   '#0a0a0a',
  logoBg:  '#ededed',
  logoFg:  '#0a0a0a',
}

const LIGHT: ThemeColors = {
  green:   '#1a7f37',
  amber:   '#9a6700',
  red:     '#cf222e',
  blue:    '#0969da',
  greenBg: 'rgba(26,127,55,0.12)',
  amberBg: 'rgba(154,103,0,0.12)',
  redBg:   'rgba(207,34,46,0.08)',
  blueBg:  'rgba(9,105,218,0.12)',
  bg1:     '#ffffff',
  bg2:     '#f4f4f5',
  bg3:     '#ffffff',
  bg4:     '#fafafa',
  bg5:     '#fafafa',
  text1:   '#18181b',
  text2:   '#27272a',
  text3:   '#3f3f46',
  text4:   '#71717a',
  text5:   '#8e8e93',
  text6:   '#71717a',
  text7:   '#a1a1aa',
  text8:   '#b0b0b6',
  border1: 'rgba(0,0,0,0.07)',
  border2: 'rgba(0,0,0,0.08)',
  border3: 'rgba(0,0,0,0.1)',
  border4: 'rgba(0,0,0,0.13)',
  btnBg:   '#18181b',
  btnFg:   '#ffffff',
  logoBg:  '#18181b',
  logoFg:  '#ffffff',
}

interface ThemeContextValue {
  theme:    Theme
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme:    'dark',
  setTheme: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark')

  useEffect(() => {
    const stored = localStorage.getItem('dq-theme') as Theme | null
    if (stored === 'light' || stored === 'dark') setThemeState(stored)
  }, [])

  function setTheme(t: Theme) {
    setThemeState(t)
    localStorage.setItem('dq-theme', t)
    const html = document.documentElement
    html.classList.remove('dark', 'light')
    html.classList.add(t)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}

export function useThemeColors(): ThemeColors {
  const { theme } = useTheme()
  return theme === 'light' ? LIGHT : DARK
}

/** Inline script injected into <head> — runs before first paint to prevent FOUC. */
export const THEME_INIT_SCRIPT = `(function(){
  try {
    var t = localStorage.getItem('dq-theme');
    var html = document.documentElement;
    html.classList.remove('dark','light');
    html.classList.add(t === 'light' ? 'light' : 'dark');
  } catch(e) {}
})();`
