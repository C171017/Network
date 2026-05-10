import { buildGroups } from './groups'
import type { VisualizationGraphData } from './graphAdapter'
import {
  CANVAS_WHITE_OUTER_RADIUS,
  CIRCLE_CX,
  CIRCLE_CY,
  NODE_RADIUS,
} from './graphConstants'
import { clampNodeCenterToMovableDisk } from './geometry'

export type LayoutNode = Record<string, unknown> & {
  id: number
  x: number
  y: number
  __groupIndex?: number
}

const BASE_R = 200
const PX_PER_NODE = 25
const PAD = 700

function clampToMovableDisk(x: number, y: number): { x: number; y: number } {
  const movableLimit = Math.max(0, CANVAS_WHITE_OUTER_RADIUS - NODE_RADIUS - 10)
  const dx = x - CIRCLE_CX
  const dy = y - CIRCLE_CY
  const dist = Math.hypot(dx, dy)
  if (!Number.isFinite(dist) || dist <= movableLimit || dist === 0) return { x, y }
  const s = movableLimit / dist
  return { x: CIRCLE_CX + dx * s, y: CIRCLE_CY + dy * s }
}

/**
 * Seeds node positions (group centers + per-node disk placement), matching the
 * former Columbia D3 graph’s pre-simulation layout.
 */
export function computeInitialPositions(
  data: VisualizationGraphData,
  rng: () => number = Math.random
): { nodes: LayoutNode[]; groupMap: Map<number, number> } {
  const groupMap = buildGroups(data.nodes, data.links)
  const vals = [...groupMap.values()]
  const groupCount = vals.length ? Math.max(...vals) + 1 : 0

  const nodes: LayoutNode[] = data.nodes.map((n) => ({
    ...n,
    x: CIRCLE_CX,
    y: CIRCLE_CY,
  }))

  if (groupCount === 0) {
    return { nodes, groupMap }
  }

  const groupSizes = Array.from({ length: groupCount }, () => 0)
  nodes.forEach((n) => {
    groupSizes[groupMap.get(n.id)!] += 1
  })

  const groupR = groupSizes.map((s) => BASE_R + PX_PER_NODE * Math.sqrt(s))

  const uniformPointInDisk = (maxDistFromCentre: number) => {
    const theta = rng() * 2 * Math.PI
    const radius = Math.sqrt(rng()) * Math.max(0, maxDistFromCentre)
    return {
      x: CIRCLE_CX + radius * Math.cos(theta),
      y: CIRCLE_CY + radius * Math.sin(theta),
    }
  }

  const centres: Array<{ x: number; y: number } | null> = Array.from({ length: groupCount }, () => null)

  const groupOrder = Array.from({ length: groupCount }, (_, gi) => gi).sort((a, b) => groupR[b]! - groupR[a]!)
  const candidateCount = 220
  const golden = Math.PI * (3 - Math.sqrt(5))

  const movableLimit = Math.max(140, CANVAS_WHITE_OUTER_RADIUS - NODE_RADIUS - 10)

  groupOrder.forEach((gi, orderIndex) => {
    const maxCenterDist = Math.max(140, movableLimit - groupR[gi]! - PAD)
    let best: { x: number; y: number } | null = null
    let bestScore = -Infinity
    const nCandidates = Math.max(36, candidateCount - orderIndex * 5)

    for (let i = 0; i < nCandidates; i++) {
      const u = (i + 0.5) / nCandidates
      const theta = i * golden + rng() * 0.18
      const radius = Math.sqrt(u) * maxCenterDist
      const cand = {
        x: CIRCLE_CX + radius * Math.cos(theta),
        y: CIRCLE_CY + radius * Math.sin(theta),
      }

      const wallClearance = maxCenterDist - radius
      let overlapPenalty = 0
      let nearestGap = Infinity
      for (let j = 0; j < groupCount; j++) {
        const c = centres[j]
        if (!c) continue
        const dx = c.x - cand.x
        const dy = c.y - cand.y
        const dist = Math.hypot(dx, dy)
        const minGap = groupR[j]! + groupR[gi]! + PAD
        const gap = dist - minGap
        nearestGap = Math.min(nearestGap, gap)
        if (gap < 0) overlapPenalty += -gap * 1000
      }
      if (!Number.isFinite(nearestGap)) nearestGap = maxCenterDist

      const score = nearestGap * 2.5 + wallClearance - overlapPenalty
      if (score > bestScore) {
        bestScore = score
        best = cand
      }
    }

    centres[gi] = best || uniformPointInDisk(maxCenterDist)
  })

  const nodesByGroupSeed: LayoutNode[][] = Array.from({ length: groupCount }, () => [])
  nodes.forEach((n) => {
    nodesByGroupSeed[groupMap.get(n.id)!]!.push(n)
  })

  for (let gi = 0; gi < groupCount; gi++) {
    const c = centres[gi] || { x: CIRCLE_CX, y: CIRCLE_CY }
    const groupNodes = nodesByGroupSeed[gi]!
    const seeded: { x: number; y: number }[] = []
    const radialLimit = Math.max(groupR[gi]! - 36, 28)
    const minSepBase = Math.min(92, Math.max(42, NODE_RADIUS * 1.7))

    groupNodes.forEach((n, idx) => {
      let placed: { x: number; y: number } | null = null
      for (let attempt = 0; attempt < 60; attempt++) {
        const θ = rng() * 2 * Math.PI
        const r = Math.sqrt(rng()) * radialLimit
        const cand = {
          x: c.x + r * Math.cos(θ),
          y: c.y + r * Math.sin(θ),
        }
        const clamped = clampToMovableDisk(cand.x, cand.y)
        const minSep = Math.max(20, minSepBase - attempt * 0.85)
        const isFarEnough = seeded.every((p) => {
          const dx = p.x - clamped.x
          const dy = p.y - clamped.y
          return dx * dx + dy * dy >= minSep * minSep
        })
        if (isFarEnough) {
          placed = clamped
          break
        }
      }

      if (!placed) {
        const fallbackTheta = (idx + 1) * golden
        const fallbackR = Math.sqrt((idx + 1) / (groupNodes.length + 1)) * radialLimit
        placed = clampToMovableDisk(
          c.x + fallbackR * Math.cos(fallbackTheta),
          c.y + fallbackR * Math.sin(fallbackTheta)
        )
      }

      n.x = placed.x
      n.y = placed.y
      seeded.push(placed)
    })
  }

  nodes.forEach((n) => {
    n.__groupIndex = groupMap.get(n.id)
  })

  for (const n of nodes) {
    const c = clampNodeCenterToMovableDisk(n.x, n.y)
    n.x = c.x
    n.y = c.y
  }

  return { nodes, groupMap }
}
