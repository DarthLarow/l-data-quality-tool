import { randomUUID } from 'crypto'
import { getVoiAccount, getVoiZoneId } from '@/lib/scrapers-db'
import { uuidv5 } from '@/lib/uuid5'
import type { ScraperApiAdapter, PolygonBounds } from './scraper-adapter'
import { ApiUnexpectedResponseError } from './scraper-adapter'
import type { EntityType, ScraperEntity } from '@/types'

// ─── URLs ─────────────────────────────────────────────────────────────────────

const REFRESH_URL  = 'https://api.voiapp.io/v1/auth/session'
const VEHICLES_URL = 'https://api.voiapp.io/v2/rides/vehicles'
const ZONES_URL    = 'https://api.voiapp.io/v1/rides/zones'
const PASSES_URL   = 'https://api.voiapp.io/v2/payments/layout'

const MINOR_UNITS = 100

// ─── Headers ──────────────────────────────────────────────────────────────────

const BASE_HEADERS: Record<string, string> = {
  'Accept-Encoding':  'gzip',
  'brand':            'google',
  'Connection':       'Keep-Alive',
  'manufacturer':     'Google',
  'model':            'sdk_gphone64_x86_64',
  'User-Agent':       'okhttp/5.1.0',
  'X-App-Name':       'Rider',
  'X-App-Version':    '3.320.2',
  'X-Device-Id':      '7784e054303d6420',
  'X-Locale':         'en',
  'X-Locale-Country': 'en_US',
  'X-OS':             'Android',
  'X-OS-Version':     '36',
  'X-Timezone':       'GMT',
}

// Refresh headers differ slightly (newer app version, different device id)
const REFRESH_HEADERS: Record<string, string> = {
  'Content-Type':     'application/json; charset=UTF-8',
  'User-Agent':       'okhttp/5.1.0',
  'X-App-Name':       'Rider',
  'X-App-Version':    '3.329.1',
  'X-Device-Id':      '2b7a0d86e95ffc90',
  'brand':            'google',
  'manufacturer':     'Google',
  'model':            'sdk_gphone64_x86_64',
  'X-Locale':         'en',
  'X-Locale-Country': 'en_US',
  'X-OS':             'Android',
  'X-OS-Version':     '36',
  'X-Timezone':       'GMT',
}

// ─── Currency ─────────────────────────────────────────────────────────────────

const SYMBOL_TO_CODE: [string, string][] = [
  ['£', 'GBP'], ['€', 'EUR'], ['$', 'USD'], ['¥', 'JPY'],
  ['₩', 'KRW'], ['₺', 'TRY'], ['₽', 'RUB'], ['zł', 'PLN'],
]

function parseCurrency(priceStr: string): { amt: number | null; currency: string | null } {
  for (const [symbol, code] of SYMBOL_TO_CODE) {
    if (priceStr.startsWith(symbol)) {
      const num = parseFloat(priceStr.slice(symbol.length).trim().replace(',', '.'))
      return { amt: isNaN(num) ? null : num, currency: code }
    }
  }
  return { amt: null, currency: null }
}

// ─── JWT decode ───────────────────────────────────────────────────────────────

interface JwtPriceComponent {
  name:              string
  base_amount:       number
  units:             string
  discount_id:       string
  discounted_amount: number
  discount_reason:   string
}

interface JwtPayload {
  pid:              string
  plan_name:        string
  exp:              number
  price_components: JwtPriceComponent[]
}

function decodeJwt(token: string): JwtPayload {
  const part = (token.split('.')[1]) ?? ''
  const padded = part + '='.repeat((4 - (part.length % 4)) % 4)
  return JSON.parse(Buffer.from(padded, 'base64url').toString('utf8')) as JwtPayload
}

// ─── Account ──────────────────────────────────────────────────────────────────

interface VoiAccount {
  accessToken:  string | null
  refreshToken: string  // authenticationToken — long-lived (~540 days)
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class VoiScraperApiAdapter implements ScraperApiAdapter {
  appId = 'voi'
  readonly interPolygonDelayMs = 500
  private account: VoiAccount | null = null

  polygonStrategy(_entityType: EntityType): 'all' | 'center_only' {
    return 'center_only'
  }

  async fetchEntities(polygon: PolygonBounds, entityType: EntityType): Promise<ScraperEntity[]> {
    if (entityType === 'docked') return []

    const account = await this.getAccount()
    if (!account.accessToken) await this.refreshToken(account)

    const zoneId = await getVoiZoneId(polygon.polygonId)
    if (!zoneId) throw new Error(`No zone_id found for Voi polygon ${polygon.polygonId}`)

    switch (entityType) {
      case 'dockless': return this.fetchDockless(zoneId, account, polygon)
      case 'pricings': return this.fetchPricings(zoneId, account, polygon)
      case 'zones':    return this.fetchZones(zoneId, account, polygon)
    }
  }

  // ─── Entity fetchers ────────────────────────────────────────────────────────

  private async fetchDockless(
    zoneId: string,
    account: VoiAccount,
    polygon: PolygonBounds,
  ): Promise<ScraperEntity[]> {
    const url  = `${VEHICLES_URL}?zone_id=${zoneId}&include_suggestion=false`
    const data = await this.get(url, account)
    const groups = (data.data as Record<string, unknown> | null)?.vehicle_groups
    if (groups === null) {
      throw new ApiUnexpectedResponseError('dockless', polygon.polygonId, 'vehicles API returned null vehicle_groups')
    }
    if (!Array.isArray(groups)) return []

    const results: ScraperEntity[] = []
    for (const group of groups as Record<string, unknown>[]) {
      const groupType = String(group.group_type ?? '')
      if (!Array.isArray(group.vehicles)) continue
      for (const v of group.vehicles as Record<string, unknown>[]) {
        const loc = (v.location as Record<string, unknown> | null) ?? {}
        results.push({
          id:            String(v.id),
          name:          (v.short as string | null) ?? null,
          battery:       v.battery ?? null,
          location_lat:  loc.lat ?? null,
          location_lng:  loc.lng ?? null,
          zone_id:       v.zone_id != null ? String(v.zone_id) : null,
          category:      (v.category as string | null) ?? groupType,
          helmet_status: (v.helmetStatus as string | null) || null,
        })
      }
    }
    return results
  }

  private async fetchPricings(
    zoneId:  string,
    account: VoiAccount,
    polygon: PolygonBounds,
  ): Promise<ScraperEntity[]> {
    const results: ScraperEntity[] = []
    const city = polygon.city ?? null

    // Ride pricings: decode JWT price_token per vehicle group
    const vehiclesData = await this.get(
      `${VEHICLES_URL}?zone_id=${zoneId}&include_suggestion=false`,
      account,
    )
    const groups = (vehiclesData.data as Record<string, unknown> | null)?.vehicle_groups
    if (groups === null) {
      throw new ApiUnexpectedResponseError('pricings', polygon.polygonId, 'vehicles API returned null vehicle_groups')
    }
    if (Array.isArray(groups)) {
      for (const group of groups as Record<string, unknown>[]) {
        const token = group.price_token as string | undefined
        if (!token) continue
        const jwt = decodeJwt(token)
        const vehicleType    = String(group.group_type ?? '')
        const expirationDate = jwt.exp != null ? new Date(jwt.exp * 1000).toISOString() : null
        for (const comp of jwt.price_components ?? []) {
          results.push({
            id:                uuidv5(`${jwt.pid}_${vehicleType}_${comp.name}`),
            pricing_plan_name: jwt.plan_name ?? null,
            name:              comp.name ?? null,
            amt:               comp.base_amount != null ? comp.base_amount / MINOR_UNITS : null,
            currency:          comp.units ?? null,
            discount_id:       comp.discount_id || null,
            discounted_amount: comp.discounted_amount != null ? comp.discounted_amount / MINOR_UNITS : null,
            discounted_reason: comp.discount_reason || null,
            vehicle_type:      vehicleType,
            zone_id:           zoneId,
            zone_name:         city,
            expiration_date:   expirationDate,
          })
        }
      }
    }

    // Pass pricings: product-page endpoint
    const passData  = await this.get(`${PASSES_URL}/${zoneId}/product-page`, account)
    const available = (passData.data as Record<string, unknown> | null)?.available as Record<string, unknown> | null
    const categories = available?.categories
    if (Array.isArray(categories)) {
      for (const cat of categories as Record<string, unknown>[]) {
        const planName = (cat.name as string | null) ?? null
        if (!Array.isArray(cat.products)) continue
        for (const product of cat.products as Record<string, unknown>[]) {
          const { amt, currency } = parseCurrency(String(product.price ?? ''))

          const descriptions: string[] = []
          if (Array.isArray(product.bullets)) {
            for (const bullet of product.bullets as Record<string, unknown>[]) {
              if (!Array.isArray(bullet.text)) continue
              for (const t of bullet.text as Record<string, unknown>[]) {
                const c = String(t.content ?? '').trim()
                if (c) descriptions.push(c)
              }
            }
          }

          const bannerParts: string[] = []
          const bannerTexts = (product.banner as Record<string, unknown> | null)?.text
          if (Array.isArray(bannerTexts)) {
            for (const t of bannerTexts as Record<string, unknown>[]) {
              const c = String(t.content ?? '').trim()
              if (c) bannerParts.push(c)
            }
          }

          results.push({
            id:                String(product.id),
            pricing_plan_name: planName,
            name:              (product.title as string | null) ?? null,
            amt,
            currency,
            descriptions:      descriptions.length ? descriptions.join(' ') : null,
            discounted_reason: bannerParts.length ? bannerParts.join('') : null,
            zone_id:           zoneId,
            zone_name:         city,
          })
        }
      }
    }

    return results
  }

  private async fetchZones(
    zoneId:  string,
    account: VoiAccount,
    polygon: PolygonBounds,
  ): Promise<ScraperEntity[]> {
    const url  = `${ZONES_URL}/${zoneId}/areas?include_suggestion=false`
    const data = await this.get(url, account)
    const features = data.features
    if (features === null) {
      throw new ApiUnexpectedResponseError('zones', polygon.polygonId, 'zones API returned null features')
    }
    if (!Array.isArray(features)) return []

    const results: ScraperEntity[] = []
    for (const feature of features as Record<string, unknown>[]) {
      const props = (feature.properties as Record<string, unknown> | null) ?? {}
      const geom  = (feature.geometry  as Record<string, unknown> | null) ?? {}
      const rules = props.rules as Record<string, unknown> | null | undefined

      const rawTypes = Array.isArray(rules?.vehicle_types) ? rules!.vehicle_types as string[] : null
      const vehicleType = rawTypes?.map((v) => v.toLowerCase()).join(', ') ?? null

      results.push({
        id:               String(feature.id),
        zone_name:        (props.name as string | null) ?? null,
        area_type:        (props.area_type as string | null) ?? null,
        area_description: (props.description as string | null) ?? null,
        area_priority:    props.priority ?? null,
        area_rules:       rules != null ? JSON.stringify(rules) : null,
        area_zone_id:     props.zone_id != null ? String(props.zone_id) : null,
        vehicle_type:     vehicleType,
        geometry_type:    (geom.type as string | null) ?? null,
      })
    }
    return results
  }

  // ─── HTTP ───────────────────────────────────────────────────────────────────

  private async get(
    url:     string,
    account: VoiAccount,
    retry = true,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...BASE_HEADERS,
        'X-Access-Token': account.accessToken ?? '',
        'X-Request-Id':   randomUUID(),
      },
    })

    if (response.status === 401 && retry) {
      await this.refreshToken(account)
      return this.get(url, account, false)
    }

    return response.json() as Promise<Record<string, unknown>>
  }

  // ─── Auth ───────────────────────────────────────────────────────────────────

  private async getAccount(): Promise<VoiAccount> {
    if (this.account) return this.account
    const row = await getVoiAccount()
    if (!row) throw new Error('No active Voi account found in scrapers_db')
    this.account = { accessToken: row.access_token, refreshToken: row.refresh_token }
    return this.account
  }

  private async refreshToken(account: VoiAccount): Promise<void> {
    const response = await fetch(REFRESH_URL, {
      method: 'POST',
      headers: { ...REFRESH_HEADERS, 'X-Request-Id': randomUUID() },
      body:    JSON.stringify({ authenticationToken: account.refreshToken }),
    })
    if (!response.ok) throw new Error(`Voi token refresh failed: HTTP ${response.status}`)
    const data = await response.json() as Record<string, unknown>
    account.accessToken = data.accessToken as string
  }
}
