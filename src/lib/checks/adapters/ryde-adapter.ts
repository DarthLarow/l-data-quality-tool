import { createCipheriv, createDecipheriv, createHash } from 'crypto'
import { getRydeAccount, getRydeCityContext, type RydeCityContextRow } from '@/lib/scrapers-db'
import { uuidv5 } from '@/lib/uuid5'
import type { ScraperApiAdapter, PolygonBounds } from './scraper-adapter'
import { ApiUnexpectedResponseError } from './scraper-adapter'
import type { EntityType, ScraperEntity } from '@/types'

// ─── URLs ─────────────────────────────────────────────────────────────────────

const LIST_URL   = 'https://qw-test.ryde.vip/appRyde/getNearScootersNew'
const DETAIL_URL = 'https://qw-test.ryde.vip/appRyde/getScooterInfoByCode'
const FEE_URL    = 'https://qw-test.ryde.vip/appRyde/getFeeRuleByCityId'
const FENCES_URL = 'https://qw-test.ryde.vip/appRyde/getCityFences'

const FEE_DIVISOR = 100
const DEFAULT_NEAR_RADIUS = 0.53
const MAX_VEHICLE_DETAILS = 50
const DETAIL_DELAY_MS = 150

// ─── Headers (from ryde_base_spider.py) ───────────────────────────────────────

const BASE_HEADERS: Record<string, string> = {
  'Accept':          'application/json, text/plain, */*',
  'AppVersion':      '5.15.2',
  'Connection':      'Keep-Alive',
  'Content-Type':    'application/x-www-form-urlencoded',
  'MobileType':      'Android/Xiaomi/2207117BPG/POCO',
  'User-Agent':      'okhttp/4.12.0',
  'X-Frame-Options': 'DENY',
}

// ─── Request signing / response decryption ────────────────────────────────────
// Ryde signs every request with an AES-CBC + MD5 timeSign and may encrypt the
// nearby-vehicles response body with the same hard-coded key (key2/key field).

const AES_KEY = Buffer.from('a70678d869319dab')
const AES_IV  = Buffer.from('0102330405070708')

function generateTimeSign(timestampMs: number): string {
  const cipher = createCipheriv('aes-128-cbc', AES_KEY, AES_IV)
  const encrypted = Buffer.concat([
    cipher.update(`rydeGood:${timestampMs}:ryde-app`, 'utf8'),
    cipher.final(),
  ])
  return createHash('md5').update(encrypted.toString('base64')).digest('hex')
}

function decryptField(encB64: string): Record<string, unknown> {
  const decipher = createDecipheriv('aes-128-cbc', AES_KEY, AES_IV)
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encB64, 'base64')),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>
}

function decryptResponsePayload(data: Record<string, unknown>): Record<string, unknown> {
  for (const field of ['key2', 'key']) {
    if (typeof data[field] === 'string' && data[field]) return decryptField(data[field] as string)
  }
  return data
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

/** Ryde `lastGps` is `lng,lat;<...>` — note the inverted order. */
function parseLastGps(lastGps: unknown): { lat: number | null; lng: number | null } {
  if (typeof lastGps !== 'string' || !lastGps) return { lat: null, lng: null }
  const [lngRaw, latRaw] = lastGps.split(';', 1)[0]?.split(',', 2) ?? []
  const lat = parseFloat(latRaw ?? '')
  const lng = parseFloat(lngRaw ?? '')
  if (isNaN(lat) || isNaN(lng)) return { lat: null, lng: null }
  return { lat, lng }
}

/** Ryde `fenceArea` is `lat,lng;lat,lng;...` — opposite order to lastGps. */
function hasValidFenceArea(fenceArea: unknown): boolean {
  if (typeof fenceArea !== 'string' || !fenceArea) return false
  for (const pair of fenceArea.split(';')) {
    const [latRaw, lngRaw] = pair.split(',', 2)
    if (!isNaN(parseFloat(latRaw ?? '')) && !isNaN(parseFloat(lngRaw ?? ''))) return true
  }
  return false
}

function parseBattery(sb: unknown): number | null {
  if (sb == null) return null
  const n = parseInt(String(sb), 10)
  return isNaN(n) ? null : n
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface VehicleRef {
  imei:        string
  vehicleType: string
  lat:         number | null
  lng:         number | null
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class RydeScraperApiAdapter implements ScraperApiAdapter {
  appId = 'ryde'
  readonly interPolygonDelayMs = 500
  private accessToken: string | null = null

  polygonStrategy(entityType: EntityType): 'all' | 'center_only' {
    // Dockless is tile-based: one ~1×1 km polygon per tile, iotLa/iotLo = tile center.
    return entityType === 'dockless' ? 'all' : 'center_only'
  }

  async fetchEntities(polygon: PolygonBounds, entityType: EntityType): Promise<ScraperEntity[]> {
    if (entityType === 'docked') return []

    await this.getToken()
    const ctx = await getRydeCityContext(polygon.polygonId)
    if (!ctx || ctx.city_id == null) {
      throw new Error(`No cityId found for Ryde polygon ${polygon.polygonId}`)
    }

    switch (entityType) {
      case 'dockless': return this.fetchDockless(polygon, ctx)
      case 'pricings': return this.fetchPricings(polygon, ctx)
      case 'zones':    return this.fetchZones(polygon, ctx)
    }
  }

  // ─── Dockless (two-step: tile list → per-IMEI detail) ──────────────────────

  private async fetchDockless(
    polygon: PolygonBounds,
    ctx:     RydeCityContextRow,
  ): Promise<ScraperEntity[]> {
    const { lat, lng, radiusKm } = this.tileParams(polygon)

    const listRaw = await this.post(LIST_URL, {
      cityId:     String(ctx.city_id),
      iotLa:      String(lat),
      iotLo:      String(lng),
      nearRadius: String(radiusKm),
    }, 'dockless', polygon.polygonId)

    const list = decryptResponsePayload(listRaw)
    if (!Array.isArray(list.scooters) && !Array.isArray(list.ebikes)) {
      throw new ApiUnexpectedResponseError('dockless', polygon.polygonId, 'nearby vehicles API returned neither scooters nor ebikes array')
    }

    const refs: VehicleRef[] = []
    for (const [collection, vehicleType] of [['scooters', 'scooter'], ['ebikes', 'ebike']] as const) {
      const vehicles = list[collection]
      if (!Array.isArray(vehicles)) continue
      for (const v of vehicles as Record<string, unknown>[]) {
        if (v.memberByString == null) continue
        const coord = (v.coordinate as Record<string, unknown> | null) ?? {}
        refs.push({
          imei:        String(v.memberByString),
          vehicleType,
          lat:         typeof coord.latitude  === 'number' ? coord.latitude  : null,
          lng:         typeof coord.longitude === 'number' ? coord.longitude : null,
        })
      }
    }

    const zoneId   = String(ctx.city_id)
    const zoneName = polygon.city ?? null
    const results: ScraperEntity[] = []
    const seen = new Set<string>()

    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i]
      if (!ref) continue
      let entity: ScraperEntity

      if (i < MAX_VEHICLE_DETAILS) {
        if (i > 0) await sleep(DETAIL_DELAY_MS)
        const detail = await this.post(DETAIL_URL, {
          cityId:     String(ctx.city_id),
          deviceIMEI: ref.imei,
          isSacn:     '2',
          phoneLa:    String(lat),
          phoneLo:    String(lng),
          qrCode:     '',
        }, 'dockless', polygon.polygonId)

        const scooter = (detail.scooter as Record<string, unknown> | null) ?? {}
        const code = scooter.code != null ? String(scooter.code) : null
        const vehicleId = scooter.deviceIMEI != null ? String(scooter.deviceIMEI) : code
        const battery = parseBattery(scooter.sb)
        const gps = parseLastGps(scooter.lastGps)
        // Mirror the scraper: rows without id/coords/battery never reach the DB.
        if (!vehicleId || gps.lat == null || gps.lng == null || battery == null) continue

        entity = {
          id:            vehicleId,
          name:          code,
          battery,
          location_lat:  gps.lat,
          location_lng:  gps.lng,
          zone_id:       zoneId,
          zone_name:     zoneName,
          category:      ref.vehicleType,
          helmet_status: null,
        }
      } else {
        // Beyond the detail cap: list-only entity (still counts for completeness).
        entity = {
          id:            ref.imei,
          name:          null,
          battery:       null,
          location_lat:  ref.lat,
          location_lng:  ref.lng,
          zone_id:       zoneId,
          zone_name:     zoneName,
          category:      ref.vehicleType,
          helmet_status: null,
        }
      }

      if (seen.has(entity.id)) continue
      seen.add(entity.id)
      results.push(entity)
    }
    return results
  }

  private tileParams(polygon: PolygonBounds): { lat: number; lng: number; radiusKm: number } {
    const pt = polygon.polygonType
    if (typeof pt?.center_lat === 'number' && typeof pt?.center_lng === 'number') {
      const radiusM = typeof pt.radius_m === 'number' ? pt.radius_m : DEFAULT_NEAR_RADIUS * 1000
      return {
        lat:      pt.center_lat,
        lng:      pt.center_lng,
        radiusKm: Math.round(radiusM / 10) / 100,
      }
    }
    const bb = polygon.boundBox as Record<string, unknown>
    if (typeof bb?.south !== 'number' || typeof bb?.west !== 'number' ||
        typeof bb?.north !== 'number' || typeof bb?.east !== 'number') {
      throw new Error(`Polygon ${polygon.polygonId} has neither circle polygon_type nor valid boundBox for Ryde API`)
    }
    return {
      lat:      (bb.south + bb.north) / 2,
      lng:      (bb.west + bb.east) / 2,
      radiusKm: DEFAULT_NEAR_RADIUS,
    }
  }

  // ─── Pricings ───────────────────────────────────────────────────────────────

  private async fetchPricings(
    polygon: PolygonBounds,
    ctx:     RydeCityContextRow,
  ): Promise<ScraperEntity[]> {
    const data = await this.post(FEE_URL, { cityId: String(ctx.city_id) }, 'pricings', polygon.polygonId)

    const rule = data.rule as Record<string, unknown> | null | undefined
    if (rule == null || typeof rule !== 'object') {
      throw new ApiUnexpectedResponseError('pricings', polygon.polygonId, 'fee rule API returned no rule object')
    }
    if (rule.cityId != null && Number(rule.cityId) !== ctx.city_id) return []

    const cityId = rule.cityId != null ? Number(rule.cityId) : ctx.city_id
    const zoneId = String(cityId)
    const currency = ctx.city_unit || (rule.feeCur as string | null) || null
    const vehicleType = 'scooter' // scraper default; Ryde fee rule is not vehicle-specific

    const fields: [string, unknown][] = [
      ['unlock_fee',           rule.openFee],
      ['per_minute_cost',      rule.ruleFee],
      ['per_minute_pause_fee', rule.reFee],
      ['transfer_fee',         rule.transferFee],
      ['max_trip_fee',         rule.totalFee],
    ]

    const results: ScraperEntity[] = []
    for (const [name, value] of fields) {
      if (value == null) continue
      const amt = Number(value)
      results.push({
        id:                uuidv5(`${zoneId}_${vehicleType}_${name}`),
        pricing_plan_name: 'pricing',
        name,
        amt:               isNaN(amt) ? null : amt / FEE_DIVISOR,
        currency,
        vehicle_type:      vehicleType,
        zone_id:           zoneId,
        zone_name:         polygon.city ?? null,
        station_id:        null,
      })
    }
    return results
  }

  // ─── Zones ──────────────────────────────────────────────────────────────────

  private async fetchZones(
    polygon: PolygonBounds,
    ctx:     RydeCityContextRow,
  ): Promise<ScraperEntity[]> {
    if (ctx.gps_lat == null || ctx.gps_lng == null) {
      throw new Error(`No gps_lat/gps_lng in city context for Ryde polygon ${polygon.polygonId}`)
    }

    const data = await this.post(FENCES_URL, {
      gpsLa:      String(ctx.gps_lat),
      gpsLo:      String(ctx.gps_lng),
      userCityId: '',
    }, 'zones', polygon.polygonId)

    if (!Array.isArray(data.fences)) {
      throw new ApiUnexpectedResponseError('zones', polygon.polygonId, 'city fences API returned no fences array')
    }

    const results: ScraperEntity[] = []
    for (const fence of data.fences as Record<string, unknown>[]) {
      if (fence.fenId == null || !hasValidFenceArea(fence.fenceArea)) continue
      results.push({
        id:               String(fence.fenId),
        zone_name:        (fence.fenceName as string | null) ?? null,
        geometry_type:    'MultiPolygon',
        area_type:        fence.fenceType != null ? String(fence.fenceType) : null,
        area_description: (fence.fenceRemake as string | null) ?? null,
        area_priority:    null,
        area_rules:       JSON.stringify({
          outNoRide:    fence.outNoRide ?? null,
          isLimitSpeed: fence.isLimitSpeed ?? null,
          prohibitLock: fence.prohibitLock ?? null,
          openAreaType: fence.openAreaType ?? null,
          zoneDesign:   fence.zoneDesign ?? null,
        }),
        area_zone_id:     fence.cityId != null ? String(fence.cityId) : null,
        vehicle_type:     null,
      })
    }
    return results
  }

  // ─── HTTP ───────────────────────────────────────────────────────────────────

  private async post(
    url:        string,
    payload:    Record<string, string>,
    entityType: string,
    polygonId:  string,
  ): Promise<Record<string, unknown>> {
    const timestamp = Date.now()
    const body = new URLSearchParams({
      ...payload,
      token:     this.accessToken ?? '',
      timestamp: String(timestamp),
      timeSign:  generateTimeSign(timestamp),
    })

    const response = await fetch(url, {
      method:  'POST',
      headers: BASE_HEADERS,
      body:    body.toString(),
    })
    if (!response.ok) {
      throw new ApiUnexpectedResponseError(entityType, polygonId, `Ryde API ${url} returned HTTP ${response.status}`)
    }
    return response.json() as Promise<Record<string, unknown>>
  }

  // ─── Auth ───────────────────────────────────────────────────────────────────
  // Ryde has no refresh flow: the account token is static and passed in the
  // POST body. If it expires the only option is to update it in scrapers_db.

  private async getToken(): Promise<string> {
    if (this.accessToken) return this.accessToken
    const row = await getRydeAccount()
    if (!row?.access_token) throw new Error('No active Ryde account with access_token found in scrapers_db')
    this.accessToken = row.access_token
    return this.accessToken
  }
}
