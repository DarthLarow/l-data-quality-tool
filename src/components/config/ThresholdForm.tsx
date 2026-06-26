'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ENTITY_TYPES } from '@/types'
import type { EntityType } from '@/types'

interface Props {
  scrapers: { appId: string; name: string }[]
  onSaved:  () => void
}

export function ThresholdForm({ scrapers, onSaved }: Props) {
  const [appId, setAppId]         = useState('')
  const [entityType, setEntityType] = useState<EntityType>('dockless')
  const [warning, setWarning]     = useState('20')
  const [critical, setCritical]   = useState('50')
  const [saving, setSaving]       = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/config/thresholds', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        appId,
        entityType,
        warningThresholdPct:  Number(warning),
        criticalThresholdPct: Number(critical),
      }),
    })
    setSaving(false)
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Scraper</Label>
          <Select value={appId} onValueChange={setAppId}>
            <SelectTrigger><SelectValue placeholder="Select scraper" /></SelectTrigger>
            <SelectContent>
              {scrapers.map((s) => (
                <SelectItem key={s.appId} value={s.appId}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Entity Type</Label>
          <Select value={entityType} onValueChange={(v) => setEntityType(v as EntityType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ENTITY_TYPES.map((et) => (
                <SelectItem key={et} value={et}>{et}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Warning <span className="text-muted-foreground">(%)</span></Label>
          <Input
            type="number" min={1} max={100}
            value={warning} onChange={(e) => setWarning(e.target.value)}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Critical <span className="text-muted-foreground">(%)</span></Label>
          <Input
            type="number" min={1} max={100}
            value={critical} onChange={(e) => setCritical(e.target.value)}
            className="font-mono"
          />
        </div>
      </div>
      <Button type="submit" disabled={!appId || saving}>
        {saving ? 'Saving…' : 'Save Threshold'}
      </Button>
    </form>
  )
}
