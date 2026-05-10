import { CIRCLE_CX, CIRCLE_CY, NODE_MOVE_MAX_RADIUS_FROM_CENTER, NODE_RADIUS } from './graphConstants'

export function clampNodeCenterToMovableDisk(x: number, y: number): { x: number; y: number } {
  const dx = x - CIRCLE_CX
  const dy = y - CIRCLE_CY
  const dist = Math.hypot(dx, dy)
  if (!Number.isFinite(dist) || dist === 0 || dist <= NODE_MOVE_MAX_RADIUS_FROM_CENTER) {
    return { x, y }
  }
  const s = NODE_MOVE_MAX_RADIUS_FROM_CENTER / dist
  return { x: CIRCLE_CX + dx * s, y: CIRCLE_CY + dy * s }
}

export function clampNodesInPlace(nodes: Array<{ x?: number; y?: number }>): void {
  nodes.forEach((n) => {
    if (n.x == null || n.y == null) return
    const c = clampNodeCenterToMovableDisk(n.x, n.y)
    n.x = c.x
    n.y = c.y
  })
}

type SimNode = { x: number; y: number }
type SimLink = { source: SimNode; target: SimNode }

export function linkPath(d: SimLink | null | undefined): string {
  if (!d?.source || !d.target) return 'M0,0L0,0'
  if (typeof d.source.x === 'undefined' || typeof d.target.x === 'undefined') return 'M0,0L0,0'

  const dx = d.target.x - d.source.x
  const dy = d.target.y - d.source.y
  const dist = Math.hypot(dx, dy)
  if (dist === 0) return 'M0,0L0,0'

  const unitX = dx / dist
  const unitY = dy / dist
  const startX = d.source.x + unitX * NODE_RADIUS
  const startY = d.source.y + unitY * NODE_RADIUS
  const endX = d.target.x - unitX * NODE_RADIUS
  const endY = d.target.y - unitY * NODE_RADIUS
  return `M${startX},${startY}L${endX},${endY}`
}

export function arrowPathAtFraction(d: SimLink | null | undefined, fraction = 1 / 3): string {
  if (!d?.source || !d.target) return 'M0,0L0,0'
  if (typeof d.source.x === 'undefined' || typeof d.target.x === 'undefined') return 'M0,0L0,0'

  const dx = d.target.x - d.source.x
  const dy = d.target.y - d.source.y
  const dist = Math.hypot(dx, dy)
  if (dist === 0) return 'M0,0L0,0'

  const ux = dx / dist
  const uy = dy / dist
  const sx = d.source.x + ux * NODE_RADIUS
  const sy = d.source.y + uy * NODE_RADIUS
  const ex = d.source.x + dx * fraction
  const ey = d.source.y + dy * fraction
  return `M${sx},${sy}L${ex},${ey}`
}

export function linkSegment(
  d: SimLink | null | undefined
): { x1: number; y1: number; x2: number; y2: number } | null {
  if (!d?.source || !d.target) return null
  const dx = d.target.x - d.source.x
  const dy = d.target.y - d.source.y
  const dist = Math.hypot(dx, dy)
  if (dist === 0) return null
  const unitX = dx / dist
  const unitY = dy / dist
  return {
    x1: d.source.x + unitX * NODE_RADIUS,
    y1: d.source.y + unitY * NODE_RADIUS,
    x2: d.target.x - unitX * NODE_RADIUS,
    y2: d.target.y - unitY * NODE_RADIUS,
  }
}

export function arrowSegment(
  d: SimLink | null | undefined,
  fraction = 1 / 3
): { x1: number; y1: number; x2: number; y2: number; ux: number; uy: number } | null {
  if (!d?.source || !d.target) return null
  const dx = d.target.x - d.source.x
  const dy = d.target.y - d.source.y
  const dist = Math.hypot(dx, dy)
  if (dist === 0) return null
  const ux = dx / dist
  const uy = dy / dist
  return {
    x1: d.source.x + ux * NODE_RADIUS,
    y1: d.source.y + uy * NODE_RADIUS,
    x2: d.source.x + dx * fraction,
    y2: d.source.y + dy * fraction,
    ux,
    uy,
  }
}
