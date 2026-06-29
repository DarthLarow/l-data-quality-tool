import { getArioAccount } from '@/lib/scrapers-db'
import { uuidv5 } from '@/lib/uuid5'
import type { ScraperApiAdapter, PolygonBounds } from './scraper-adapter'
import { ApiUnexpectedResponseError } from './scraper-adapter'
import type { EntityType, ScraperEntity } from '@/types'

// ─── Auth constants extracted from Ario APK ───────────────────────────────────

const GMS_AUTH_URL     = 'https://android.googleapis.com/auth'
const ARIO_LOGIN_URL   = 'https://app.3km.tech/app/api/login'
const ARIO_CLIENT_ID   = '1079026099096-rmvigj6c56fianlmvfe6oa0nlql62hl9.apps.googleusercontent.com'
const ARIO_CLIENT_SIG  = '3402f1ae41841f8192237a515d8b87f0f82198e5'
const ARIO_APP_PKG     = 'sg.ario.scooter'
const ARIO_APP_VERSION = '65'
const GMS_CALLER_PKG   = 'com.google.android.gms'
const GMS_CALLER_SIG   = '58e1c4133f7441ec3d2c270270a14802da47ba0e'
const DEFAULT_GMS_VERSION = '231818044'
const DEFAULT_LOCALE      = 'en_US'

const BASE_HEADERS = {
  'Accept-Encoding': 'gzip',
  'Connection':      'Keep-Alive',
  'Content-Type':    'application/json; charset=UTF-8',
  'Host':            'app.3km.tech',
  'User-Agent':      'okhttp/4.12.0',
  'os':              '2',
  'version':         ARIO_APP_VERSION,
}

// ─── Internal account state ───────────────────────────────────────────────────

interface ArioAccount {
  id:          string
  token:       string | null
  masterToken: string
  email:       string
  deviceId:    string
  androidId:   string
  name:        string
  gmsVersion:  string
  locale:      string
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class ArioScraperApiAdapter implements ScraperApiAdapter {
  appId = 'ario'
  readonly interPolygonDelayMs = 500
  private account: ArioAccount | null = null

  polygonStrategy(entityType: EntityType): 'all' | 'center_only' {
    return entityType === 'dockless' ? 'all' : 'center_only'
  }

  async fetchEntities(polygon: PolygonBounds, entityType: EntityType): Promise<ScraperEntity[]> {
    if (entityType === 'docked') return []

    const account = await this.getAccount()
    if (!account.token) await this.refreshToken(account)

    const { lat, lon } = this.parsePolygonPoint(polygon)

    switch (entityType) {
      case 'dockless': return this.fetchDockless(lat, lon, account)
      case 'pricings': return this.fetchPricings(polygon, account, polygon.city ?? 'unknown')
      case 'zones':    return this.fetchZones(polygon, account)
    }
  }

  // ─── Entity fetchers ────────────────────────────────────────────────────────

  private async fetchDockless(lat: number, lon: number, account: ArioAccount): Promise<ScraperEntity[]> {
    const data = await this.post('/app/api/carlist', { latitude: lat, longitude: lon }, account)
    const cars = (data?.data as Record<string, unknown>)?.car_list
    if (!Array.isArray(cars)) return []
    return (cars as Record<string, unknown>[])
      .filter((car) => car.carId != null)
      .map((car) => ({ id: String(car.carId), ...car }))
  }

  private async fetchPricings(polygon: PolygonBounds, account: ArioAccount, city: string): Promise<ScraperEntity[]> {
    const { lat, lon } = this.parsePolygonPoint(polygon)
    const results: ScraperEntity[] = []

    // Base pricing: unlock fee + per-minute cost.
    // Separate snapshots so each entity only has its own fee field — avoids
    // the unlock entity showing timeFeeAmount (and vice versa) in the diff view.
    const priceData = await this.post('/app/api/pay/pricelist', { latitude: lat, longitude: lon }, account)
    // Check the inner data key before ?? coalescing — { data: null } would otherwise
    // coalesce to priceData (a non-null object) and the null would go undetected.
    if (priceData?.data === null) {
      throw new ApiUnexpectedResponseError(
        'pricings',
        polygon.polygonId,
        'pricings API returned null data',
      )
    }
    const raw = (priceData?.data ?? priceData) as Record<string, unknown>
    if (raw && typeof raw === 'object') {
      const { unlockFeeAmount, timeFeeAmount, ...sharedFields } = raw as Record<string, unknown> & {
        unlockFeeAmount?: unknown; timeFeeAmount?: unknown
      }
      if (unlockFeeAmount != null)
        results.push({ id: uuidv5(`ario_unlock_${city}`), unlockFeeAmount, ...sharedFields })
      if (timeFeeAmount != null)
        results.push({ id: uuidv5(`ario_per_minute_${city}`), timeFeeAmount, ...sharedFields })
    }

    // Ride passes
    const passData = await this.post('/app/api/getridepassbycity', { latitude: lat, longitude: lon }, account)
    const passes = passData?.data
    if (Array.isArray(passes)) {
      for (const pass of passes as Record<string, unknown>[]) {
        if (pass.ridePassId != null)
          results.push({ id: uuidv5(`ario_ride_pass_${pass.ridePassId}`), ...pass })
      }
    }

    return results
  }

  private async fetchZones(polygon: PolygonBounds, account: ArioAccount): Promise<ScraperEntity[]> {
    const { lat, lon } = this.parsePolygonPoint(polygon)
    const data = await this.post('/app/api/getoutofoalist', { latitude: lat, longitude: lon }, account)
    const inner = (data?.data ?? data) as Record<string, unknown>
    const oaList = inner?.oa_list
    // null = key present but explicitly nulled out by server → structural anomaly, possible block
    // undefined = key simply absent → legitimate "no zones" response, fall through to [] below
    if (oaList === null) {
      throw new ApiUnexpectedResponseError(
        'zones',
        polygon.polygonId,
        'zones API returned null oa_list',
      )
    }
    if (!Array.isArray(oaList)) return []

    const results: ScraperEntity[] = []
    for (const oa of oaList as Record<string, unknown>[]) {
      const areaId = String(oa.area_id ?? '')
      // Spread only metadata fields — exclude coordinate lists (huge arrays that
      // clutter the diff view and are already captured in `geometry`).
      const oaMeta = Object.fromEntries(
        Object.entries(oa).filter(([k]) => !k.endsWith('_coordinate_list')),
      )
      for (const [key, raw] of Object.entries(oa)) {
        if (!key.endsWith('_coordinate_list')) continue
        // Raw suffix is stored as-is in DB (oa, no_park, no_go, low_speed, curfew, no_park_pay)
        const areaType = key.slice(0, -'_coordinate_list'.length)
        const polygons = this.extractPolygons(raw)
        polygons.forEach((poly, idx) => {
          results.push({ ...oaMeta, id: `${areaId}-${areaType}-${idx}`, type: areaType, area_type: areaType, geometry: poly })
        })
      }
    }
    return results
  }

  // ─── HTTP helper ────────────────────────────────────────────────────────────

  private async post(
    path: string,
    body: object,
    account: ArioAccount,
    retry = true,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`https://app.3km.tech${path}`, {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        token:    account.token ?? '',
        deviceid: account.deviceId,
        locale:   account.locale,
      },
      body: JSON.stringify(body),
    })

    if (response.status === 401 && retry) {
      await this.refreshToken(account)
      return this.post(path, body, account, false)
    }

    const json = await response.json() as Record<string, unknown>

    if (json.res_code === 1001 && retry) {
      await this.refreshToken(account)
      return this.post(path, body, account, false)
    }

    return json
  }

  // ─── Auth ───────────────────────────────────────────────────────────────────

  private async getAccount(): Promise<ArioAccount> {
    if (this.account) return this.account
    const row = await getArioAccount()
    if (!row) throw new Error('No active Ario account found in scrapers_db')
    this.account = {
      id:          row.id,
      token:       row.access_token,
      masterToken: row.refresh_token,
      email:       row.email,
      deviceId:    row.device_id,
      androidId:   row.android_id,
      name:        row.name ?? '',
      gmsVersion:  row.gms_version ?? DEFAULT_GMS_VERSION,
      locale:      row.locale ?? DEFAULT_LOCALE,
    }
    return this.account
  }

  private async refreshToken(account: ArioAccount): Promise<void> {
    const idToken = await this.fetchGoogleIdToken(account)
    const newToken = await this.fetchArioToken(account, idToken)
    // stored in-memory only — scrapers_db is read-only
    account.token = newToken
  }

  private async fetchGoogleIdToken(account: ArioAccount): Promise<string> {
    const body = new URLSearchParams({
      androidId:                    account.androidId,
      lang:                         'en-US',
      google_play_services_version: account.gmsVersion,
      sdk_version:                  '36',
      device_country:               'us',
      is_dev_key_gmscore:           '1',
      app:                          ARIO_APP_PKG,
      Email:                        account.email,
      pkgVersionCode:               account.gmsVersion,
      client_sig:                   ARIO_CLIENT_SIG,
      Token:                        account.masterToken,
      consumerVersionCode:          ARIO_APP_VERSION,
      check_email:                  '1',
      callerPkg:                    GMS_CALLER_PKG,
      callerSig:                    GMS_CALLER_SIG,
      token_request_options:        'CAA4AVAGYAA=',
      has_permission:               '1',
      oauth2_include_profile:       '1',
      oauth2_include_email:         '1',
      service:                      `audience:server:client_id:${ARIO_CLIENT_ID}`,
      include_granted_scopes:       '0',
    })

    const response = await fetch(GMS_AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'app':          ARIO_APP_PKG,
        'User-Agent':   `com.google.android.gms/${account.gmsVersion} (Linux; U; Android 16; en_US; sdk_gphone64_x86_64; Build/BE2A.250530.026.F3; Cronet/139.0.7205.3)`,
        'device':       account.androidId,
      },
      body: body.toString(),
    })

    const text = await response.text()
    const parsed = Object.fromEntries(
      text.trim().split('\n')
        .filter((l) => l.includes('='))
        .map((l) => l.split('=', 2) as [string, string]),
    )
    const token = parsed['Auth']
    if (!token) throw new Error(`Ario GMS auth failed: ${text}`)
    return token
  }

  private async fetchArioToken(account: ArioAccount, idToken: string): Promise<string> {
    const response = await fetch(ARIO_LOGIN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'os':           '2',
        'version':      ARIO_APP_VERSION,
        'token':        '',
        'User-Agent':   'okhttp/4.12.0',
        'deviceid':     account.deviceId,
        'locale':       account.locale,
      },
      body: JSON.stringify({
        email:          account.email,
        identity_token: idToken,
        latitude:       0.0,
        longitude:      0.0,
        name:           account.name,
        pic_url:        '',
        type:           2,
      }),
    })

    const data = await response.json() as Record<string, unknown>
    if (data.res_code !== 0) throw new Error(`Ario login failed: ${JSON.stringify(data)}`)
    const token = (data.data as Record<string, unknown>)?.token as string | undefined
    if (!token) throw new Error(`Ario login returned no token: ${JSON.stringify(data)}`)
    return token
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private parsePolygonPoint(polygon: PolygonBounds): { lat: number; lon: number } {
    const pt = polygon.polygonType
    if (!pt || typeof pt.lat !== 'number' || typeof pt.lon !== 'number') {
      throw new Error(`Polygon ${polygon.polygonId} has no valid point polygonType — cannot call Ario API`)
    }
    return { lat: pt.lat, lon: pt.lon }
  }

  // Port of ArioZoneParser._extract_polygons from the Python scraper.
  // Handles three observed shapes for coordinate arrays.
  private extractPolygons(raw: unknown): number[][][] {
    if (!Array.isArray(raw) || raw.length === 0) return []
    const first = raw[0] as Record<string, unknown>

    // Shape 1: flat list of {latitude, longitude} points → one polygon
    if (typeof first === 'object' && 'latitude' in first) {
      return [(raw as Array<{ latitude: number; longitude: number }>)
        .map((p) => [p.latitude, p.longitude])]
    }

    // Shape 2: list of polygon arrays → N polygons
    if (Array.isArray(first)) {
      return (raw as unknown[][])
        .filter((poly) => Array.isArray(poly) && poly.length > 0 &&
          typeof (poly[0] as Record<string, unknown>).latitude === 'number')
        .map((poly) => (poly as Array<{ latitude: number; longitude: number }>)
          .map((p) => [p.latitude, p.longitude]))
    }

    // Shape 3: list of objects with nested coordinate_list
    if (Array.isArray((first as Record<string, unknown>).coordinate_list)) {
      return (raw as Array<{ coordinate_list: Array<{ latitude: number; longitude: number }> }>)
        .map((sub) => (sub.coordinate_list ?? []).map((p) => [p.latitude, p.longitude]))
        .filter((poly) => poly.length > 0)
    }

    return []
  }
}
