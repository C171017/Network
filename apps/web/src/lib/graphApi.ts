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
    /** Owner-relative shortest-hop distance from authenticated root (root=1). */
    degree: number
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

export type ExpandProgressEvent =
  | { type: 'node'; node: GraphDTO['nodes'][number] }
  | { type: 'edge'; edge: GraphDTO['edges'][number] }
  | { type: 'done'; summary: GraphDTO }
  | { type: 'error'; message: string }

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
  const maxFollowing = params.maxFollowing ?? 2
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

function edgeDedupeKey(e: GraphDTO['edges'][number]): string {
  return `${e.sourceGithubId}->${e.targetGithubId}`
}

function emptyTruncation(): GraphDTO['truncation'] {
  return {
    followersTotal: null,
    followingTotal: null,
    followersReturned: 0,
    followingReturned: 0,
  }
}

/** Merge NDJSON crawl events into a partial graph for incremental UI updates. */
export function accumulateExpandProgress(
  acc: {
    nodeById: Map<number, GraphDTO['nodes'][number]>
    edgeKeys: Set<string>
    edges: GraphDTO['edges']
    caps: GraphDTO['caps']
    truncation: GraphDTO['truncation']
  },
  ev: ExpandProgressEvent,
): void {
  if (ev.type === 'node') {
    acc.nodeById.set(ev.node.githubId, ev.node)
    return
  }
  if (ev.type === 'edge') {
    const k = edgeDedupeKey(ev.edge)
    if (!acc.edgeKeys.has(k)) {
      acc.edgeKeys.add(k)
      acc.edges.push(ev.edge)
    }
    return
  }
  if (ev.type === 'done') {
    acc.caps = ev.summary.caps
    acc.truncation = ev.summary.truncation
    acc.nodeById.clear()
    for (const n of ev.summary.nodes) acc.nodeById.set(n.githubId, n)
    acc.edgeKeys.clear()
    acc.edges.length = 0
    acc.edges.push(...ev.summary.edges)
    for (const e of ev.summary.edges) acc.edgeKeys.add(edgeDedupeKey(e))
  }
}

function accumulatorToDTO(acc: {
  nodeById: Map<number, GraphDTO['nodes'][number]>
  edges: GraphDTO['edges']
  caps: GraphDTO['caps']
  truncation: GraphDTO['truncation']
}, rootGuess: string): GraphDTO {
  const rootLogin =
    rootGuess.trim() ||
    [...acc.nodeById.values()].find((n) => n.isRoot)?.login ||
    [...acc.nodeById.values()][0]?.login ||
    ''
  return {
    rootLogin,
    generatedAt: new Date().toISOString(),
    caps: acc.caps,
    truncation: acc.truncation,
    nodes: [...acc.nodeById.values()],
    edges: [...acc.edges],
  }
}

/** Default throttle between incremental graph paints (Columbia rebuilds physics on each `data` update). */
export const DEFAULT_EXPAND_STREAM_THROTTLE_MS = 250

export type ExpandGraphStreamParams = {
  supabaseAccessToken: string
  githubAccessToken: string
  rootLogin: string
  maxFollowing?: number
  maxFollowers?: number
}

export async function expandGraphStream(params: ExpandGraphStreamParams & {
  onGraph: (dto: GraphDTO) => void
  throttleMs?: number
  signal?: AbortSignal
}): Promise<GraphDTO> {
  const maxFollowing = params.maxFollowing ?? 2
  const maxFollowers = params.maxFollowers ?? maxFollowing
  const throttleMs = params.throttleMs ?? DEFAULT_EXPAND_STREAM_THROTTLE_MS
  const rootLoginTrimmed = params.rootLogin.trim()

  const acc = {
    nodeById: new Map<number, GraphDTO['nodes'][number]>(),
    edgeKeys: new Set<string>(),
    edges: [] as GraphDTO['edges'],
    caps: { maxFollowing, maxFollowers },
    truncation: emptyTruncation(),
  }

  let throttleTimer: ReturnType<typeof setTimeout> | null = null
  const flushIncremental = () => {
    throttleTimer = null
    params.onGraph(accumulatorToDTO(acc, rootLoginTrimmed))
  }
  const scheduleFlush = () => {
    if (throttleMs <= 0) {
      flushIncremental()
      return
    }
    if (throttleTimer != null) return
    throttleTimer = setTimeout(flushIncremental, throttleMs)
  }
  const cancelThrottle = () => {
    if (throttleTimer != null) clearTimeout(throttleTimer)
    throttleTimer = null
  }

  const res = await fetch(apiUrl('/api/graph/expand-stream'), {
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
    signal: params.signal,
  })

  if (!res.ok) {
    await throwFromBadResponse(res)
  }

  const reader = res.body?.getReader()
  if (!reader) {
    throw new Error('Expand stream missing response body')
  }

  const dec = new TextDecoder()
  let buf = ''
  let sawDone = false
  let summary: GraphDTO | null = null

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        let parsed: ExpandProgressEvent
        try {
          parsed = JSON.parse(line) as ExpandProgressEvent
        } catch {
          continue
        }
        if (parsed.type === 'error') {
          throw new Error(parsed.message || 'expand_stream_error')
        }
        if (parsed.type === 'done') {
          cancelThrottle()
          accumulateExpandProgress(acc, parsed)
          summary = parsed.summary
          params.onGraph(parsed.summary)
          sawDone = true
          continue
        }
        accumulateExpandProgress(acc, parsed)
        // First node (usually root) paints immediately; later updates are throttled for D3 rebuild cost.
        if (parsed.type === 'node' && acc.nodeById.size === 1) {
          cancelThrottle()
          flushIncremental()
        } else {
          scheduleFlush()
        }
      }
    }

    const tail = buf.trim()
    if (tail) {
      try {
        const parsed = JSON.parse(tail) as ExpandProgressEvent
        if (parsed.type === 'error') {
          throw new Error(parsed.message || 'expand_stream_error')
        }
        if (parsed.type === 'done') {
          cancelThrottle()
          accumulateExpandProgress(acc, parsed)
          summary = parsed.summary
          params.onGraph(parsed.summary)
          sawDone = true
        } else if (parsed.type === 'node' || parsed.type === 'edge') {
          accumulateExpandProgress(acc, parsed)
          if (parsed.type === 'node' && acc.nodeById.size === 1) {
            cancelThrottle()
            flushIncremental()
          } else {
            scheduleFlush()
          }
        }
      } catch {
        /* ignore dangling partial chunk */
      }
    }
  } finally {
    cancelThrottle()
  }

  if (!sawDone || summary == null) {
    throw new Error('Expand stream closed before crawl finished')
  }
  return summary
}

async function throwFromBadResponse(res: Response): Promise<never> {
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as { message?: string; error?: string }
  } catch {
    throw new Error(`Expand stream HTTP ${res.status}: ${text.slice(0, 500)}`)
  }
  const o = parsed as { message?: string; error?: string }
  throw new Error(o.message ?? o.error ?? `Request failed (${res.status})`)
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

export async function fetchOwnedGraph(params: {
  supabaseAccessToken: string
}): Promise<GraphDTO> {
  const res = await fetch(apiUrl('/api/graph/me?scope=owner'), {
    headers: {
      Authorization: `Bearer ${params.supabaseAccessToken}`,
    },
  })
  return parseGraphResponse(res)
}
