import type { GraphDTO } from '../../lib/graphApi'

/** Shape expected by the Columbia-style D3 graph (`id` + numeric link endpoints). */
export type VisualizationGraphData = {
  nodes: Array<Record<string, unknown> & { id: number }>
  links: Array<{ source: number; target: number }>
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
    depth: 'depth' in n && typeof n.depth === 'number' ? n.depth : 0,
    expanded: 'expanded' in n && (n.expanded === 0 || n.expanded === 1) ? n.expanded : 0,
    isRoot: n.isRoot,
    avatarUrl: n.avatarUrl,
  }))
  const links = dto.edges.map((e) => ({
    source: e.sourceGithubId,
    target: e.targetGithubId,
  }))
  return { nodes, links }
}
