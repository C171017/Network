/**
 * Non-physics overlap separation (replaces d3.forceCollide radius 120 intent).
 */

import { clampNodeCenterToMovableDisk } from './geometry'

export const COLLISION_RADIUS = 120
const MIN_CENTER_DIST = 2 * COLLISION_RADIUS

type Pos = { x: number; y: number }

function separatePair(a: Pos, b: Pos): void {
  let dx = b.x - a.x
  let dy = b.y - a.y
  let dist = Math.hypot(dx, dy)
  if (dist === 0) {
    dx = 0.01
    dy = 0
    dist = 0.01
  }
  if (dist >= MIN_CENTER_DIST) return
  const overlap = (MIN_CENTER_DIST - dist) / 2
  const ux = dx / dist
  const uy = dy / dist
  a.x -= ux * overlap
  a.y -= uy * overlap
  b.x += ux * overlap
  b.y += uy * overlap
}

export function resolveOverlaps(nodes: Pos[], passes = 18): void {
  const n = nodes.length
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        separatePair(nodes[i]!, nodes[j]!)
      }
    }
    for (const node of nodes) {
      const c = clampNodeCenterToMovableDisk(node.x, node.y)
      node.x = c.x
      node.y = c.y
    }
  }
}
