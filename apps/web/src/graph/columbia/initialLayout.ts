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

function buildAdjacency(data: VisualizationGraphData): Map<number, number[]> {
  const adj = new Map<number, number[]>()
  for (const n of data.nodes) adj.set(n.id, [])
  for (const l of data.links) {
    adj.get(l.source)?.push(l.target)
    adj.get(l.target)?.push(l.source)
  }
  return adj
}

function bfsDepthsFromRoot(
  ids: ReadonlySet<number>,
  adj: Map<number, number[]>,
  rootId: number
): Map<number, number> {
  const depth = new Map<number, number>()
  const q: number[] = [rootId]
  depth.set(rootId, 0)
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi]!
    const du = depth.get(u)!
    const neighbors = adj.get(u) ?? []
    for (let i = 0; i < neighbors.length; i++) {
      const v = neighbors[i]!
      if (!ids.has(v) || depth.has(v)) continue
      depth.set(v, du + 1)
      q.push(v)
    }
  }
  return depth
}

function pickComponentRoot(nodes: LayoutNode[], ids: Set<number>, adj: Map<number, number[]>): number {
  const roots = nodes.filter((n) => n.isRoot === true)
  if (roots.length === 1) return roots[0]!.id

  let best = nodes[0]!
  let bestDeg = -1
  for (const n of nodes) {
    const deg = (adj.get(n.id) ?? []).filter((v) => ids.has(v)).length
    if (deg > bestDeg || (deg === bestDeg && n.id < best.id)) {
      bestDeg = deg
      best = n
    }
  }
  return best.id
}

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
 * Seeds node positions: group centers use the golden-disk packing as before;
 * within each connected component, nodes are placed on expanding BFS rings
 * from a root (marked `isRoot`, else max degree) so edges tend to run outward
 * instead of crossing as random disk fills do.
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

  const fullAdj = buildAdjacency(data)

  for (let gi = 0; gi < groupCount; gi++) {
    const c = centres[gi] || { x: CIRCLE_CX, y: CIRCLE_CY }
    const groupNodes = nodesByGroupSeed[gi]!
    const radialLimit = Math.max(groupR[gi]! - 36, 28)

    const idSet = new Set(groupNodes.map((n) => n.id))
    const rootId = pickComponentRoot(groupNodes, idSet, fullAdj)
    const depthMap = bfsDepthsFromRoot(idSet, fullAdj, rootId)

    let maxD = 0
    for (const n of groupNodes) {
      if (!depthMap.has(n.id)) depthMap.set(n.id, 0)
      maxD = Math.max(maxD, depthMap.get(n.id)!)
    }

    const byDepth = new Map<number, LayoutNode[]>()
    for (const n of groupNodes) {
      const d = depthMap.get(n.id) ?? 0
      let arr = byDepth.get(d)
      if (!arr) {
        arr = []
        byDepth.set(d, arr)
      }
      arr.push(n)
    }
    byDepth.forEach((arr) => arr.sort((a, b) => a.id - b.id))

    const depthSpan = Math.max(1, maxD + 1)
    const edgeInset = 0.07

    for (let d = 0; d <= maxD; d++) {
      const layer = byDepth.get(d)
      if (!layer?.length) continue

      const t0 = d / depthSpan
      const t1 = (d + 1) / depthSpan
      const rInner = radialLimit * (edgeInset + (1 - 2 * edgeInset) * t0)
      const rOuter = radialLimit * (edgeInset + (1 - 2 * edgeInset) * t1)
      const layerPhase = d * golden + gi * 0.73
      const m = layer.length

      for (let j = 0; j < m; j++) {
        const n = layer[j]!
        const u = m === 1 ? 0.5 : (j + 0.5) / m
        const r = rInner + (rOuter - rInner) * Math.sqrt(u)
        const theta = layerPhase + (2 * Math.PI * j) / m + (rng() - 0.5) * 0.04
        const cand = clampToMovableDisk(c.x + r * Math.cos(theta), c.y + r * Math.sin(theta))
        n.x = cand.x
        n.y = cand.y
      }
    }
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
