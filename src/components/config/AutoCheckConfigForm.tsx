'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ENTITY_TYPES } from '@/types'
import type { EntityType, CheckType, Environment } from '@/types'

interface Props {
  scrapers: { appId: string; name: string }[]
  onSaved:  () => void
}

export function AutoCheckConfigForm({ scrapers, onSaved }: Props) {
  const [appId, setAppId]             = useState('')
  const [environment, setEnvironment] = useState<Environment>('staging')
  const [entityTypes, setEntityTypes] = useState<EntityType[]>(['dockless'])
  const [checks, setChecks]           = useState<CheckType[]>(['api_db', 'delta'])
  const [aiSampleSize, setAiSampleSize] = useState(5)
  const [polygonStrategy, setPolygonStrategy] = useState('random')
  const [isActive, setIsActive]       = useState(true)
  const [saving, setSaving]           = useState(false)

  function toggleEntity(et: EntityType) {
    setEntityTypes((p) => p.includes(et) ? p.filter((x) => x !== et) : [...p, et])
  }
  function toggleCheck(ct: CheckType) {
    setChecks((p) => p.includes(ct) ? p.filter((x) => x !== ct) : [...p, ct])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/config/auto-check', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ appId, environment, entityTypes, checksEnabled: checks, aiSampleSize, polygonStrategy, isActive }),
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
          <Label>Environment</Label>
          <Select value={environment} onValueChange={(v) => setEnvironment(v as Environment)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="staging">Staging</SelectItem>
              <SelectItem value="production">Production</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Entity Types</Label>
        <div className="flex flex-wrap gap-4">
          {ENTITY_TYPES.map((et) => (
            <label key={et} className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox checked={entityTypes.includes(et)} onCheckedChange={() => toggleEntity(et)} />
              {et}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Check Types</Label>
        <div className="flex gap-5">
          {(['api_db', 'delta'] as CheckType[]).map((ct) => (
            <label key={ct} className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox checked={checks.includes(ct)} onCheckedChange={() => toggleCheck(ct)} />
              {ct === 'api_db' ? 'API→DB' : 'Delta'}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Polygon Strategy</Label>
        <Select value={polygonStrategy} onValueChange={setPolygonStrategy}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="random">Random polygon</SelectItem>
            <SelectItem value="by_city_all">By city — all polygons</SelectItem>
            <SelectItem value="by_city_random">By city — random polygon</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-end gap-6">
        <div className="space-y-1.5">
          <Label>AI Sample Size</Label>
          <Input
            type="number" min={0} max={20}
            value={aiSampleSize} onChange={(e) => setAiSampleSize(Number(e.target.value))}
            className="w-24 font-mono"
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-sm pb-2">
          <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(Boolean(v))} />
          Active
        </label>
      </div>

      <Button type="submit" disabled={!appId || saving}>
        {saving ? 'Saving…' : 'Save Config'}
      </Button>
    </form>
  )
}
