'use client'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'
import type { AiComparison } from '@/generated/prisma/client'

const VERDICTS = [
  { key: 'Same',         color: '#22c55e', label: 'Same' },
  { key: 'SomewhatSame', color: '#f59e0b', label: 'Somewhat Same' },
  { key: 'Different',    color: '#ef4444', label: 'Different' },
] as const

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
        <BarChart
          data={data}
          barCategoryGap="30%"
          barGap={3}
          margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
        >
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.06} />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10 }} width={28} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: 'currentColor', fillOpacity: 0.04 }}
            contentStyle={{ fontSize: 12 }}
          />
          <Legend
            iconType="square"
            iconSize={10}
            wrapperStyle={{ fontSize: 11 }}
            formatter={(value) => VERDICTS.find((v) => v.key === value)?.label ?? value}
          />
          {VERDICTS.map(({ key, color }) => (
            <Bar key={key} dataKey={key} fill={color} maxBarSize={22} radius={[2, 2, 0, 0]}>
              {data.map((_, i) => <Cell key={i} fill={color} />)}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
