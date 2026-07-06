import { randomUUID } from 'crypto'
import { getLyftAccount, getLyftCityContext, type LyftCityContextRow } from '@/lib/scrapers-db'
import { TtlCache } from './ttl-cache'
import { uuidv5 } from '@/lib/uuid5'
import type { ScraperApiAdapter, PolygonBounds } from './scraper-adapter'
import { ApiUnexpectedResponseError } from './scraper-adapter'
import type { EntityType, ScraperEntity } from '@/types'

// ─── URLs ─────────────────────────────────────────────────────────────────────

const REFRESH_URL   = 'https://api.lyft.com/oauth/token'
const DOCKLESS_URL  = 'https://api.lyft.com/v1/last-mile/map-items'
const INVENTORY_URL = 'https://api.lyft.com/v1/lbsbff/map/inventory'
const PRICING_URL   = 'https://api.lyft.com/v1/lbsbff/panel/pre-ride-station'

const STYLE_SHEET_NAME      = 'lbsbff-2026.9-0f9fcf91'
const STATION_MAP_ITEM_TYPE = 1
const PRICING_DETAILS_KEY   = 'StationPricingDetailsComponent_0'
const MAX_PRICING_STATIONS  = 5

// ─── Auth constants ───────────────────────────────────────────────────────────

const BASIC_AUTH = 'ZVNhdDctaXU5ZG9NOlp0dkxEejBuMS1rSlZ3a0l2eEM0aVNKMHlNdkp5ZFBx'

// ─── Headers ──────────────────────────────────────────────────────────────────

const BASE_HEADERS: Record<string, string> = {
  'accept':              'application/json',
  'content-type':        'application/json',
  'user-agent':          'lyft:android:16:2026.10.31.1774041931',
  'x-distance-unit':     'miles',
  'x-locale-language':   'en',
  'x-locale-region':     'US',
  'x-lyft-geo-region':   'unknown',
}

const DOCKLESS_CONTENT_TYPE = 'application/json;messageType=pb.api.endpoints.v1.last_mile.ReadMapItemsRequest; charset=utf-8'
const INVENTORY_CONTENT_TYPE = 'application/json;messageType=pb.api.endpoints.v1.lbs_bff.ReadMapInventoryRequest; charset=utf-8'
const PRICING_CONTENT_TYPE = 'application/json;messageType=pb.api.endpoints.v1.lbs_bff.ReadPreRideStationPanelRequest; charset=utf-8'

// ─── Pricing helpers ──────────────────────────────────────────────────────────

const CURRENCY_MAP: Record<string, string> = { '$': 'USD', '£': 'GBP', '€': 'EUR' }
const AMOUNT_RE   = /[$£€](\d+\.?\d*)/
const CURRENCY_RE = /[$£€]/

const PRICING_PLAN_NAMES: Record<string, string> = {
  unlock:                 'Unlock Fee',
  per_minute:             'Per Minute',
  per_minute_reservation: 'Per Minute Reservation',
  parking_fee:            'Parking Fee',
  flat:                   'Flat Fee',
}

function parseAmount(text: string): number | null {
  const m = AMOUNT_RE.exec(text)
  if (m) return parseFloat(m[1]!)
  if (/free/i.test(text)) return 0
  return null
}

function parseCurrencySymbol(text: string): string | null {
  const m = CURRENCY_RE.exec(text)
  return m ? (CURRENCY_MAP[m[0]] ?? null) : null
}

function inferName(text: string): string {
  const t = text.toLowerCase()
  if (t.includes('to unlock'))              return 'unlock'
  if (t.includes('per minute to reserve'))  return 'per_minute_reservation'
  if (t.includes('per minute'))             return 'per_minute'
  if (t.includes('park'))                   return 'parking_fee'
  return 'flat'
}

// ─── Inventory parsing (shared by docked + pricings) ─────────────────────────

interface InventoryStation {
  shortId:   string
  fullId:    string
  lat:       number
  lng:       number
  bikesAvail: number
  docksAvail: number | null
  isOffline: boolean
  isValet:   boolean
}

function parseInventory(
  data: Record<string, unknown>,
  cityCode: string,
): InventoryStation[] {
  const inventoryJson = data.map_inventory_json as string | null
  if (!inventoryJson) return []
  const geojson = JSON.parse(inventoryJson) as Record<string, unknown>
  const features = geojson.features
  if (!Array.isArray(features)) return []

  const stations: InventoryStation[] = []
  for (const feature of features as Record<string, unknown>[]) {
    const props = (feature.properties as Record<string, unknown>) ?? {}
    if (props.map_item_type !== STATION_MAP_ITEM_TYPE) continue
    const coords = ((feature.geometry as Record<string, unknown>)?.coordinates as [number, number]) ?? [null, null]
    const fullId  = String(props.map_item_id ?? '')
    // short_id = trailing part after last '_'
    const shortId = fullId.includes('_') ? fullId.split('_').pop()! : fullId
    // Reconstruct full compound ID with city prefix if it doesn't already have one
    const resolvedFullId = fullId.includes('_') ? fullId : `motivate_${cityCode}_${fullId}`

    stations.push({
      shortId,
      fullId: resolvedFullId,
      lng:        coords[0] ?? 0,
      lat:        coords[1] ?? 0,
      bikesAvail: ((props.bikes_available as number) ?? 0)
                + ((props.ebikes_available as number) ?? 0)
                + ((props.nextgen_ebikes_available as number) ?? 0),
      docksAvail: (props.docks_available as number | null) ?? null,
      isOffline:  Boolean(props.is_offline),
      isValet:    Boolean(props.is_valet),
    })
  }
  return stations
}

// ─── Account ──────────────────────────────────────────────────────────────────

interface LyftAccount {
  accessToken:  string | null
  refreshToken: string
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class LyftScraperApiAdapter implements ScraperApiAdapter {
  appId = 'lyft'
  readonly interPolygonDelayMs = 500
  private account: LyftAccount | null = null
  // city_code/lat/lon are per-city; cache by city to avoid a per-tile DB lookup
  // (dockless uses the 'all' strategy → one call per tile without the cache).
  private cityContextCache = new TtlCache<LyftCityContextRow | null>()

  private getCityContext(polygon: PolygonBounds): Promise<LyftCityContextRow | null> {
    const cacheKey = polygon.city ?? polygon.polygonId
    return this.cityContextCache.getOrLoad(cacheKey, () => getLyftCityContext(polygon.polygonId))
  }

  polygonStrategy(entityType: EntityType): 'all' | 'center_only' {
    return entityType === 'dockless' ? 'all' : 'center_only'
  }

  collectionNote(entityType: EntityType): string | null {
    if (entityType === 'pricings') {
      return `Pricings gathered from up to ${MAX_PRICING_STATIONS} stations per polygon (MAX_PRICING_STATIONS cap) — coverage may be partial`
    }
    return null
  }

  async fetchEntities(polygon: PolygonBounds, entityType: EntityType): Promise<ScraperEntity[]> {
    if (entityType === 'zones') return []

    const account = await this.getAccount()
    if (!account.accessToken) await this.refreshToken(account)

    switch (entityType) {
      case 'dockless': return this.fetchDockless(polygon, account)
      case 'docked':   return this.fetchDocked(polygon, account)
      case 'pricings': return this.fetchPricings(polygon, account)
    }
  }

  // ─── Entity fetchers ────────────────────────────────────────────────────────

  private async fetchDockless(polygon: PolygonBounds, account: LyftAccount): Promise<ScraperEntity[]> {
    const pt = polygon.polygonType
    if (!pt || typeof pt.center_lat !== 'number' || typeof pt.center_lng !== 'number') {
      throw new Error(`Polygon ${polygon.polygonId} has no valid center point for Lyft dockless`)
    }
    const lat      = pt.center_lat as number
    const lng      = pt.center_lng as number
    const radiusKm = typeof pt.radius_m === 'number' ? pt.radius_m / 1000 : 1

    const cityCtx = await this.getCityContext(polygon)
    if (!cityCtx?.city_code) throw new Error(`No city_code found for Lyft polygon ${polygon.polygonId}`)

    const data = await this.post(
      DOCKLESS_URL,
      {
        magic_map_context: {
          origin_lat:     lat,
          origin_long:    lng,
          radius_km:      radiusKm,
          result_filters: ['bff_fidget_enabled'],
        },
      },
      account,
      {
        'content-type':          DOCKLESS_CONTENT_TYPE,
        'x-location':            `${lat},${lng}`,
        'x-lyft-region':         cityCtx.city_code,
        'x-timestamp-ms':        String(Date.now()),
        'x-timestamp-source':    'ntp',
        'x-client-session-id':   randomUUID(),
      },
      polygon.polygonId,
      'dockless',
    )

    const items = data.map_items
    if (items === null) {
      throw new ApiUnexpectedResponseError('dockless', polygon.polygonId, 'map-items API returned null map_items')
    }
    if (!Array.isArray(items)) return []

    const results: ScraperEntity[] = []
    for (const item of items as Record<string, unknown>[]) {
      const device   = item.device as Record<string, unknown> | null
      if (!device) continue
      const rideable = device.rideable as Record<string, unknown> | null
      if (!rideable) continue
      const loc      = (item.location as Record<string, unknown>) ?? {}
      const battery  = (rideable.battery_status as Record<string, unknown> | null)?.percent ?? null
      results.push({
        id:           String(rideable.rideable_id ?? device.id ?? ''),
        name:         (rideable.rideable_name as string | null) ?? null,
        battery:      battery,
        location_lat: loc.lat ?? null,
        location_lng: loc.lng ?? null,
        category:     (rideable.rideable_type as string | null) ?? null,
      })
    }
    return results
  }

  private async fetchDocked(polygon: PolygonBounds, account: LyftAccount): Promise<ScraperEntity[]> {
    const cityCtx = await this.getCityContext(polygon)
    if (!cityCtx?.city_code || cityCtx.city_lat == null || cityCtx.city_lon == null) {
      throw new Error(`Missing city context for Lyft docked polygon ${polygon.polygonId}`)
    }

    const data = await this.postInventory(cityCtx.city_code, cityCtx.city_lat, cityCtx.city_lon, account, polygon.polygonId)
    const stations = parseInventory(data, cityCtx.city_code)

    return stations.map((s) => ({
      id:                   s.shortId,
      station_id:           s.shortId,
      station_name:         s.shortId,
      location_lat:         s.lat,
      location_lng:         s.lng,
      num_bikes_available:  s.bikesAvail,
      num_docks_available:  s.docksAvail,
      is_installed:         s.isOffline ? 0 : 1,
      is_renting:           (s.isOffline || s.isValet) ? 0 : 1,
      is_returning:         s.isOffline ? 0 : 1,
    }))
  }

  private async fetchPricings(polygon: PolygonBounds, account: LyftAccount): Promise<ScraperEntity[]> {
    const cityCtx = await this.getCityContext(polygon)
    if (!cityCtx?.city_code || cityCtx.city_lat == null || cityCtx.city_lon == null) {
      throw new Error(`Missing city context for Lyft pricings polygon ${polygon.polygonId}`)
    }

    const inventoryData = await this.postInventory(cityCtx.city_code, cityCtx.city_lat, cityCtx.city_lon, account, polygon.polygonId)
    const stations = parseInventory(inventoryData, cityCtx.city_code)
    const stationsToPrice = stations.slice(0, MAX_PRICING_STATIONS)

    const results: ScraperEntity[] = []
    for (const station of stationsToPrice) {
      const pricings = await this.fetchStationPricings(
        station.fullId,
        cityCtx.city_code,
        cityCtx.city_lat,
        cityCtx.city_lon,
        account,
        polygon.polygonId,
      )
      results.push(...pricings)
    }
    return results
  }

  // ─── Inventory POST (shared by docked + pricings) ───────────────────────────

  private async postInventory(
    cityCode: string,
    cityLat:  number,
    cityLon:  number,
    account:  LyftAccount,
    polygonId: string,
  ): Promise<Record<string, unknown>> {
    return this.post(
      INVENTORY_URL,
      { style_sheet_name: STYLE_SHEET_NAME },
      account,
      {
        'content-type':                 INVENTORY_CONTENT_TYPE,
        'x-location':                   `${cityLat},${cityLon}`,
        'x-lyft-region':                cityCode,
        'x-timestamp-ms':               String(Date.now()),
        'x-timestamp-source':           'system',
        'x-client-session-id':          randomUUID(),
        'x-client-default-polling-rate':'2000',
      },
      polygonId,
      'docked',
    )
  }

  // ─── Per-station pricing fetch ───────────────────────────────────────────────

  private async fetchStationPricings(
    fullStationId: string,
    cityCode:      string,
    cityLat:       number,
    cityLon:       number,
    account:       LyftAccount,
    polygonId:     string,
  ): Promise<ScraperEntity[]> {
    const data = await this.post(
      PRICING_URL,
      {
        station_id:    fullStationId,
        panel_request: {},
        lastmile_rewards_user_education_messages_enabled: true,
      },
      account,
      {
        'content-type':        PRICING_CONTENT_TYPE,
        'x-location':          `${cityLat},${cityLon}`,
        'x-lyft-region':       cityCode,
        'x-timestamp-ms':      String(Date.now()),
        'x-timestamp-source':  'system',
        'x-client-session-id': randomUUID(),
      },
      polygonId,
      'pricings',
    )

    const panel      = data.panel as Record<string, unknown> | null
    const detailsComp = (panel?.component_map as Record<string, unknown> | null)?.[PRICING_DETAILS_KEY] as Record<string, unknown> | null
    if (!detailsComp) return []

    const strings = (
      ((detailsComp.pricing_details as Record<string, unknown>)
        ?.pricing_details_text as Record<string, unknown>)
        ?.text as Record<string, unknown>
    )?.strings
    if (!Array.isArray(strings)) return []

    // short_id = trailing part after last '_'
    const shortStationId = fullStationId.includes('_') ? fullStationId.split('_').pop()! : fullStationId

    const results: ScraperEntity[] = []
    let vehicleType: string | null = null

    for (const s of strings as Record<string, unknown>[]) {
      const content = String(s.content ?? '').trim()
      if (!content) continue

      if (!content.startsWith('•')) {
        vehicleType = content
        continue
      }

      const text = content.slice(1).trim()
      const amt  = parseAmount(text)
      if (amt === null) continue

      const name            = inferName(text)
      const pricingPlanName = PRICING_PLAN_NAMES[name] ?? 'Flat Fee'
      const pricingPlanId   = uuidv5(`${fullStationId}-${vehicleType}-${name}-${text}`)

      results.push({
        id:                pricingPlanId,
        pricing_plan_id:   pricingPlanId,
        pricing_plan_name: pricingPlanName,
        vehicle_type:      vehicleType,
        name,
        amt,
        currency:          parseCurrencySymbol(text),
        descriptions:      text,
        station_id:        shortStationId,
      })
    }
    return results
  }

  // ─── HTTP ───────────────────────────────────────────────────────────────────

  private async post(
    url:        string,
    body:       object,
    account:    LyftAccount,
    extraHeaders: Record<string, string>,
    polygonId:  string,
    entityType: string,
    retry = true,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        ...extraHeaders,
        'Authorization': `Bearer ${account.accessToken ?? ''}`,
      },
      body: JSON.stringify(body),
    })

    if (response.status === 401 && retry) {
      await this.refreshToken(account)
      return this.post(url, body, account, extraHeaders, polygonId, entityType, false)
    }

    if (!response.ok) {
      throw new ApiUnexpectedResponseError(
        entityType,
        polygonId,
        `Lyft API returned HTTP ${response.status} for ${url}`,
      )
    }

    return response.json() as Promise<Record<string, unknown>>
  }

  // ─── Auth ───────────────────────────────────────────────────────────────────

  private async getAccount(): Promise<LyftAccount> {
    if (this.account) return this.account
    const row = await getLyftAccount()
    if (!row) throw new Error('No active Lyft account found in scrapers_db')
    this.account = { accessToken: row.access_token, refreshToken: row.refresh_token }
    return this.account
  }

  private async refreshToken(account: LyftAccount): Promise<void> {
    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: account.refreshToken,
    })
    const response = await fetch(REFRESH_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${BASIC_AUTH}`,
        'Content-Type':  'application/x-www-form-urlencoded',
        'user-agent':    'lyft:android:16:2026.10.31.1774041931',
        'x-distance-unit':   'miles',
        'x-locale-language': 'en',
        'x-locale-region':   'US',
        'x-lyft-geo-region': 'unknown',
      },
      body: body.toString(),
    })
    if (!response.ok) throw new Error(`Lyft token refresh failed: HTTP ${response.status}`)
    const data = await response.json() as Record<string, unknown>
    account.accessToken  = data.access_token as string
    // refresh_token may rotate
    if (data.refresh_token) account.refreshToken = data.refresh_token as string
  }
}
