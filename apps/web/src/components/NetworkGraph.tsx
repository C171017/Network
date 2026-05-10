import ForceGraph2D from 'react-force-graph-2d'
import type { GraphDTO } from '../lib/graphApi'

export type GraphData = {
  nodes: Array<Record<string, unknown> & { id: number; login: string; isRoot?: boolean }>
  links: Array<{ source: number; target: number }>
}

export function graphDtoToForceData(dto: GraphDTO): GraphData {
  const nodes = dto.nodes.map((n) => ({
    id: n.githubId,
    login: n.login,
    name: n.name,
    bio: n.bio,
    location: n.location,
    avatarUrl: n.avatarUrl,
    isRoot: n.isRoot,
  }))
  const links = dto.edges.map((e) => ({
    source: e.sourceGithubId,
    target: e.targetGithubId,
  }))
  return { nodes, links }
}

type Props = {
  data: GraphData
}

export function NetworkGraph({ data }: Props) {
  return (
    <ForceGraph2D
      graphData={data}
      nodeId="id"
      nodeLabel={(n: { login?: string }) => n.login ?? ''}
      nodeAutoColorBy="isRoot"
      linkDirectionalParticles={1}
      linkDirectionalParticleWidth={1.2}
      cooldownTicks={120}
      d3AlphaDecay={0.02}
      d3VelocityDecay={0.35}
      nodeCanvasObject={(node, ctx, globalScale) => {
        if (node.x == null || node.y == null) return
        const label = (node as { login?: string }).login ?? ''
        const r = Math.max(3, 6 / globalScale)
        ctx.beginPath()
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false)
        ctx.fillStyle = (node as { isRoot?: boolean }).isRoot ? '#c084fc' : '#38bdf8'
        ctx.fill()
        if (globalScale > 0.55) {
          ctx.font = `${10 / globalScale}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillStyle = 'rgba(243,244,246,0.85)'
          ctx.fillText(label, node.x, node.y + r + 1 / globalScale)
        }
      }}
    />
  )
}
