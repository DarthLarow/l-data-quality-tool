import { getHumanForestAccount, getHumanForestZoneContext } from '@/lib/scrapers-db'
import { uuidv5 } from '@/lib/uuid5'
import type { ScraperApiAdapter, PolygonBounds } from './scraper-adapter'
import { ApiUnexpectedResponseError } from './scraper-adapter'
import type { EntityType, ScraperEntity } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL      = 'https://api.forest.me'
const LOGIN_URL     = `${BASE_URL}/v2/auth/login`
const REFRESH_URL   = `${BASE_URL}/v2/auth/refresh-token`
const VEHICLES_URL  = `${BASE_URL}/v1/vehicles`
const VEH_TYPES_URL = `${BASE_URL}/v1/vehicles/types`
const BUNDLES_URL   = `${BASE_URL}/v1/minutes-view/subscriptions-and-bundles`
const ZONES_URL     = `${BASE_URL}/v1/territories`

const USER_AGENT =
  'Forest/11.5.0 (785) (sdk_gphone64_x86_64; ranchu; 74:42:9A:47:93:C7:7A:FB:' +
  'EA:2B:79:8E:03:BC:2C:24:EF:30:84:EE:C8:0F:A8:C0:A5:40:A4:60:54:25:CB:65)'

const BASE_HEADERS = {
  'accept':          'application/json',
  'accept-encoding': 'gzip',
  'user-agent':      USER_AGENT,
}

// ─── Internal account state ───────────────────────────────────────────────────

interface HumanForestAccount {
  email:        string
  password:     string
  accessToken:  string | null
  refreshToken: string
}

interface BoundBox {
  south: number
  west:  number
  north: number
  east:  number
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class HumanForestScraperApiAdapter implements ScraperApiAdapter {
  appId = 'human_forest'
  readonly interPolygonDelayMs = 1000
  private account: HumanForestAccount | null = null

  polygonStrategy(entityType: EntityType): 'all' | 'center_only' {
    return entityType === 'dockless' ? 'all' : 'center_only'
  }

  async fetchEntities(polygon: PolygonBounds, entityType: EntityType): Promise<ScraperEntity[]> {
    if (entityType === 'docked') return []

    const account = await this.getAccount()
    if (!account.accessToken) await this.refreshToken(account)

    switch (entityType) {
      case 'dockless': return this.fetchDockless(polygon, account)
      case 'pricings': return this.fetchPricings(polygon, account)
      case 'zones':    return this.fetchZones(polygon, account)
    }
  }

  // ─── Account loading ────────────────────────────────────────────────────────

  private async getAccount(): Promise<HumanForestAccount> {
    if (this.account) return this.account
    const row = await getHumanForestAccount()
    if (!row) throw new Error('No active Human Forest account found in scrapers_db')
    this.account = {
      email:        row.email,
      password:     row.password,
      accessToken:  row.access_token,
      refreshToken: row.refresh_token,
    }
    return this.account
  }

  // ─── Auth ───────────────────────────────────────────────────────────────────

  private async refreshToken(account: HumanForestAccount): Promise<void> {
    const body = new URLSearchParams({
      refreshToken: account.refreshToken,
      grantType:    'refresh_token',
    })
    const res = await fetch(REFRESH_URL, {
      method:  'POST',
      headers: { ...BASE_HEADERS, 'content-type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    })
    if (!res.ok) {
      // 400/401 = refresh token expired → fall back to full sign-in
      if (res.status === 400 || res.status === 401) {
        await this.signIn(account)
        return
      }
      throw new Error(`Human Forest refresh-token failed: HTTP ${res.status}`)
    }
    const data = (await res.json() as Record<string, unknown>)
    const tokens = data['data'] as Record<string, unknown>
    account.accessToken  = tokens['accessToken']  as string
    account.refreshToken = tokens['refreshToken'] as string
  }

  private async signIn(account: HumanForestAccount): Promise<void> {
    const res = await fetch(LOGIN_URL, {
      method:  'POST',
      headers: { ...BASE_HEADERS, 'content-type': 'application/json' },
      body:    JSON.stringify({ email: account.email, password: account.password }),
    })
    if (!res.ok) throw new Error(`Human Forest sign-in failed: HTTP ${res.status}`)
    const data = (await res.json() as Record<string, unknown>)
    const tokens = data['data'] as Record<string, unknown>
    account.accessToken  = tokens['accessToken']  as string
    account.refreshToken = tokens['refreshToken'] as string
  }

  // ─── Authenticated GET helper ────────────────────────────────────────────────

  private async get(
    url: string,
    account: HumanForestAccount,
    retry = true,
  ): Promise<unknown> {
    const res = await fetch(url, {
      method:  'GET',
      headers: { ...BASE_HEADERS, authorization: `Bearer ${account.accessToken ?? ''}` },
    })
    if (res.status === 401 && retry) {
      await this.refreshToken(account)
      return this.get(url, account, false)
    }
    return res.json()
  }

  // ─── Entity fetchers (stubs — filled in Tasks 3–5) ──────────────────────────

  private async fetchDockless(polygon: PolygonBounds, account: HumanForestAccount): Promise<ScraperEntity[]> {
    const bb = this.parseBoundBox(polygon)
    const params = this.bboxParams(bb)

    // Step 1: vehicle types → build id→title map
    const vtData = await this.get(`${VEH_TYPES_URL}?${params}`, account) as Record<string, unknown>
    if (vtData['status'] !== 'OK' || !Array.isArray(vtData['data'])) {
      throw new ApiUnexpectedResponseError(
        'dockless', polygon.polygonId,
        `vehicle types returned unexpected structure: status=${vtData['status']}`,
      )
    }
    const vehicleTypeMap = new Map<string, string>(
      (vtData['data'] as Array<{ vehicleTypeId: number; title: string }>)
        .map((vt) => [String(vt.vehicleTypeId), vt.title]),
    )

    // Step 2: vehicles
    const vehicles = await this.get(`${VEHICLES_URL}?${params}`, account)
    if (!Array.isArray(vehicles)) {
      throw new ApiUnexpectedResponseError(
        'dockless', polygon.polygonId,
        'vehicles endpoint returned non-array response',
      )
    }

    return (vehicles as Array<Record<string, unknown>>).map((v) => ({
      ...v,
      id:       String(v['id']),
      battery:  v['fuelLevel'] ?? null,
      lat:      v['lat']       ?? null,
      lon:      v['lon']       ?? null,
      category: vehicleTypeMap.get(String(v['vehicleTypeId'] ?? '')) ?? null,
    }))
  }

  private readonly CURRENCY_MAP: Record<string, string> = { '£': 'GBP', '$': 'USD', '€': 'EUR' }

  private parseCurrency(priceStr: string): string | null {
    const sym = priceStr.replace(/[^£$€]/g, '')
    return this.CURRENCY_MAP[sym] ?? null
  }

  private async fetchPricings(polygon: PolygonBounds, account: HumanForestAccount): Promise<ScraperEntity[]> {
    const results: ScraperEntity[] = []

    // Step 1: bundles — endpoint requires version=3 to include Forest Flex subscription
    const bundleData = await this.get(`${BUNDLES_URL}?version=3`, account) as Record<string, unknown>
    if (bundleData['success'] !== true) {
      throw new ApiUnexpectedResponseError(
        'pricings', polygon.polygonId,
        'bundles endpoint returned success: false',
      )
    }
    const items = ((bundleData['data'] as Record<string, unknown>)['items'] as Array<Record<string, unknown>>) ?? []
    for (const item of items) {
      // creditsPerRide takes priority over credits; commas stripped to match Python parser
      const nameSource = (item['creditsPerRide'] ?? item['credits']) as string | null | undefined
      const name = nameSource ? nameSource.toLowerCase().replace(/ /g, '_').replace(/,/g, '') : null
      results.push({
        id:                    item['id'] as string,
        pricingPlanName:       item['title'] as string,
        name,
        amt:                   item['priceValue'] as number,
        currency:              this.parseCurrency(item['price'] as string),
        description:           item['description'] ?? null,
        expirationTimeSeconds: (item['metadata'] as Record<string, unknown> | null)?.['expirationTimeSeconds'] ?? null,
      })
    }

    // Step 2: vehicle type pricing (same endpoint as dockless step 1)
    const bb = this.parseBoundBox(polygon)
    const vtData = await this.get(`${VEH_TYPES_URL}?${this.bboxParams(bb)}`, account) as Record<string, unknown>
    if (vtData['status'] !== 'OK' || !Array.isArray(vtData['data'])) {
      throw new ApiUnexpectedResponseError(
        'pricings', polygon.polygonId,
        `vehicle types returned unexpected structure during pricing: status=${vtData['status']}`,
      )
    }

    const UNLOCK_DESCRIPTION =
      'Pay as you go rides only. ' +
      'Pay £1 to unlock, then choose a bike with 1,2,5,10 or 30 minutes included. ' +
      'Minute allocation is based on ebike availability, location and time and is subject to T&Cs. ' +
      'After the minutes included are used, you\'ll be charged per minute.'

    type VehicleType = { vehicleTypeId: number; title: string; unlockFee: string; pricingTime: string; pricingParking: string; pricing: { pricePerMinute: number; pricePerParkingMinute: number; unlockFee: number; currencyCode: string } }
    const rows: Array<[string, string, number]> = [] // [name, rawStr, amt]
    for (const vt of vtData['data'] as VehicleType[]) {
      rows.push(['unlock',     vt.unlockFee,      vt.pricing.unlockFee])
      rows.push(['per_minute', vt.pricingTime,    vt.pricing.pricePerMinute])
      rows.push(['parking',    vt.pricingParking, vt.pricing.pricePerParkingMinute])

      for (const [name, rawStr, amt] of rows) {
        const currency = this.parseCurrency(rawStr)
        if (currency === null) continue // no currency symbol → skip (Free / N/A)
        results.push({
          id:          uuidv5(`human_forest_${vt.vehicleTypeId}_${name}`),
          name,
          amt,
          currency,
          vehicleType: vt.title,
          descriptions: name === 'unlock' ? UNLOCK_DESCRIPTION : null,
        })
      }
      rows.length = 0
    }

    return results
  }

  private async fetchZones(polygon: PolygonBounds, account: HumanForestAccount): Promise<ScraperEntity[]> {
    const ctx = await getHumanForestZoneContext(polygon.polygonId)
    if (!ctx) {
      throw new Error(`No Human Forest zone context found for polygon ${polygon.polygonId}`)
    }
    const typesParams = ctx.types.map((t) => `types=${t}`).join('&')
    const url = `${ZONES_URL}?location_id=${ctx.location_id}&${typesParams}`
    const data = await this.get(url, account)

    if (!Array.isArray(data)) {
      throw new ApiUnexpectedResponseError(
        'zones', polygon.polygonId,
        'territories endpoint returned non-array response',
      )
    }

    const results: ScraperEntity[] = []

    for (const entry of data as Array<{ type: number; territory: { features: unknown[] } }>) {
      const features = entry.territory?.features ?? []
      features.forEach((feature, idx) => {
        const f = feature as Record<string, unknown>
        const props = (f['properties'] as Record<string, unknown>) ?? {}
        const geom  = (f['geometry']  as Record<string, unknown>) ?? {}
        const name  = (props['name'] as string) ?? null
        const idSrc = name ?? `${entry.type}_${idx}`

        const nameParts = name ? name.split(' - ', 2) : []

        results.push({
          id:                  uuidv5(idSrc),
          zoneName:            name,
          zoneId:              uuidv5(idSrc),
          type:                f['type'] ?? null,
          geometryType:        geom['type']        ?? null,
          geometryCoordinates: geom['coordinates'] ?? null,
          areaType:            nameParts[0] ?? null,
          areaDescription:     name,
          areaPriority:        props['type'] != null ? (props['type'] as number) : null,
          areaZoneId:          props['type'] != null ? String(props['type']) : null,
          areaRules:           Object.keys(props).length > 0 ? JSON.stringify(props) : null,
        })
      })
    }

    return results
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  protected parseBoundBox(polygon: PolygonBounds): BoundBox {
    const bb = polygon.boundBox as Record<string, unknown>
    if (typeof bb?.south !== 'number' || typeof bb?.west !== 'number' ||
        typeof bb?.north !== 'number' || typeof bb?.east !== 'number') {
      throw new Error(`Polygon ${polygon.polygonId} has no valid boundBox for Human Forest API`)
    }
    return { south: bb.south, west: bb.west, north: bb.north, east: bb.east }
  }

  protected bboxParams(bb: BoundBox): string {
    return `lat1=${bb.south}&lon1=${bb.west}&lat2=${bb.north}&lon2=${bb.east}`
  }
}
