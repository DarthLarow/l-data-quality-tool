'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CheckType, Environment } from '@/types'
import type { AutoCheckConfig } from '@/generated/prisma/client'

interface ScraperInfo {
  appId:                string
  supportedEntityTypes: string[]
}

interface Props {
  scraper:        ScraperInfo
  existingConfig: AutoCheckConfig | null
  onSaved:        () => void
  onCancel:       () => void
}

export function AutoCheckConfigForm({ scraper, existingConfig, onSaved, onCancel }: Props) {
  const supportedTypes = scraper.supportedEntityTypes

  const [environment, setEnvironment]         = useState<Environment>(
    (existingConfig?.environment as Environment) ?? 'staging',
  )
  const [entityTypes, setEntityTypes]         = useState<string[]>(
    existingConfig?.entityTypes.length ? existingConfig.entityTypes : supportedTypes,
  )
  const [checks, setChecks]                   = useState<CheckType[]>(
    existingConfig?.checksEnabled.length
      ? (existingConfig.checksEnabled as CheckType[])
      : ['api_db', 'delta'],
  )
  const [polygonStrategy, setPolygonStrategy] = useState(
    existingConfig?.polygonStrategy ?? 'random',
  )
  const [aiSampleSize, setAiSampleSize]       = useState(existingConfig?.aiSampleSize ?? 5)
  const [isActive, setIsActive]               = useState(existingConfig?.isActive ?? true)
  const [saving, setSaving]                   = useState(false)

  function toggleEntity(et: string) {
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
      body:    JSON.stringify({
        appId: scraper.appId,
        environment,
        entityTypes,
        checksEnabled: checks,
        aiSampleSize,
        polygonStrategy,
        isActive,
      }),
    })
    setSaving(false)
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border bg-muted/30 p-4">
      <div className="grid grid-cols-2 gap-3">
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
        <div className="space-y-1.5">
          <Label>Polygon Strategy</Label>
          <Select value={polygonStrategy} onValueChange={setPolygonStrategy}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="random">Random polygon</SelectItem>
              <SelectItem value="by_city_all">By city — all</SelectItem>
              <SelectItem value="by_city_random">By city — random</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Entity Types</Label>
        <div className="flex flex-wrap gap-4">
          {supportedTypes.map((et) => (
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

      <div className="flex items-end gap-6">
        <div className="space-y-1.5">
          <Label>AI Sample Size</Label>
          <Input
            type="number" min={0} max={20}
            value={aiSampleSize}
            onChange={(e) => setAiSampleSize(Number(e.target.value))}
            className="w-24 font-mono"
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-sm pb-2">
          <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(Boolean(v))} />
          Active
        </label>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
