const MIN_CLUSTER_OPACITY = 0.18
const MAX_CLUSTER_OPACITY = 0.95

const MIN_CLUSTER_COLOR_RADIUS = 14
const MIN_CLUSTER_AREA = Math.PI * MIN_CLUSTER_COLOR_RADIUS * MIN_CLUSTER_COLOR_RADIUS

const CLUSTER_EXCLUDED_COLORS = new Set([
  '#9e9e9e',
  '#999999',
  '#808080',
  'gray',
  'grey',
])

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export type ColorCircle = {
  color: string
  count: number
  cx: number
  cy: number
  radius: number
  density: number
}

export function shouldExcludeClusterColor(color: unknown): boolean {
  if (color == null) return true
  return CLUSTER_EXCLUDED_COLORS.has(String(color).trim().toLowerCase())
}

export function buildColorClusterCircles(
  groupNodes: Array<Record<string, unknown> & { x: number; y: number }>,
  getNodeColor: (n: Record<string, unknown> & { x: number; y: number }) => string,
  groupCenter: { x: number; y: number }
): ColorCircle[] {
  const nodesByColor = new Map<string, typeof groupNodes>()
  groupNodes.forEach((n) => {
    const color = getNodeColor(n)
    if (shouldExcludeClusterColor(color)) return
    if (!nodesByColor.has(color)) nodesByColor.set(color, [])
    nodesByColor.get(color)!.push(n)
  })

  const circles: ColorCircle[] = []
  nodesByColor.forEach((nodes, color) => {
    if (!nodes.length) return

    let bestDx = 0
    let bestDy = 0
    let maxDistSq = 0
    let midX = nodes[0]!.x
    let midY = nodes[0]!.y

    if (nodes.length > 1) {
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const dx = nodes[j]!.x - nodes[i]!.x
          const dy = nodes[j]!.y - nodes[i]!.y
          const distSq = dx * dx + dy * dy
          if (distSq > maxDistSq) {
            maxDistSq = distSq
            bestDx = dx
            bestDy = dy
            midX = (nodes[i]!.x + nodes[j]!.x) / 2
            midY = (nodes[i]!.y + nodes[j]!.y) / 2
          }
        }
      }
    }

    const furthestDistance = Math.sqrt(bestDx * bestDx + bestDy * bestDy)
    const rawRadius = furthestDistance / 2
    const radius = Math.max(MIN_CLUSTER_COLOR_RADIUS, rawRadius)
    const area = Math.max(MIN_CLUSTER_AREA, Math.PI * radius * radius)
    const density = nodes.length / area

    circles.push({
      color,
      count: nodes.length,
      cx: midX - groupCenter.x,
      cy: midY - groupCenter.y,
      radius,
      density,
    })
  })

  return circles
}

export function clusterCircleDrawStyle(circles: ColorCircle[]): Array<ColorCircle & { opacity: number }> {
  if (!circles.length) return []
  const minDensity = circles.reduce((m, c) => Math.min(m, c.density), Number.POSITIVE_INFINITY)
  const maxDensity = circles.reduce((m, c) => Math.max(m, c.density), Number.NEGATIVE_INFINITY)
  const densityRange = Math.max(1e-9, maxDensity - minDensity)

  const sorted = [...circles].sort((a, b) => b.radius - a.radius)
  return sorted.map((circle) => {
    const t = clamp01((circle.density - minDensity) / densityRange)
    const opacity = MIN_CLUSTER_OPACITY + (MAX_CLUSTER_OPACITY - MIN_CLUSTER_OPACITY) * Math.sqrt(t)
    return { ...circle, opacity }
  })
}
