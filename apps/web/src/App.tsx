import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import NetworkGraph from './components/NetworkGraph'
import { graphDtoToForceData, type GraphData } from './graph/graphDto'
import { expandGraph, fetchPublicGraph, fetchReachableGraph } from './lib/graphApi'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import { LONG_PRESS_MS, LONG_PRESS_MOVE_CANCEL_PX } from './graph/columbia/graphConstants'
import './App.css'

type SessionInfo = {
  supabaseAccessToken: string
  githubAccessToken: string
  login: string
}

/** Persisted across the GitHub OAuth redirect so a long-press crawl can resume after sign-in. */
const PENDING_CRAWL_KEY = 'network:pendingCrawlLogin'

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

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [graphLoading, setGraphLoading] = useState(true)
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [rootOverride, setRootOverride] = useState('')
  /** Matches graph chrome (dark inner disk vs light outer); default dark for page background before graph reports. */
  const [uiSurfaceDark, setUiSurfaceDark] = useState(true)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  /** Graph “drag physics” — toggled by long-pressing the logo (same duration as node long-press). */
  const [interactivePhysics, setInteractivePhysics] = useState(false)
  const logoLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logoSuppressClickRef = useRef(false)
  const logoPointerStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!supabase) return

    let cancelled = false
    void supabase.auth.getSession().then(({ data }) => {
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
    if (!accountMenuOpen) return
    function onPointerDown(e: PointerEvent) {
      const el = accountMenuRef.current
      if (!el?.contains(e.target as Node)) setAccountMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setAccountMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [accountMenuOpen])

  useEffect(() => {
    return () => {
      if (logoLongPressTimerRef.current != null) {
        window.clearTimeout(logoLongPressTimerRef.current)
        logoLongPressTimerRef.current = null
      }
    }
  }, [])

  function clearLogoLongPressTimer() {
    if (logoLongPressTimerRef.current != null) {
      window.clearTimeout(logoLongPressTimerRef.current)
      logoLongPressTimerRef.current = null
    }
  }

  function onLogoPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return
    logoPointerStartRef.current = { x: e.clientX, y: e.clientY }
    clearLogoLongPressTimer()
    logoLongPressTimerRef.current = window.setTimeout(() => {
      logoLongPressTimerRef.current = null
      logoSuppressClickRef.current = true
      setInteractivePhysics((v) => !v)
      setAccountMenuOpen(false)
    }, LONG_PRESS_MS)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onLogoPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const start = logoPointerStartRef.current
    if (!start || logoLongPressTimerRef.current == null) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (dx * dx + dy * dy > LONG_PRESS_MOVE_CANCEL_PX * LONG_PRESS_MOVE_CANCEL_PX) {
      clearLogoLongPressTimer()
    }
  }

  function onLogoPointerEnd(e: React.PointerEvent<HTMLButtonElement>) {
    clearLogoLongPressTimer()
    logoPointerStartRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* not captured */
    }
  }

  function onLogoClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (logoSuppressClickRef.current) {
      logoSuppressClickRef.current = false
      e.preventDefault()
      return
    }
    setAccountMenuOpen((o) => !o)
  }

  const effectiveRoot = (rootOverride.trim() || session?.login || '').trim()

  const refreshGraphFromSql = useCallback(async () => {
    setGraphLoading(true)
    setGraphError(null)
    try {
      if (!session) {
        const dto = await fetchPublicGraph()
        setGraph(graphDtoToForceData(dto))
      } else {
        const dto = await fetchReachableGraph({
          supabaseAccessToken: session.supabaseAccessToken,
        })
        setGraph(graphDtoToForceData(dto))
      }
    } catch (e) {
      setGraph(null)
      setGraphError(e instanceof Error ? e.message : String(e))
    } finally {
      setGraphLoading(false)
    }
  }, [session])

  useEffect(() => {
    let cancelled = false
    const id = window.setTimeout(() => {
      if (cancelled) return
      void refreshGraphFromSql()
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [refreshGraphFromSql])

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
      setLoading(true)
      setError(null)
      try {
        await expandGraph({
          supabaseAccessToken: session.supabaseAccessToken,
          githubAccessToken: session.githubAccessToken,
          rootLogin: target,
        })
        await refreshGraphFromSql()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
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

  async function loadGraph() {
    if (!effectiveRoot) return
    await crawlFromLogin(effectiveRoot)
  }

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

      <div className="app-logo-slot" ref={accountMenuRef}>
        <button
          type="button"
          className={`app-logo-hit${interactivePhysics ? ' app-logo-physics-active' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={accountMenuOpen}
          aria-controls={accountMenuOpen ? 'account-menu' : undefined}
          aria-pressed={interactivePhysics}
          onPointerDown={onLogoPointerDown}
          onPointerMove={onLogoPointerMove}
          onPointerUp={onLogoPointerEnd}
          onPointerCancel={onLogoPointerEnd}
          onLostPointerCapture={() => clearLogoLongPressTimer()}
          onClick={onLogoClick}
          aria-label={
            interactivePhysics
              ? 'Account menu. Drag physics on; long press to turn off.'
              : 'Account menu. Long press to turn on drag physics.'
          }
        >
          <span className="app-logo-frame">
            <img
              className={`app-logo${interactivePhysics ? ' app-logo-shake' : ''}`}
              src={uiSurfaceDark ? '/logo-blackback.png' : '/logo-whiteback.png'}
              alt=""
            />
          </span>
        </button>
        {accountMenuOpen ? (
          <div
            id="account-menu"
            className="auth-popover glass-chrome"
            role="dialog"
            aria-label={session ? 'Account' : 'Sign in'}
          >
            {!session ? (
              <>
                <div className="auth-popover-title">Sign in</div>
                <p className="auth-popover-hint">
                  GitHub hosts the actual login page. Continue there to authorize this app.
                </p>
                <button
                  type="button"
                  className="chrome-btn primary"
                  onClick={() => {
                    setAccountMenuOpen(false)
                    void signIn()
                  }}
                >
                  Continue with GitHub
                </button>
              </>
            ) : (
              <>
                <div className="auth-popover-title">Account</div>
                <span className="chrome-pill">@{session.login}</span>
                <button
                  type="button"
                  className="chrome-btn"
                  onClick={() => {
                    setAccountMenuOpen(false)
                    void signOut()
                  }}
                >
                  Sign out
                </button>
                <p className="auth-popover-hint auth-popover-hint-tight">
                  No hosted sign-out URL—this only ends the session in this browser.
                </p>
                <div className="auth-popover-crawl">
                  <label className="chrome-field">
                    <span>Root for GitHub crawl</span>
                    <input
                      value={rootOverride}
                      onChange={(e) => setRootOverride(e.target.value)}
                      placeholder={`default: ${session.login}`}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                    />
                  </label>
                  <button
                    type="button"
                    className="chrome-btn primary"
                    disabled={loading || !effectiveRoot}
                    onClick={() => {
                      void loadGraph()
                      setAccountMenuOpen(false)
                    }}
                  >
                    {loading ? 'Expanding…' : 'Expand from GitHub'}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="graph-host">
        {graph && graph.nodes.length > 0 ? (
          <NetworkGraph
            data={graph}
            interactivePhysics={interactivePhysics}
            authenticatedSession={session != null}
            onNodeCrawl={crawlFromLogin}
            onUiSurfaceChange={setUiSurfaceDark}
          />
        ) : graphLoading ? (
          <div className="graph-placeholder">Loading graph from database…</div>
        ) : (
          <div className="graph-placeholder">
            No nodes in the local graph database yet. Use the logo menu to sign in, then &quot;Expand from GitHub&quot; to crawl
            follows into SQLite.
          </div>
        )}
      </div>

    </div>
  )
}
