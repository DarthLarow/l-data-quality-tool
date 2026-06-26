'use client'
import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { EntityCheckSummary } from '@/generated/prisma/client'

const ENTITY_COLORS = {
  dockless: '#3b82f6',
  docked:   '#10b981',
  pricings: '#f59e0b',
  zones:    '#8b5cf6',
} as const

type EntityKey = keyof typeof ENTITY_COLORS

interface Props {
  summaries: EntityCheckSummary[]
  dates:     string[]
}

export function CompletenessChart({ summaries, dates }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const data = dates.map((date) => {
    const entry: Record<string, unknown> = { date }
    for (const et of Object.keys(ENTITY_COLORS) as EntityKey[]) {
      const s = summaries.find((x) => x.entityType === et)
      if (s) entry[et] = s.totalNotFoundInDb
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
      <p className="mb-1 text-xs font-semibold text-muted-foreground">Missing in DB</p>
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
