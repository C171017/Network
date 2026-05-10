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

/** Endpoints on the node circles + chord frame (perpendicular used for Bézier offset). */
export type LinkChordGeometry = {
  sx: number
  sy: number
  ex: number
  ey: number
  /** Unit vector along center line source → target. */
  ux: number
  uy: number
  /** Unit perpendicular (90° CCW from u), used to offset control point. */
  px: number
  py: number
  chordLen: number
}

/**
 * Attachment points on each node's circle along the center line. When centers are
 * closer than two radii, insets shrink so endpoints stay on their circles and
 * never cross past each other.
 */
export function linkChordGeometry(d: SimLink | null | undefined): LinkChordGeometry | null {
  if (!d?.source || !d.target) return null
  if (typeof d.source.x === 'undefined' || typeof d.target.x === 'undefined') return null

  const dx = d.target.x - d.source.x
  const dy = d.target.y - d.source.y
  const dist = Math.hypot(dx, dy)
  if (dist === 0 || !Number.isFinite(dist)) return null

  const ux = dx / dist
  const uy = dy / dist
  const px = -uy
  const py = ux

  const safeHalf = Math.max(0.5, dist * 0.5 - 0.5)
  const inset = Math.min(NODE_RADIUS, safeHalf)

  return {
    sx: d.source.x + ux * inset,
    sy: d.source.y + uy * inset,
    ex: d.target.x - ux * inset,
    ey: d.target.y - uy * inset,
    ux,
    uy,
    px,
    py,
    chordLen: dist,
  }
}

export function linkQuadControl(g: LinkChordGeometry, bendOffset: number): { cx: number; cy: number } {
  const midx = (g.sx + g.ex) * 0.5
  const midy = (g.sy + g.ey) * 0.5
  return {
    cx: midx + g.px * bendOffset,
    cy: midy + g.py * bendOffset,
  }
}

/** Quadratic Bézier B(u) from start (sx,sy) through (cx,cy) to (ex,ey); u in [0,1]. */
export function quadBezierPointAndTangent(
  sx: number,
  sy: number,
  cx: number,
  cy: number,
  ex: number,
  ey: number,
  u: number
): { x: number; y: number; ux: number; uy: number } {
  const t = Math.min(1, Math.max(0, u))
  const omt = 1 - t
  const x = omt * omt * sx + 2 * omt * t * cx + t * t * ex
  const y = omt * omt * sy + 2 * omt * t * cy + t * t * ey
  const tx = 2 * omt * (cx - sx) + 2 * t * (ex - cx)
  const ty = 2 * omt * (cy - sy) + 2 * t * (ey - cy)
  const len = Math.hypot(tx, ty)
  if (len < 1e-9) return { x, y, ux: 1, uy: 0 }
  return { x, y, ux: tx / len, uy: ty / len }
}

type SimLinkWithIds = {
  source: SimNode & { id: number }
  target: SimNode & { id: number }
}

const RECIP_SEP = 28
const FAN_STEP_MIN = 14
const FAN_STEP_CHORD_FR = 0.065
const FAN_STEP_MAX = 88

/**
 * Perpendicular pixel offset for each link: 0 when nothing forces separation;
 * otherwise fans edges from the same source by polar angle, and splits perfect
 * A↔B reciprocals so the two directions are not drawn on top of each other.
 */
export function computeLinkBendOffsets(links: readonly SimLinkWithIds[]): number[] {
  const n = links.length
  const bends = new Array<number>(n).fill(0)

  const bySource = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const s = links[i]!.source.id
    let arr = bySource.get(s)
    if (!arr) {
      arr = []
      bySource.set(s, arr)
    }
    arr.push(i)
  }

  for (const indices of bySource.values()) {
    if (indices.length <= 1) continue
    indices.sort((ia, ib) => {
      const la = links[ia]!
      const lb = links[ib]!
      const aa = Math.atan2(la.target.y - la.source.y, la.target.x - la.source.x)
      const ab = Math.atan2(lb.target.y - lb.source.y, lb.target.x - lb.source.x)
      const d = aa - ab
      if (Math.abs(d) > 1e-9) return d
      return la.target.id - lb.target.id
    })

    let maxChord = 0
    for (const idx of indices) {
      const L = links[idx]!
      const len = Math.hypot(L.target.x - L.source.x, L.target.y - L.source.y)
      maxChord = Math.max(maxChord, len)
    }
    const step = Math.min(FAN_STEP_MAX, FAN_STEP_MIN + maxChord * FAN_STEP_CHORD_FR)
    const m = indices.length
    const mid = (m - 1) * 0.5
    for (let k = 0; k < m; k++) {
      bends[indices[k]!] += (k - mid) * step
    }
  }

  const byPair = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    const u = links[i]!.source.id
    const v = links[i]!.target.id
    const key = u < v ? `${u}|${v}` : `${v}|${u}`
    let arr = byPair.get(key)
    if (!arr) {
      arr = []
      byPair.set(key, arr)
    }
    arr.push(i)
  }

  for (const idxs of byPair.values()) {
    if (idxs.length !== 2) continue
    const i0 = idxs[0]!
    const i1 = idxs[1]!
    const L0 = links[i0]!
    const L1 = links[i1]!
    if (L0.source.id !== L1.target.id || L0.target.id !== L1.source.id) continue
    bends[i0] += RECIP_SEP
    bends[i1] -= RECIP_SEP
  }

  return bends
}

export function linkPath(d: SimLink | null | undefined, bendOffset = 0): string {
  const g = linkChordGeometry(d)
  if (!g) return 'M0,0L0,0'
  const { cx, cy } = linkQuadControl(g, bendOffset)
  return `M${g.sx},${g.sy}Q${cx},${cy} ${g.ex},${g.ey}`
}

export function arrowPathAtFraction(d: SimLink | null | undefined, fraction = 1 / 3, bendOffset = 0): string {
  const g = linkChordGeometry(d)
  if (!g) return 'M0,0L0,0'
  const { cx, cy } = linkQuadControl(g, bendOffset)
  const pt = quadBezierPointAndTangent(g.sx, g.sy, cx, cy, g.ex, g.ey, fraction)
  return `M${g.sx},${g.sy}L${pt.x},${pt.y}`
}

export function linkSegment(
  d: SimLink | null | undefined
): { x1: number; y1: number; x2: number; y2: number } | null {
  const g = linkChordGeometry(d)
  if (!g) return null
  return { x1: g.sx, y1: g.sy, x2: g.ex, y2: g.ey }
}

export function arrowSegment(
  d: SimLink | null | undefined,
  fraction = 1 / 3,
  bendOffset = 0
): { x1: number; y1: number; x2: number; y2: number; ux: number; uy: number } | null {
  const g = linkChordGeometry(d)
  if (!g) return null
  const { cx, cy } = linkQuadControl(g, bendOffset)
  const pt = quadBezierPointAndTangent(g.sx, g.sy, cx, cy, g.ex, g.ey, fraction)
  return {
    x1: g.sx,
    y1: g.sy,
    x2: pt.x,
    y2: pt.y,
    ux: pt.ux,
    uy: pt.uy,
  }
}
