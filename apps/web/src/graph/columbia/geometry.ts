import {
  CIRCLE_CX,
  CIRCLE_CY,
  LINK_WEDGE_MUTUAL_OFFSET,
  LINK_WEDGE_SOURCE_HALF_WIDTH,
  LINK_WEDGE_TARGET_HALF_WIDTH,
  NODE_MOVE_MAX_RADIUS_FROM_CENTER,
  NODE_RADIUS
} from './graphConstants'

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
type WedgeLink = SimLink & { __isMutual?: boolean }

/**
 * Filled-quad path for a directed link, tapering from a wider source end
 * to a near-point at the target. The wedge geometry itself encodes
 * direction — no separate arrowhead marker required.
 *
 * When the link is part of a mutual pair (`__isMutual`), the whole wedge is
 * shifted perpendicularly by `LINK_WEDGE_MUTUAL_OFFSET`. The reverse edge in
 * the same pair has a flipped forward direction, so applying the same
 * +offset along its own perpendicular naturally lands it on the opposite
 * visual side, producing a "two-lane road" indicator of bidirectionality.
 */
export function linkWedgePath(d: WedgeLink | null | undefined): string {
  if (!d?.source || !d.target) return 'M0,0Z'
  if (typeof d.source.x === 'undefined' || typeof d.target.x === 'undefined') return 'M0,0Z'

  const dx = d.target.x - d.source.x
  const dy = d.target.y - d.source.y
  const dist = Math.hypot(dx, dy)
  if (dist === 0) return 'M0,0Z'

  const ux = dx / dist
  const uy = dy / dist
  // CCW perpendicular to the forward direction.
  const px = -uy
  const py = ux

  const off = d.__isMutual ? LINK_WEDGE_MUTUAL_OFFSET : 0
  const ox = px * off
  const oy = py * off

  // Centerline anchors, offset out of source/target node disks plus the
  // (optional) mutual-pair perpendicular shift.
  const sx = d.source.x + ux * NODE_RADIUS + ox
  const sy = d.source.y + uy * NODE_RADIUS + oy
  const tx = d.target.x - ux * NODE_RADIUS + ox
  const ty = d.target.y - uy * NODE_RADIUS + oy

  const Ws = LINK_WEDGE_SOURCE_HALF_WIDTH
  const Wt = LINK_WEDGE_TARGET_HALF_WIDTH

  // Trapezoid corners in CCW order:
  //   source-left → source-right → target-right → target-left.
  const ax = sx + px * Ws
  const ay = sy + py * Ws
  const bx = sx - px * Ws
  const by = sy - py * Ws
  const cx = tx - px * Wt
  const cy = ty - py * Wt
  const ex = tx + px * Wt
  const ey = ty + py * Wt

  return `M${ax},${ay}L${bx},${by}L${cx},${cy}L${ex},${ey}Z`
}

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
