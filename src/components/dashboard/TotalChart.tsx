'use client'
import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { SessionDeltaCheck } from '@/generated/prisma/client'

const ENTITY_COLORS = {
  dockless: '#3b82f6',
  docked:   '#10b981',
  pricings: '#f59e0b',
  zones:    '#8b5cf6',
} as const

type EntityKey = keyof typeof ENTITY_COLORS

interface DataPoint {
  date:      string
  dockless?: number
  docked?:   number
  pricings?: number
  zones?:    number
}

interface Props {
  deltaChecks: SessionDeltaCheck[]
  dates:       string[]
}

export function TotalChart({ deltaChecks, dates }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const data: DataPoint[] = dates.map((date) => {
    const entry: DataPoint = { date }
    for (const et of Object.keys(ENTITY_COLORS) as EntityKey[]) {
      const check = deltaChecks.find((d) => d.entityType === et)
      if (check) entry[et] = check.currentCount
    }
    return entry
  })

  function toggle(key: string) {
    setHidden((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">Total (DB counts)</p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data}>
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} width={40} />
          <Tooltip />
          <Legend
            iconSize={10}
            wrapperStyle={{ fontSize: 11, cursor: 'pointer' }}
            onClick={(e) => toggle(String(e.dataKey))}
          />
          {(Object.entries(ENTITY_COLORS) as [EntityKey, string][]).map(([et, color]) => (
            <Line
              key={et}
              type="monotone"
              dataKey={et}
              stroke={color}
              hide={hidden.has(et)}
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
