type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
}

const currentLevel: Level = (process.env.LOG_LEVEL as Level) ?? 'info'

function log(level: Level, message: string, extra?: Record<string, unknown> | null): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return

  const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '')
  const prefix    = `[${level.toUpperCase()}] [${timestamp}]`
  const base      = `${prefix} ${message}`

  if (!extra || Object.keys(extra).length === 0) {
    console.log(base)
  } else {
    console.log(`${base} ${JSON.stringify(extra)}`)
  }
}

export const logger = {
  debug: (message: string, extra?: Record<string, unknown> | null) => log('debug', message, extra),
  info:  (message: string, extra?: Record<string, unknown> | null) => log('info',  message, extra),
  warn:  (message: string, extra?: Record<string, unknown> | null) => log('warn',  message, extra),
  error: (message: string, extra?: Record<string, unknown> | null) => log('error', message, extra),
}
