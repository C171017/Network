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
  }>
  edges: Array<{
    sourceGithubId: number
    targetGithubId: number
    kind: 'follows'
  }>
}

export async function expandGraph(params: {
  supabaseAccessToken: string
  githubAccessToken: string
  rootLogin: string
  maxFollowers?: number
  maxFollowing?: number
}): Promise<GraphDTO> {
  const res = await fetch('/api/graph/expand', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.supabaseAccessToken}`,
      'X-GitHub-Access-Token': params.githubAccessToken,
    },
    body: JSON.stringify({
      rootLogin: params.rootLogin,
      maxFollowers: params.maxFollowers ?? 80,
      maxFollowing: params.maxFollowing ?? 80,
    }),
  })

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
