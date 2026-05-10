const MIN_CLUSTER_OPACITY = 0.18
const MAX_CLUSTER_OPACITY = 0.95

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

/** d3 selection of an SVG g element */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function renderClusterContents(clusterSel: any, circles: ColorCircle[]): void {
  clusterSel.selectAll('circle').remove()
  if (!circles?.length) return

  const minDensity = circles.reduce((m, c) => Math.min(m, c.density), Number.POSITIVE_INFINITY)
  const maxDensity = circles.reduce((m, c) => Math.max(m, c.density), Number.NEGATIVE_INFINITY)
  const densityRange = Math.max(1e-9, maxDensity - minDensity)

  const sortedCircles = [...circles].sort((a, b) => b.radius - a.radius)
  sortedCircles.forEach((circle) => {
    const t = clamp01((circle.density - minDensity) / densityRange)
    const opacity = MIN_CLUSTER_OPACITY + (MAX_CLUSTER_OPACITY - MIN_CLUSTER_OPACITY) * Math.sqrt(t)
    clusterSel
      .append('circle')
      .attr('cx', circle.cx)
      .attr('cy', circle.cy)
      .attr('r', circle.radius)
      .attr('fill', circle.color)
      .attr('fill-opacity', opacity)
  })
}
