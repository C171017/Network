import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import { expandGraph } from './lib/graphApi'
import { NetworkGraph, graphDtoToForceData, type GraphData } from './components/NetworkGraph'
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
  const [loading, setLoading] = useState(false)
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
        setGraph(null)
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
    setGraph(null)
    await supabase.auth.signOut()
    setSession(null)
  }

  async function loadGraph() {
    if (!session || !effectiveRoot) return
    setLoading(true)
    setError(null)
    try {
      const dto = await expandGraph({
        supabaseAccessToken: session.supabaseAccessToken,
        githubAccessToken: session.githubAccessToken,
        rootLogin: effectiveRoot,
      })
      setGraph(graphDtoToForceData(dto))
    } catch (e) {
      setGraph(null)
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
    <div className="shell">
      <header className="top">
        <div>
          <h1>Network</h1>
          <p className="muted">Sign in with GitHub, then load a bounded follow graph.</p>
        </div>
        <div className="actions">
          {!session ? (
            <button type="button" className="btn primary" onClick={() => void signIn()}>
              Sign in with GitHub
            </button>
          ) : (
            <>
              <span className="pill">@{session.login}</span>
              <button type="button" className="btn" onClick={() => void signOut()}>
                Sign out
              </button>
            </>
          )}
        </div>
      </header>

      {session ? (
        <section className="controls">
          <label className="field">
            <span>Root GitHub login</span>
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
            className="btn primary"
            disabled={loading || !effectiveRoot}
            onClick={() => void loadGraph()}
          >
            {loading ? 'Loading…' : 'Load graph'}
          </button>
        </section>
      ) : null}

      {error ? (
        <div className="banner error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="graph">
        {graph ? (
          <NetworkGraph data={graph} />
        ) : (
          <div className="graph-placeholder">Graph appears here after you click “Load graph”.</div>
        )}
      </section>

      <footer className="footer muted">
        Dev: run <code>npm run dev:server</code> (API on <code>:8787</code>) and <code>npm run dev</code> (Vite). Vite
        proxies <code>/api</code> → the API.
      </footer>
    </div>
  )
}
