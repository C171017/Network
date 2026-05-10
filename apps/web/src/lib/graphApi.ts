export type GraphDTO = {
  rootLogin: string
  generatedAt: string
  caps: { maxFollowers: number; maxFollowing: number }
  truncation: {
    followersTotal: number | null
    followingTotal: number | null
    followersReturned: number
    followingReturned: number
  }
  nodes: Array<{
    githubId: number
    login: string
    avatarUrl: string
    name: string | null
    bio: string | null
    company: string | null
    location: string | null
    websiteUrl: string | null
    profileUrl: string
    isRoot: boolean
    depth: number
    expanded: 0 | 1
    /** Full GitHub `GET /users/{login}` payload when stored from crawl */
    profile: Record<string, unknown> | null
  }>
  edges: Array<{
    sourceGithubId: number
    targetGithubId: number
    kind: 'follows'
  }>
}

const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return apiBase ? `${apiBase}${p}` : p
}

export async function expandGraph(params: {
  supabaseAccessToken: string
  githubAccessToken: string
  rootLogin: string
  maxFollowing?: number
  maxFollowers?: number
}): Promise<GraphDTO> {
  const maxFollowing = params.maxFollowing ?? 5
  const res = await fetch(apiUrl('/api/graph/expand'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.supabaseAccessToken}`,
      'X-GitHub-Access-Token': params.githubAccessToken,
    },
    body: JSON.stringify({
      rootLogin: params.rootLogin,
      maxFollowing,
      ...(params.maxFollowers != null ? { maxFollowers: params.maxFollowers } : {}),
    }),
  })

  return parseGraphResponse(res)
}

async function parseGraphResponse(res: Response): Promise<GraphDTO> {
  const text = await res.text()
  let json: unknown
  try {
    json = JSON.parse(text) as unknown
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 500)}`)
  }
  if (!res.ok) {
    const err = json as { message?: string; error?: string }
    throw new Error(err.message ?? err.error ?? `Request failed (${res.status})`)
  }
  return json as GraphDTO
}

export async function fetchPublicGraph(): Promise<GraphDTO> {
  const res = await fetch(apiUrl('/api/graph/public'))
  return parseGraphResponse(res)
}

export async function fetchReachableGraph(params: {
  supabaseAccessToken: string
  rootLogin?: string
}): Promise<GraphDTO> {
  const q = params.rootLogin?.trim() ? `?rootLogin=${encodeURIComponent(params.rootLogin.trim())}` : ''
  const res = await fetch(apiUrl(`/api/graph/me${q}`), {
    headers: {
      Authorization: `Bearer ${params.supabaseAccessToken}`,
    },
  })
  return parseGraphResponse(res)
}
