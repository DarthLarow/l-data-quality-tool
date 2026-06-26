'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { AiComparison } from '@/generated/prisma/client'

interface Props {
  aiComparisons: AiComparison[]
  sessionDates:  { id: string; date: string }[]
}

export function QualityChart({ aiComparisons, sessionDates }: Props) {
  const data = sessionDates.map(({ id, date }) => {
    const comps = aiComparisons.filter((c) => c.checkSessionId === id)
    return {
      date,
      Same:         comps.filter((c) => c.verdict === 'Same').length,
      SomewhatSame: comps.filter((c) => c.verdict === 'SomewhatSame').length,
      Different:    comps.filter((c) => c.verdict === 'Different').length,
    }
  })

  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">AI Quality</p>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data}>
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} width={30} />
          <Tooltip />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Same"         fill="#10b981" stackId="a" />
          <Bar dataKey="SomewhatSame" fill="#f59e0b" stackId="a" />
          <Bar dataKey="Different"    fill="#ef4444" stackId="a" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
