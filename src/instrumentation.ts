/**
 * Next.js instrumentation — runs once when the server process starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register(): Promise<void> {
  // Node runtime only (skip Edge, where undici/global dispatcher don't apply).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Enable HTTP keep-alive for outgoing fetch() calls so the TLS handshake
  // isn't paid on every request. With the polygon worker pool (concurrency),
  // a single scraper host serves many requests — reusing connections cuts the
  // per-request handshake cost noticeably.
  //
  // undici is a transitive dependency (via shadcn) rather than a direct one, so
  // this is best-effort: if it's ever absent or its API changes, we log and
  // continue — the worker-pool speedup does not depend on keep-alive.
  try {
    const { Agent, setGlobalDispatcher } = await import('undici')
    setGlobalDispatcher(
      new Agent({
        keepAliveTimeout: 30_000, // keep idle sockets 30s
        connections:      16,     // cap concurrent connections per origin
      }),
    )
    console.info('[instrumentation] undici keep-alive dispatcher enabled')
  } catch (err) {
    console.warn(
      '[instrumentation] undici keep-alive not enabled (optional):',
      err instanceof Error ? err.message : err,
    )
  }
}
