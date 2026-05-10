import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import NetworkGraph from './components/NetworkGraph'
import { graphDtoToForceData, type GraphData } from './graph/graphDto'
import {
  DEFAULT_EXPAND_MAX_FOLLOWERS,
  DEFAULT_EXPAND_MAX_FOLLOWING,
  DEFAULT_EXPAND_MAX_HOP_DEPTH,
  DEFAULT_EXPAND_STREAM_THROTTLE_MS,
  expandGraphStream,
  fetchPublicGraph,
} from './lib/graphApi'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import { LONG_PRESS_MOVE_CANCEL_PX } from './graph/columbia/graphConstants'
import './App.css'

/** Logo-only: faster than graph node long-press so physics mode activates quickly. */
const LOGO_PHYSICS_PRESS_MS = 380
/** After physics (shake) is on, hold this long before the auth spin ramp can begin. */
const LOGO_PHYSICS_DWELL_BEFORE_AUTH_MS = 1100

/** Easter egg: single-click the logo this many times (across signed-in/public) to play Pink Moon. */
const LOGO_PINK_MOON_CLICK_THRESHOLD = 10
/** Public folder asset; encodeURI handles spaces. Brackets are valid in URL paths. */
const PINK_MOON_AUDIO_SRC = encodeURI('/Nick Drake - Pink Moon [xqe6TF2y8i4].m4a')

type SessionInfo = {
  supabaseAccessToken: string
  githubAccessToken: string
  login: string
}

/** Persisted across the GitHub OAuth redirect so a long-press crawl can resume after sign-in. */
const PENDING_CRAWL_KEY = 'network:pendingCrawlLogin'
const DEFAULT_PUBLIC_INITIAL_MAX_NODES = 200

function readPublicInitialMaxNodes(): number {
  const raw = import.meta.env.VITE_PUBLIC_INITIAL_MAX_NODES
  const n = typeof raw === 'string' ? Number(raw) : Number(raw ?? DEFAULT_PUBLIC_INITIAL_MAX_NODES)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PUBLIC_INITIAL_MAX_NODES
  return Math.min(Math.max(Math.floor(n), 1), 100_000)
}

function readGithubLoginFromUser(user: User): string | null {
  const md = user.user_metadata as Record<string, unknown>
  const direct = md.user_name ?? md.preferred_username ?? md.name
  if (typeof direct === 'string' && direct.length > 0) return direct.replace(/^@/, '')

  const identities = user.identities as
    | Array<{ provider?: string; identity_data?: Record<string, unknown> }>
    | undefined
  const gh = identities?.find((i) => i.provider === 'github')
  const userName = gh?.identity_data?.user_name
  if (typeof userName === 'string' && userName.length > 0) return userName.replace(/^@/, '')

  return null
}

function mergeGraphDataAdditive(
  existing: GraphData | null,
  incoming: GraphData,
): GraphData {
  if (!existing) return incoming

  const nodeById = new Map<number, GraphData['nodes'][number]>()
  for (const n of existing.nodes) nodeById.set(n.id, n)
  for (const n of incoming.nodes) {
    const prev = nodeById.get(n.id)
    nodeById.set(n.id, prev ? { ...prev, ...n } : n)
  }

  const mergedLinks: GraphData['links'] = []
  const seen = new Set<string>()
  const pushLink = (l: GraphData['links'][number]) => {
    const key = `${l.source}->${l.target}`
    if (seen.has(key)) return
    seen.add(key)
    mergedLinks.push(l)
  }
  for (const l of existing.links) pushLink(l)
  for (const l of incoming.links) pushLink(l)

  return {
    nodes: [...nodeById.values()],
    links: mergedLinks,
  }
}

export default function App() {
  const publicInitialMaxNodes = readPublicInitialMaxNodes()
  const [session, setSession] = useState<SessionInfo | null>(null)
  /**
   * False until first `getSession()` finishes — avoids fetching the public snapshot while signed-in
   * session restore is pending (fixes refresh flashing many guest nodes briefly).
   */
  const [authSessionResolved, setAuthSessionResolved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [graphLoading, setGraphLoading] = useState(true)
  const [graph, setGraph] = useState<GraphData | null>(null)
  const graphRefForRefresh = useRef<GraphData | null>(null)
  graphRefForRefresh.current = graph
  /** Matches graph chrome (dark inner disk vs light outer); default dark for page background before graph reports. */
  const [, setUiSurfaceDark] = useState(true)
  /** Graph “drag physics” — toggled by long-pressing the logo (logo uses its own timings). */
  const [interactivePhysics, setInteractivePhysics] = useState(false)
  const logoPhysicsPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logoAuthDwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logoSpinRafRef = useRef<number | null>(null)
  const logoSpinRampStartRef = useRef<number | null>(null)
  const logoSpinActiveRef = useRef(false)
  const logoLoginTriggeredRef = useRef(false)
  const logoPointerStartPhysicsRef = useRef(false)
  const logoSuppressClickRef = useRef(false)
  const logoPointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const [logoBoostSpinActive, setLogoBoostSpinActive] = useState(false)
  const [logoBoostSpinDurationMs, setLogoBoostSpinDurationMs] = useState(900)
  const [focusAuthNodeNonce, setFocusAuthNodeNonce] = useState(0)
  const sessionRef = useRef<SessionInfo | null>(null)
  const logoClickCountRef = useRef(0)
  const pinkMoonAudioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    if (!supabase) return

    let cancelled = false
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return
        const s = data.session
        if (!s?.access_token || !s.user) return
        const gh = s.provider_token
        if (!gh) {
          setError(
            'Signed in, but GitHub provider_token is missing. In Supabase Dashboard → Auth → Providers → GitHub, ensure OAuth is enabled; then sign out and sign in again.',
          )
          return
        }
        const login = readGithubLoginFromUser(s.user)
        if (!login) {
          setError('Could not infer GitHub login from Supabase user metadata.')
          return
        }
        setSession({ supabaseAccessToken: s.access_token, githubAccessToken: gh, login })
        setError(null)
      })
      .catch(() => {
        /* allow app to proceed as guest when session read fails */
      })
      .finally(() => {
        if (!cancelled) setAuthSessionResolved(true)
      })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!s?.access_token || !s.user) {
        setSession(null)
        return
      }
      const gh = s.provider_token
      if (!gh) {
        setSession(null)
        setError('Missing GitHub provider_token after auth. Try signing out/in again.')
        return
      }
      const login = readGithubLoginFromUser(s.user)
      if (!login) {
        setSession(null)
        setError('Could not infer GitHub login.')
        return
      }
      setSession({
        supabaseAccessToken: s.access_token,
        githubAccessToken: gh,
        login,
      })
      setError(null)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (logoPhysicsPressTimerRef.current != null) {
        window.clearTimeout(logoPhysicsPressTimerRef.current)
        logoPhysicsPressTimerRef.current = null
      }
      if (logoAuthDwellTimerRef.current != null) {
        window.clearTimeout(logoAuthDwellTimerRef.current)
        logoAuthDwellTimerRef.current = null
      }
      if (logoSpinRafRef.current != null) {
        window.cancelAnimationFrame(logoSpinRafRef.current)
        logoSpinRafRef.current = null
      }
    }
  }, [])

  function clearLogoPressTimers() {
    if (logoPhysicsPressTimerRef.current != null) {
      window.clearTimeout(logoPhysicsPressTimerRef.current)
      logoPhysicsPressTimerRef.current = null
    }
    if (logoAuthDwellTimerRef.current != null) {
      window.clearTimeout(logoAuthDwellTimerRef.current)
      logoAuthDwellTimerRef.current = null
    }
  }

  function stopLogoSpinRamp() {
    logoSpinActiveRef.current = false
    logoSpinRampStartRef.current = null
    if (logoSpinRafRef.current != null) {
      window.cancelAnimationFrame(logoSpinRafRef.current)
      logoSpinRafRef.current = null
    }
    setLogoBoostSpinActive(false)
    setLogoBoostSpinDurationMs(900)
  }

  function startLogoSpinRamp() {
    if (logoSpinActiveRef.current) return
    logoSpinActiveRef.current = true
    logoSpinRampStartRef.current = null
    setLogoBoostSpinDurationMs(900)
    setLogoBoostSpinActive(true)

    const LOGIN_RAMP_MS = 1700
    const MIN_SPIN_MS = 120
    const MAX_SPIN_MS = 900

    const tick = (now: number) => {
      if (!logoSpinActiveRef.current) return
      if (logoSpinRampStartRef.current == null) logoSpinRampStartRef.current = now
      const elapsed = now - logoSpinRampStartRef.current
      const t = Math.max(0, Math.min(1, elapsed / LOGIN_RAMP_MS))
      const eased = t * t
      const spinMs = MAX_SPIN_MS - (MAX_SPIN_MS - MIN_SPIN_MS) * eased
      setLogoBoostSpinDurationMs(spinMs)
      if (t >= 1 && !logoLoginTriggeredRef.current) {
        logoLoginTriggeredRef.current = true
        logoSuppressClickRef.current = true
        stopLogoSpinRamp()
        if (sessionRef.current) {
          void signOut()
        } else {
          void signIn()
        }
        return
      }
      logoSpinRafRef.current = window.requestAnimationFrame(tick)
    }

    logoSpinRafRef.current = window.requestAnimationFrame(tick)
  }

  function onLogoPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return
    logoPointerStartRef.current = { x: e.clientX, y: e.clientY }
    logoPointerStartPhysicsRef.current = interactivePhysics
    logoLoginTriggeredRef.current = false
    clearLogoPressTimers()
    logoPhysicsPressTimerRef.current = window.setTimeout(() => {
      logoPhysicsPressTimerRef.current = null
      logoSuppressClickRef.current = true
      if (logoPointerStartPhysicsRef.current) {
        setInteractivePhysics(false)
      } else {
        setInteractivePhysics(true)
        logoAuthDwellTimerRef.current = window.setTimeout(() => {
          logoAuthDwellTimerRef.current = null
          startLogoSpinRamp()
        }, LOGO_PHYSICS_DWELL_BEFORE_AUTH_MS)
      }
    }, LOGO_PHYSICS_PRESS_MS)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onLogoPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const start = logoPointerStartRef.current
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (dx * dx + dy * dy > LONG_PRESS_MOVE_CANCEL_PX * LONG_PRESS_MOVE_CANCEL_PX) {
      clearLogoPressTimers()
      stopLogoSpinRamp()
    }
  }

  function onLogoPointerEnd(e: React.PointerEvent<HTMLButtonElement>) {
    clearLogoPressTimers()
    stopLogoSpinRamp()
    logoPointerStartRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* not captured */
    }
  }

  function maybePlayPinkMoon() {
    logoClickCountRef.current += 1
    if (logoClickCountRef.current < LOGO_PINK_MOON_CLICK_THRESHOLD) return
    logoClickCountRef.current = 0
    let audio = pinkMoonAudioRef.current
    if (!audio) {
      audio = new Audio(PINK_MOON_AUDIO_SRC)
      audio.preload = 'auto'
      pinkMoonAudioRef.current = audio
    }
    try {
      audio.currentTime = 0
    } catch {
      /* some browsers throw before metadata loads; ignore */
    }
    void audio.play().catch(() => {
      /* autoplay policies may block; user gesture should normally allow it */
    })
  }

  function onLogoClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (logoSuppressClickRef.current) {
      logoSuppressClickRef.current = false
      e.preventDefault()
      return
    }
    maybePlayPinkMoon()
    if (!sessionRef.current) return
    setFocusAuthNodeNonce((n) => n + 1)
  }

  const [bootPhase, setBootPhase] = useState<'pulse' | 'fadeOut' | 'idle'>('pulse')
  const resourcesReady = authSessionResolved && !graphLoading

  useLayoutEffect(() => {
    if (!resourcesReady || bootPhase !== 'pulse') return
    setBootPhase('fadeOut')
  }, [resourcesReady, bootPhase])

  const refreshGraphFromSql = useCallback(
    async (options?: { suppressLoadingSpinner?: boolean }) => {
      const suppress = options?.suppressLoadingSpinner ?? false
      if (!suppress) setGraphLoading(true)
      setGraphError(null)
      try {
        const dto = await fetchPublicGraph({
          maxNodes: publicInitialMaxNodes,
          includeLogin: session?.login,
        })
        setGraph(graphDtoToForceData(dto))
      } catch (e) {
        setGraph(null)
        setGraphError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!suppress) setGraphLoading(false)
      }
    },
    [publicInitialMaxNodes, session],
  )

  useEffect(() => {
    if (!authSessionResolved) return undefined

    let cancelled = false
    const id = window.setTimeout(() => {
      if (cancelled) return
      /* Avoid unloading the graph placeholder while swapping public ↔ owned (reduces flicker). */
      const suppressSpinner = (graphRefForRefresh.current?.nodes?.length ?? 0) > 0
      void refreshGraphFromSql({ suppressLoadingSpinner: suppressSpinner })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [refreshGraphFromSql, authSessionResolved])

  async function signIn() {
    if (!supabase) return
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: `${window.location.origin}/`,
        scopes: 'read:user',
      },
    })
    if (error) setError(error.message)
  }

  async function signOut() {
    if (!supabase) return
    setError(null)
    await supabase.auth.signOut()
    setSession(null)
  }

  const crawlFromLogin = useCallback(
    async (login: string) => {
      const target = login.trim()
      if (!target) return
      if (!session) {
        if (!supabase) return
        try {
          window.sessionStorage.setItem(PENDING_CRAWL_KEY, target)
        } catch {
          /* sessionStorage may be unavailable (private mode); fall through to sign-in. */
        }
        setError(null)
        const { error: oauthError } = await supabase.auth.signInWithOAuth({
          provider: 'github',
          options: {
            redirectTo: `${window.location.origin}/`,
            scopes: 'read:user',
          },
        })
        if (oauthError) setError(oauthError.message)
        return
      }
      setError(null)
      try {
        await expandGraphStream({
          supabaseAccessToken: session.supabaseAccessToken,
          githubAccessToken: session.githubAccessToken,
          rootLogin: target,
          maxFollowing: DEFAULT_EXPAND_MAX_FOLLOWING,
          maxFollowers: DEFAULT_EXPAND_MAX_FOLLOWERS,
          maxHopDepth: DEFAULT_EXPAND_MAX_HOP_DEPTH,
          throttleMs: DEFAULT_EXPAND_STREAM_THROTTLE_MS,
          onGraph: (dto) => {
            const incoming = graphDtoToForceData(dto)
            setGraph((prev) => mergeGraphDataAdditive(prev, incoming))
          },
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [session, refreshGraphFromSql],
  )

  // Resume a long-press crawl that was queued before the GitHub OAuth redirect.
  useEffect(() => {
    if (!session) return
    let pending: string | null
    try {
      pending = window.sessionStorage.getItem(PENDING_CRAWL_KEY)
    } catch {
      return
    }
    if (!pending) return
    try {
      window.sessionStorage.removeItem(PENDING_CRAWL_KEY)
    } catch {
      /* ignore */
    }
    // Defer to a microtask so the synchronous effect body doesn't appear to
    // call setState directly (crawlFromLogin will eventually call setLoading).
    const resumeLogin = pending
    const id = window.setTimeout(() => {
      void crawlFromLogin(resumeLogin)
    }, 0)
    return () => window.clearTimeout(id)
  }, [session, crawlFromLogin])

  if (!isSupabaseConfigured) {
    return (
      <div className="shell">
        <h1>Network</h1>
        <p className="muted">
          Missing <code>VITE_SUPABASE_URL</code> / <code>VITE_SUPABASE_ANON_KEY</code>. Copy{' '}
          <code>.env.example</code> → <code>apps/web/.env</code> and fill values.
        </p>
      </div>
    )
  }

  return (
    <div className="app-root-full">
      {error ? (
        <div className="banner error app-banner" role="alert">
          {error}
        </div>
      ) : null}
      {graphError ? (
        <div className="banner error app-banner" role="alert">
          {graphError}
        </div>
      ) : null}

      <div className="app-logo-slot">
        <button
          type="button"
          className={`app-logo-hit${interactivePhysics ? ' app-logo-physics-active' : ''}`}
          aria-pressed={interactivePhysics}
          onPointerDown={onLogoPointerDown}
          onPointerMove={onLogoPointerMove}
          onPointerUp={onLogoPointerEnd}
          onPointerCancel={onLogoPointerEnd}
          onLostPointerCapture={() => {
            clearLogoPressTimers()
            stopLogoSpinRamp()
          }}
          onClick={onLogoClick}
          aria-label={
            interactivePhysics
              ? 'Drag physics on. Press and hold to turn off.'
              : !session
                ? 'Hold to turn on drag physics, keep holding while it shakes, then keep holding until sign-in completes.'
                : 'Hold to turn on drag physics, keep holding while it shakes, then keep holding until sign-out completes.'
          }
        >
          <span className="app-logo-frame">
            <img
              className={`app-logo${interactivePhysics ? ' app-logo-shake' : ''}${logoBoostSpinActive ? ' app-logo-boost-spin' : ''}`}
              src={session ? '/logowhiteback.png' : '/logo-blackback.png'}
              alt=""
              style={{ ['--app-logo-spin-ms' as string]: `${Math.round(logoBoostSpinDurationMs)}ms` }}
            />
          </span>
        </button>
      </div>

      <div className="graph-host">
        {graph && graph.nodes.length > 0 ? (
          <NetworkGraph
            data={graph}
            focusLoginRequest={session ? { login: session.login, nonce: focusAuthNodeNonce } : null}
            interactivePhysics={interactivePhysics}
            authenticatedSession={session != null}
            onNodeCrawl={crawlFromLogin}
            onUiSurfaceChange={setUiSurfaceDark}
          />
        ) : (
          <div className="graph-surface-muted" aria-hidden />
        )}
      </div>

      {bootPhase !== 'idle' ? (
        <div
          className={`app-boot-veil${bootPhase === 'fadeOut' ? ' app-boot-veil--fade-out' : ''}`}
          aria-hidden
          onAnimationEnd={(e) => {
            if (bootPhase !== 'fadeOut') return
            if ((e.animationName ?? '') !== 'app-boot-fade-away') return
            setBootPhase('idle')
          }}
        >
          <div className="app-boot-veil__glow" />
        </div>
      ) : null}

    </div>
  )
}
