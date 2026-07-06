import { getBoltAccount, getBoltCityContext, type BoltCityContextRow } from '@/lib/scrapers-db'
import { TtlCache } from './ttl-cache'
import type { ScraperApiAdapter, PolygonBounds } from './scraper-adapter'
import { ApiUnexpectedResponseError } from './scraper-adapter'
import type { EntityType, ScraperEntity } from '@/types'

// ─── URLs ─────────────────────────────────────────────────────────────────────

const REFRESH_URL      = 'https://node.bolt.eu/user-auth/profile/auth/getAccessToken'
const VEHICLES_URL     = 'https://user.live.boltsvc.net/micromobility/search/getVehicles/v2'
const SUBSCRIPTION_URL = 'https://user.live.boltsvc.net/micromobility/subscription/list'
const CARD_URL         = 'https://user.live.boltsvc.net/micromobility/vehicle/getCard'
const ZONES_URL        = 'https://user.live.boltsvc.net/micromobility/cityArea/listByTile'

// ─── Device constants (from bolt_base_spider.py) ──────────────────────────────

const DEVICE_PARAMS: Record<string, string> = {
  version:                           'CA.202.0',
  device_name:                       'sdk_gphone64_arm64',
  device_os_version:                 '14',
  channel:                           'googleplay',
  brand:                             'bolt',
  deviceType:                        'android',
  signup_session_id:                 '',
  is_local_authentication_available: 'false',
  language:                          'en',
}

const BASE_HEADERS: Record<string, string> = {
  'Accept-Encoding': 'gzip',
  'Connection':      'Keep-Alive',
  'Content-Type':    'application/json; charset=UTF-8',
  'Host':            'user.live.boltsvc.net',
  'User-Agent':      'okhttp/4.12.0',
}

// ─── Currency / vehicle-type parsing (from bolt_pricing_parser.py) ────────────

const CURRENCY_MAP: [string, string][] = [
  ['€',   'EUR'], ['£',   'GBP'], ['zł',  'PLN'], ['Kč',  'CZK'],
  ['Ft',  'HUF'], ['lei', 'RON'], ['лв',  'BGN'], ['CHF', 'CHF'],
  ['₴',   'UAH'], ['₺',   'TRY'], ['₽',   'RUB'], ['₸',   'KZT'],
  ['₦',   'NGN'], ['KSh', 'KES'], ['GH₵', 'GHS'], ['MDL', 'MDL'],
  ['NOK', 'NOK'], ['DKK', 'DKK'], ['SEK', 'SEK'], ['$',   'USD'],
]

const KR_BY_COUNTRY: Record<string, string> = {
  Norway: 'NOK', Sweden: 'SEK', Denmark: 'DKK',
}

const PER_MIN_SUFFIXES = ['/min', '/мін', '/мин']

const VEHICLE_KEYWORDS: [string, string][] = [
  ['scooter', 'scooter'],
  ['e-bike',  'ebike'],
  ['ebike',   'ebike'],
  ['bike',    'ebike'],
  ['moped',   'moped'],
]

const CARD_CANDIDATES_PER_TYPE = 10

// ─── Internal types ───────────────────────────────────────────────────────────

interface BoltAccount {
  accessToken:     string | null
  authBearerToken: string
  deviceId:        string
  userId:          string
  sessionId:       string
  distinctId:      string
  rhSessionId:     string
  cookie:          string
}

interface BoundBox { south: number; west: number; north: number; east: number }

interface CardCandidate { id: unknown; lat: number; lng: number }
interface CardEntry { vehicleType: string; candidates: CardCandidate[] }

// ─── Stateless utility helpers ────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim()
}

// Port of decode_polyline.py — returns [[lat, lng], ...] (lat-first, same as Python).
function decodePolyline(encoded: string): number[][] {
  const coords: number[][] = []
  let index = 0, lat = 0, lng = 0
  while (index < encoded.length) {
    for (const isLat of [true, false]) {
      let shift = 0, result = 0, b: number
      do {
        b = encoded.charCodeAt(index++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (isLat) lat += delta
      else lng += delta
    }
    coords.push([
      parseFloat((lat / 1e5).toFixed(5)),
      parseFloat((lng / 1e5).toFixed(5)),
    ])
  }
  return coords
}

function parseCurrency(text: string, country?: string): string | null {
  for (const [sym, code] of CURRENCY_MAP) {
    if (text.includes(sym)) return code
  }
  if (text.includes('kr')) return country ? (KR_BY_COUNTRY[country] ?? null) : null
  return null
}

function parseRate(text: string): number | null {
  const beforeSlash = (text.split('/')[0] ?? '').replace(/,/g, '.')
  const m = beforeSlash.match(/\d+(?:\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}

function parseVehicleTypes(subtitleHtml: string): string | null {
  const subtitle = stripHtml(subtitleHtml).toLowerCase()
  const found: string[] = []
  for (const [keyword, token] of VEHICLE_KEYWORDS) {
    if (subtitle.includes(keyword) && !found.includes(token)) found.push(token)
  }
  return found.length ? found.join(',') : null
}

function discountReason(raw: string): string | null {
  if (raw.includes('%') && raw.toLowerCase().includes('save')) {
    return raw.replace(/ /g, ' ')
  }
  return null
}

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function getFilterValue(filterParams: Record<string, unknown>[], key: string): string[] {
  for (const param of filterParams) {
    if (param['key'] === key) return (param['values'] as string[]) ?? []
  }
  return []
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class BoltScraperApiAdapter implements ScraperApiAdapter {
  appId = 'bolt'
  readonly interPolygonDelayMs = 1000
  private account: BoltAccount | null = null
  // country/tile_id are per-city; cache by city to avoid a per-tile DB lookup
  // (dockless uses the 'all' strategy → one call per tile without the cache).
  private cityContextCache = new TtlCache<BoltCityContextRow | null>()

  private getCityContext(polygon: PolygonBounds): Promise<BoltCityContextRow | null> {
    const cacheKey = polygon.city ?? polygon.polygonId
    return this.cityContextCache.getOrLoad(cacheKey, () => getBoltCityContext(polygon.polygonId))
  }

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

  // ─── Account ─────────────────────────────────────────────────────────────────

  private async getAccount(): Promise<BoltAccount> {
    if (this.account) return this.account
    const row = await getBoltAccount()
    if (!row) throw new Error('No active Bolt account found in scrapers_db')
    this.account = {
      accessToken:     row.access_token,
      authBearerToken: row.refresh_token,
      deviceId:        row.device_id,
      userId:          row.user_id,
      sessionId:       row.session_id,
      distinctId:      row.distinct_id,
      rhSessionId:     row.rh_session_id,
      cookie:          row.cookie,
    }
    return this.account
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────────

  private async refreshToken(account: BoltAccount): Promise<void> {
    const qs = new URLSearchParams({
      ...DEVICE_PARAMS,
      deviceId:        account.deviceId,
      country:         'us',
      gps_lat:         '0',
      gps_lng:         '0',
      gps_accuracy_m:  '5.0',
      gps_age:         '1',
      user_id:         account.userId,
      session_id:      account.sessionId,
      distinct_id:     account.distinctId,
      rh_session_id:   account.rhSessionId,
    })
    const res = await fetch(`${REFRESH_URL}?${qs}`, {
      method:  'POST',
      headers: {
        'Accept-Encoding': 'gzip',
        'Authorization':   `Bearer ${account.authBearerToken}`,
        'Connection':      'Keep-Alive',
        'Content-Length':  '0',
        'Host':            'node.bolt.eu',
        'User-Agent':      'okhttp/4.12.0',
        'Cookie':          account.cookie,
      },
    })
    if (!res.ok) throw new Error(`Bolt token refresh failed: HTTP ${res.status}`)
    const data = await res.json() as Record<string, unknown>
    if (data['code'] !== 0) throw new Error(`Bolt token refresh failed: ${JSON.stringify(data)}`)
    account.accessToken = (data['data'] as Record<string, unknown>)['access_token'] as string
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────────────

  private buildQueryParams(
    country: string,
    lat: number,
    lng: number,
    account: BoltAccount,
  ): Record<string, string> {
    return {
      ...DEVICE_PARAMS,
      deviceId:       account.deviceId,
      country,
      gps_lat:        String(lat),
      gps_lng:        String(lng),
      gps_accuracy_m: '5.0',
      gps_age:        '1',
      user_id:        account.userId,
      session_id:     account.sessionId,
      distinct_id:    account.distinctId,
      rh_session_id:  account.rhSessionId,
    }
  }

  private async post(
    url: string,
    qs: Record<string, string>,
    body: unknown,
    account: BoltAccount,
    retry = true,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${url}?${new URLSearchParams(qs)}`, {
      method:  'POST',
      headers: {
        ...BASE_HEADERS,
        'Authorization': `Bearer ${account.accessToken ?? ''}`,
        'Cookie':        account.cookie,
      },
      body: JSON.stringify(body),
    })
    if (res.status === 401 && retry) {
      await this.refreshToken(account)
      return this.post(url, qs, body, account, false)
    }
    return res.json() as Promise<Record<string, unknown>>
  }

  private async get(
    url: string,
    qs: Record<string, string>,
    account: BoltAccount,
    retry = true,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${url}?${new URLSearchParams(qs)}`, {
      method:  'GET',
      headers: {
        ...BASE_HEADERS,
        'Authorization': `Bearer ${account.accessToken ?? ''}`,
        'Cookie':        account.cookie,
      },
    })
    if (res.status === 401 && retry) {
      await this.refreshToken(account)
      return this.get(url, qs, account, false)
    }
    return res.json() as Promise<Record<string, unknown>>
  }

  // ─── BoundBox helper ──────────────────────────────────────────────────────────

  private parseBoundBox(polygon: PolygonBounds): BoundBox {
    const bb = polygon.boundBox as Record<string, unknown>
    if (typeof bb?.south !== 'number' || typeof bb?.west  !== 'number' ||
        typeof bb?.north !== 'number' || typeof bb?.east  !== 'number') {
      throw new Error(`Polygon ${polygon.polygonId} has no valid boundBox for Bolt API`)
    }
    return { south: bb.south, west: bb.west, north: bb.north, east: bb.east }
  }

  private centerOf(bb: BoundBox): { lat: number; lng: number } {
    return { lat: (bb.south + bb.north) / 2, lng: (bb.west + bb.east) / 2 }
  }

  private viewportOf(bb: BoundBox): Record<string, unknown> {
    return {
      top_right:    { lat: bb.north, lng: bb.east },
      top_left:     { lat: bb.north, lng: bb.west },
      bottom_right: { lat: bb.south, lng: bb.east },
      bottom_left:  { lat: bb.south, lng: bb.west },
    }
  }

  // ─── Dockless ─────────────────────────────────────────────────────────────────

  private async fetchDockless(polygon: PolygonBounds, account: BoltAccount): Promise<ScraperEntity[]> {
    const ctx = await this.getCityContext(polygon)
    if (!ctx) throw new Error(`No Bolt city context found for polygon ${polygon.polygonId}`)

    const bb = this.parseBoundBox(polygon)
    const { lat, lng } = this.centerOf(bb)
    const qs   = this.buildQueryParams(ctx.country, lat, lng, account)
    const data = await this.post(VEHICLES_URL, qs, {
      should_include_style_config: true,
      viewport: this.viewportOf(bb),
    }, account)

    if (data['code'] !== 0) {
      throw new ApiUnexpectedResponseError(
        'dockless', polygon.polygonId,
        `getVehicles returned code=${data['code']}`,
      )
    }

    const categories = ((data['data'] as Record<string, unknown>)?.['categories'] as Record<string, unknown>[]) ?? []
    const entities: ScraperEntity[] = []

    for (const category of categories) {
      const categoryId = String(category['id'] ?? '')
      for (const marker of (category['markers_on_map'] as Record<string, unknown>[]) ?? []) {
        const v = marker['vehicle'] as Record<string, unknown> | null
        if (!v?.['id']) continue
        const loc          = (v['location'] as Record<string, unknown>) ?? {}
        const rawType      = String(v['vehicle_type'] ?? '')
        const lastUnder    = rawType.lastIndexOf('_')
        const categoryName = lastUnder > 0 ? rawType.substring(0, lastUnder) : (rawType || null)

        entities.push({
          id:           String(v['id']),
          vehicle_id:   String(v['id']),
          battery:      v['charge']    ?? null,
          location_lat: loc['lat']     ?? null,
          location_lng: loc['lng']     ?? null,
          zone_id:      categoryId,
          category:     categoryName,
        })
      }
    }

    return entities
  }

  // ─── Zones ────────────────────────────────────────────────────────────────────

  private async fetchZones(polygon: PolygonBounds, account: BoltAccount): Promise<ScraperEntity[]> {
    const ctx = await this.getCityContext(polygon)
    if (!ctx) throw new Error(`No Bolt city context found for polygon ${polygon.polygonId}`)

    const bb = this.parseBoundBox(polygon)
    const { lat, lng } = this.centerOf(bb)
    const qs = {
      ...this.buildQueryParams(ctx.country, lat, lng, account),
      tile_id:                ctx.tile_id,
      last_known_tile_version: '',
    }

    const data = await this.get(ZONES_URL, qs, account)

    if (data['code'] !== 0) {
      throw new ApiUnexpectedResponseError(
        'zones', polygon.polygonId,
        `listByTile returned code=${data['code']}`,
      )
    }

    const areas = ((data['data'] as Record<string, unknown>)?.['areas'] as Record<string, unknown>)?.['added'] as unknown[]
    if (!Array.isArray(areas)) {
      throw new ApiUnexpectedResponseError(
        'zones', polygon.polygonId,
        'listByTile: data.areas.added is not an array',
      )
    }

    return (areas as Record<string, unknown>[]).map((area) => {
      const filterParams  = (area['filter_params'] as Record<string, unknown>[]) ?? []
      const groupId       = String(area['group_id'] ?? '')
      const groupParts    = groupId ? groupId.split(':') : []
      const areaType      = groupParts[0] ?? null
      const lastPart      = groupParts.length >= 2 ? parseInt(groupParts[groupParts.length - 1] ?? '', 10) : NaN
      const areaPriority  = isNaN(lastPart) ? null : lastPart
      const cityIds       = getFilterValue(filterParams, 'city_id')
      const vtList        = getFilterValue(filterParams, 'micromobility_vehicle_type')
      const locations     = (area['polygon'] as Record<string, unknown>)?.['locations'] as string | null
      return {
        id:                   String(area['id']),
        zone_id:              String(area['id']),
        zone_name:            null,
        type:                 null,
        geometry_type:        'Polygon',
        geometry_coordinates: locations ? decodePolyline(locations) : null,
        area_type:            areaType,
        area_description:     null,
        area_priority:        areaPriority,
        area_rules:           null,
        area_zone_id:         cityIds[0] ?? null,
        vehicle_type:         vtList.length ? vtList.join(',') : null,
      }
    })
  }

  // ─── Pricings ─────────────────────────────────────────────────────────────────

  private async fetchPricings(polygon: PolygonBounds, account: BoltAccount): Promise<ScraperEntity[]> {
    const ctx = await this.getCityContext(polygon)
    if (!ctx) throw new Error(`No Bolt city context found for polygon ${polygon.polygonId}`)

    const bb = this.parseBoundBox(polygon)
    const { lat, lng } = this.centerOf(bb)
    const qs = this.buildQueryParams(ctx.country, lat, lng, account)

    // Step 1: subscription/list
    const subData = await this.post(SUBSCRIPTION_URL, qs, {}, account)
    if (subData['code'] !== 0) {
      throw new ApiUnexpectedResponseError(
        'pricings', polygon.polygonId,
        `subscription/list returned code=${subData['code']}`,
      )
    }
    const subPayload    = subData['data'] as Record<string, unknown>
    const vehicleType   = parseVehicleTypes(String(subPayload['subtitle_html'] ?? '')) ?? 'scooter'
    const subscriptions = (subPayload['subscriptions'] as Record<string, unknown>[]) ?? []
    const pricings: ScraperEntity[] = subscriptions.map(sub =>
      this.parseSubscription(sub, vehicleType, ctx.country),
    )

    // Step 2: getVehicles to find candidate IDs for vehicle card requests
    const vData    = await this.post(VEHICLES_URL, qs, {
      should_include_style_config: true,
      viewport: this.viewportOf(bb),
    }, account)
    const cardPlan = this.buildCardPlan(vData)

    // Step 3: getCard per vehicle type
    for (const entry of cardPlan) {
      for (const candidate of entry.candidates) {
        const cardQs = this.buildQueryParams(ctx.country, candidate.lat, candidate.lng, account)
        const delta  = 0.0005
        const cardBody = {
          vehicle_handle: { value: String(candidate.id), type: 'id' },
          source:          'map',
          flow_source:     'single_order',
          confirmation_keys: [],
          should_build_route_to_vehicle: true,
          supported_features: ['campaign_banner'],
          viewport: {
            top_right:    { lat: candidate.lat + delta, lng: candidate.lng + delta },
            top_left:     { lat: candidate.lat + delta, lng: candidate.lng - delta },
            bottom_right: { lat: candidate.lat - delta, lng: candidate.lng + delta },
            bottom_left:  { lat: candidate.lat - delta, lng: candidate.lng - delta },
          },
        }
        const cardData = await this.post(CARD_URL, cardQs, cardBody, account)
        if (this.isVehicleCard(cardData)) {
          pricings.push(...this.parseVehicleCard(cardData, entry.vehicleType, ctx.country))
          break // type captured — move to next vehicle type
        }
        // card unavailable for this vehicle (taken/no-card) — try next candidate
      }
    }

    return pricings
  }

  private buildCardPlan(vData: Record<string, unknown>): CardEntry[] {
    const byType: Record<string, CardCandidate[]> = {}
    const categories = ((vData['data'] as Record<string, unknown>)?.['categories'] as Record<string, unknown>[]) ?? []
    for (const cat of categories) {
      for (const marker of (cat['markers_on_map'] as Record<string, unknown>[]) ?? []) {
        const v       = marker['vehicle'] as Record<string, unknown> | null
        if (!v?.['id']) continue
        const rawType = String(v['vehicle_type'] ?? '')
        const loc     = (v['location'] as Record<string, unknown>) ?? {}
        if (!rawType || !('lat' in loc)) continue
        const lastUnder  = rawType.lastIndexOf('_')
        const baseType   = lastUnder > 0 ? rawType.substring(0, lastUnder) : rawType
        const candidates = byType[baseType] ?? (byType[baseType] = [])
        if (candidates.length < CARD_CANDIDATES_PER_TYPE) {
          candidates.push({ id: v['id'], lat: Number(loc['lat']), lng: Number(loc['lng']) })
        }
      }
    }
    return Object.entries(byType).map(([vehicleType, candidates]) => ({ vehicleType, candidates }))
  }

  private isVehicleCard(data: Record<string, unknown>): boolean {
    return data['code'] === 0 && (data['data'] as Record<string, unknown>)?.['type'] === 'vehicle_card'
  }

  // ─── Subscription parser (port of bolt_pricing_parser.py) ────────────────────

  private parseSubscription(
    sub: Record<string, unknown>,
    vehicleType: string,
    country: string,
  ): ScraperEntity {
    const subId = String(sub['id'] ?? '')
    let planName:          string | null = null
    let amt:               number | null = null
    let discountedAmount:  number | null = null
    let descriptions:      string | null = null
    let currency:          string | null = null
    let discountedReason:  string | null = null

    const containers = ((sub['content'] as Record<string, unknown>)?.['items'] as Record<string, unknown>[]) ?? []
    for (const container of containers) {
      if (container['type'] !== 'horizontal_container') continue
      for (const child of (container['items'] as Record<string, unknown>[]) ?? []) {
        if (child['type'] === 'label') {
          ;({ planName, amt, descriptions, currency, discountedReason } = this.extractLabelFields(
            child, planName, amt, descriptions, currency, discountedReason, country,
          ))
        } else if (child['type'] === 'badge') {
          const badgeText = String((child['badge'] as Record<string, unknown>)?.['text'] ?? '')
          if (PER_MIN_SUFFIXES.some(sfx => badgeText.includes(sfx)) && discountedAmount === null) {
            discountedAmount = parseRate(badgeText)
            if (currency === null) currency = parseCurrency(badgeText, country)
          } else {
            discountedReason = discountedReason ?? discountReason(stripHtml(badgeText))
          }
        }
      }
    }

    return {
      id:                subId,
      pricing_plan_id:   subId,
      discount_id:       subId,
      pricing_plan_name: planName,
      name:              'ride_pass',
      amt,
      discounted_amount: discountedAmount,
      discounted_reason: discountedReason,
      descriptions,
      currency,
      vehicle_type:      vehicleType,
    }
  }

  private extractLabelFields(
    child:           Record<string, unknown>,
    planName:        string | null,
    amt:             number | null,
    descriptions:    string | null,
    currency:        string | null,
    discountedReason: string | null,
    country:         string,
  ) {
    for (const textObj of (child['texts'] as Record<string, unknown>[]) ?? []) {
      const textHtml = String(textObj['text_html'] ?? '')
      const raw      = stripHtml(textHtml)
      if (!raw) continue
      if (currency === null) currency = parseCurrency(raw, country)
      const isHeading = textHtml.includes('name="heading')
      const reason    = discountReason(raw)
      if (reason !== null) {
        discountedReason = discountedReason ?? reason
      } else if (planName === null && (isHeading || raw.toLowerCase().includes('minutes'))) {
        planName = raw
      } else if (raw.toLowerCase().includes('valid') && descriptions === null) {
        descriptions = raw
      } else if (amt === null && (
        PER_MIN_SUFFIXES.some(sfx => raw.includes(sfx)) ||
        (isHeading && parseCurrency(raw, country) !== null)
      )) {
        amt = parseRate(raw)
      }
    }
    return { planName, amt, descriptions, currency, discountedReason }
  }

  // ─── Vehicle card parser (port of bolt_vehicle_card_parser.py) ───────────────

  private parseVehicleCard(
    data:        Record<string, unknown>,
    vehicleType: string,
    country:     string,
  ): ScraperEntity[] {
    const vehicleCard   = ((data['data'] as Record<string, unknown>)?.['vehicle_card'] as Record<string, unknown>) ?? {}
    const blocks        = (vehicleCard['blocks'] as Record<string, unknown>[]) ?? []
    const pricingBlock  = blocks.find(b => b['id'] === 'pricing')
    if (!pricingBlock) return []

    const pricings: ScraperEntity[] = []
    for (const row of (pricingBlock['rows'] as Record<string, unknown>[]) ?? []) {
      if (row['type'] !== 'key_value') continue
      const label = stripHtml(String(row['key_html']   ?? ''))
      const value = stripHtml(String(row['value_html'] ?? ''))
      if (!label) continue
      const token = slugify(label)
      const amt   = value.toLowerCase() === 'free' ? 0 : parseRate(value)
      pricings.push({
        id:                `${vehicleType}_${token}`,
        pricing_plan_id:   `${vehicleType}_${token}`,
        pricing_plan_name: label,
        name:              token,
        amt,
        currency:          parseCurrency(value, country),
        descriptions:      value,
        vehicle_type:      vehicleType,
      })
    }
    return pricings
  }
}
