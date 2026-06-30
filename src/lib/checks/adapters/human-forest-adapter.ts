import { getHumanForestAccount } from '@/lib/scrapers-db'
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
const BUNDLES_URL   = `${BASE_URL}/v1/bundles`
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
    if (res.status === 401) {
      await this.signIn(account)
      return
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

  private async fetchDockless(_polygon: PolygonBounds, _account: HumanForestAccount): Promise<ScraperEntity[]> {
    throw new Error('not implemented')
  }

  private async fetchPricings(_polygon: PolygonBounds, _account: HumanForestAccount): Promise<ScraperEntity[]> {
    throw new Error('not implemented')
  }

  private async fetchZones(_polygon: PolygonBounds, _account: HumanForestAccount): Promise<ScraperEntity[]> {
    throw new Error('not implemented')
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
