const MIN_CLUSTER_OPACITY = 0.18
const MAX_CLUSTER_OPACITY = 0.95

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export type ColorCircle = {
  color: string
  /** Representative avatar for this color bucket (first non-empty in group). */
  avatarUrl: string
  count: number
  cx: number
  cy: number
  radius: number
  density: number
}

/** d3 selection of an SVG g element */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function renderClusterContents(clusterSel: any, circles: ColorCircle[]): void {
  clusterSel.selectAll('circle').remove()
  clusterSel.selectAll('image').remove()
  clusterSel.selectAll('defs').remove()
  if (!circles?.length) return

  const minDensity = circles.reduce((m, c) => Math.min(m, c.density), Number.POSITIVE_INFINITY)
  const maxDensity = circles.reduce((m, c) => Math.max(m, c.density), Number.NEGATIVE_INFINITY)
  const densityRange = Math.max(1e-9, maxDensity - minDensity)

  const giAttr = clusterSel.attr('data-gi')
  const giPrefix = giAttr != null && giAttr !== '' ? String(giAttr) : 'c'

  const sortedCircles = [...circles].sort((a, b) => b.radius - a.radius)
  sortedCircles.forEach((circle, i) => {
    const t = clamp01((circle.density - minDensity) / densityRange)
    const opacity = MIN_CLUSTER_OPACITY + (MAX_CLUSTER_OPACITY - MIN_CLUSTER_OPACITY) * Math.sqrt(t)
    const avatarUrl = String(circle.avatarUrl ?? '').trim()

    if (avatarUrl) {
      const clipId = `cluster-avatar-clip-${giPrefix}-${i}`
      clusterSel.append('defs')
        .append('clipPath')
        .attr('id', clipId)
        .append('circle')
        .attr('cx', circle.cx)
        .attr('cy', circle.cy)
        .attr('r', circle.radius)
      clusterSel
        .append('image')
        .attr('href', avatarUrl)
        .attr('x', circle.cx - circle.radius)
        .attr('y', circle.cy - circle.radius)
        .attr('width', circle.radius * 2)
        .attr('height', circle.radius * 2)
        .attr('preserveAspectRatio', 'xMidYMid slice')
        .attr('clip-path', `url(#${clipId})`)
        .attr('opacity', opacity)
    } else {
      clusterSel
        .append('circle')
        .attr('cx', circle.cx)
        .attr('cy', circle.cy)
        .attr('r', circle.radius)
        .attr('fill', circle.color)
        .attr('fill-opacity', opacity)
    }
  })
}
