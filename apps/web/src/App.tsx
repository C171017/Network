import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import NetworkGraph from './components/NetworkGraph'
import { graphDtoToForceData, type GraphData } from './graph/graphDto'
import { expandGraph, fetchPublicGraph, fetchReachableGraph } from './lib/graphApi'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import './App.css'

type SessionInfo = {
  supabaseAccessToken: string
  githubAccessToken: string
  login: string
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

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [graphLoading, setGraphLoading] = useState(true)
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [rootOverride, setRootOverride] = useState('')

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

  async function loadGraph() {
    if (!session || !effectiveRoot) return
    setLoading(true)
    setError(null)
    try {
      await expandGraph({
        supabaseAccessToken: session.supabaseAccessToken,
        githubAccessToken: session.githubAccessToken,
        rootLogin: effectiveRoot,
      })
      await refreshGraphFromSql()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
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

      <div className="graph-host">
        {graph && graph.nodes.length > 0 ? (
          <NetworkGraph data={graph} />
        ) : graphLoading ? (
          <div className="graph-placeholder">Loading graph from database…</div>
        ) : (
          <div className="graph-placeholder">
            No nodes in the local graph database yet. Sign in and use &quot;Expand from GitHub&quot; to crawl follows into
            SQLite.
          </div>
        )}
      </div>

      <div className="auth-chrome glass-chrome">
        <div className="chrome-title">Network</div>
        <p className="chrome-hint">
          {session ? 'Your view: reachable subgraph from your login.' : 'Public view: all stored nodes and edges.'}
        </p>
        {!session ? (
          <button type="button" className="chrome-btn primary" onClick={() => void signIn()}>
            Sign in with GitHub
          </button>
        ) : (
          <>
            <span className="chrome-pill">@{session.login}</span>
            <button type="button" className="chrome-btn" onClick={() => void signOut()}>
              Sign out
            </button>
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
              onClick={() => void loadGraph()}
            >
              {loading ? 'Expanding…' : 'Expand from GitHub'}
            </button>
          </>
        )}
        <p className="chrome-footer muted">
          API <code>:8787</code> · Vite proxies <code>/api</code>
        </p>
      </div>
    </div>
  )
}
