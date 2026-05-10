import type { GraphDTO } from '../../lib/graphApi'

/** Shape expected by the Columbia-style D3 graph (`id` + numeric link endpoints). */
export type VisualizationGraphData = {
  nodes: Array<Record<string, unknown> & { id: number }>
  links: Array<{ source: number; target: number }>
}

function githubProfileUrl(login: string, profileUrl: string | undefined): string {
  const t = (profileUrl ?? '').trim()
  if (t.length > 0) return t
  return `https://github.com/${encodeURIComponent(login)}`
}

export function graphDtoToVisualizationData(dto: GraphDTO): VisualizationGraphData {
  const nodes = dto.nodes.map((n) => ({
    id: n.githubId,
    githubId: n.githubId,
    login: n.login,
    name: n.name,
    bio: n.bio,
    company: n.company,
    location: n.location,
    profileUrl: githubProfileUrl(n.login, n.profileUrl),
    websiteUrl: n.websiteUrl ?? null,
    depth: 'depth' in n && typeof n.depth === 'number' ? n.depth : 0,
    expanded: 'expanded' in n && (n.expanded === 0 || n.expanded === 1) ? n.expanded : 0,
    isRoot: n.isRoot,
    avatarUrl: n.avatarUrl,
    profile: n.profile ?? null,
  }))
  const links = dto.edges.map((e) => ({
    source: e.sourceGithubId,
    target: e.targetGithubId,
  }))
  return { nodes, links }
}
