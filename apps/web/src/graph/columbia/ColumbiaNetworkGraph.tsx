import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ControlPanel from './ControlPanel'
import Legend from './Legend'
import './NetworkGraph.css'
import { buildColorMaps, getNodeColor as getNodeColorFromMaps } from './colors'
import { clampNodeCenterToMovableDisk, clampNodesInPlace } from './geometry'
import type { VisualizationGraphData } from './graphAdapter'
import {
  CANVAS_WHITE_OUTER_RADIUS,
  CLUSTER_EXIT_HYSTERESIS,
  CLUSTER_GROUP_MIN_NODES,
  CIRCLE_CX,
  CIRCLE_CY,
  INITIAL_ZOOM_MULTIPLIER_DESKTOP,
  INITIAL_ZOOM_MULTIPLIER_MOBILE,
  MOBILE_BREAKPOINT_PX,
  NODE_RADIUS,
  VISUAL_SCENE_EXTENT,
  ZOOM_CLUSTER_THRESHOLD,
  ZOOM_MAX_DESKTOP,
  ZOOM_MAX_MOBILE,
  ZOOM_MIN_DESKTOP,
  ZOOM_MIN_MOBILE,
} from './graphConstants'
import { computeInitialPositions, type LayoutNode } from './initialLayout'
import { resolveOverlaps } from './overlapLayout'
import { buildColorClusterCircles } from './clusters'
import NetworkGraphSkia, { type ClusterDrawRecord, type ResolvedLink } from './NetworkGraphSkia'
import {
  getVisibleWorldBounds,
  initialFitTransform,
  panByScreenDelta,
  type WorldTransform,
  zoomAtScreenPoint,
} from '../skia/viewTransform'

type Props = {
  colorBy: string
  setColorBy: (v: string) => void
  data: VisualizationGraphData
}

function isMobileViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches
}

function isDesktopSafariBrowser(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const isSafariEngine = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|CriOS\/|FxiOS\//.test(ua)
  const isMacDesktop = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) === 0
  return isSafariEngine && isMacDesktop
}

function hitNodeId(nodes: LayoutNode[], wx: number, wy: number): number | null {
  const r = NODE_RADIUS + 4
  let best: { id: number; d2: number } | null = null
  for (const n of nodes) {
    const dx = n.x - wx
    const dy = n.y - wy
    const d2 = dx * dx + dy * dy
    if (d2 <= r * r && (!best || d2 < best.d2)) {
      best = { id: n.id, d2 }
    }
  }
  return best?.id ?? null
}

function screenToWorld(sx: number, sy: number, rect: DOMRect, t: WorldTransform): { x: number; y: number } {
  const lx = sx - rect.left
  const ly = sy - rect.top
  return { x: (lx - t.tx) / t.k, y: (ly - t.ty) / t.k }
}

export default function ColumbiaNetworkGraph({ colorBy, setColorBy, data }: Props) {
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)

  const [viewport, setViewport] = useState({ width: 800, height: 600 })
  const [transform, setTransform] = useState<WorldTransform>({ tx: 0, ty: 0, k: 0.05 })
  const [nodes, setNodes] = useState<LayoutNode[]>([])
  const [links, setLinks] = useState<ResolvedLink[]>([])
  const [groupMap, setGroupMap] = useState<Map<number, number>>(new Map())
  const colorMaps = useMemo(() => {
    const n = data.nodes
    if (!n?.length) return {}
    return buildColorMaps(n)
  }, [data.nodes])
  const [darkSurface, setDarkSurface] = useState(false)
  const [inClusterMode, setInClusterMode] = useState(false)
  const [visibleGroups, setVisibleGroups] = useState<Set<number>>(new Set())
  const [highlightGroup, setHighlightGroup] = useState<number | null>(null)

  const groupCount = useMemo(() => {
    const vals = [...groupMap.values()]
    return vals.length ? Math.max(...vals) + 1 : 0
  }, [groupMap])

  const layoutGenerationRef = useRef(0)

  const getNodeColor = useCallback(
    (d: LayoutNode) => getNodeColorFromMaps(d, colorBy, colorMaps),
    [colorMaps, colorBy]
  )

  const dataKey = useMemo(
    () =>
      JSON.stringify({
        ids: data.nodes.map((x) => x.id).sort((a, b) => a - b),
        links: [...data.links]
          .map((l) => `${Math.min(l.source, l.target)}:${Math.max(l.source, l.target)}`)
          .sort(),
      }),
    [data.nodes, data.links]
  )

  /* eslint-disable react-hooks/set-state-in-effect -- layout rebuild when graph payload changes */
  useEffect(() => {
    const { nodes: laid, groupMap: gm } = computeInitialPositions(data)
    resolveOverlaps(laid)
    clampNodesInPlace(laid)

    const idToNode = new Map(laid.map((n) => [n.id, n]))
    const resolved: ResolvedLink[] = data.links.map((l) => {
      const s = idToNode.get(l.source)!
      const t = idToNode.get(l.target)!
      const gi = gm.get(l.source) ?? 0
      return { source: s, target: t, __groupIndex: gi }
    })

    laid.forEach((n) => {
      n.__groupIndex = gm.get(n.id)
    })

    setNodes(laid)
    setLinks(resolved)
    setGroupMap(gm)
    setHighlightGroup(null)
    setInClusterMode(false)
    setVisibleGroups(new Set())
    layoutGenerationRef.current += 1
  }, [dataKey, data])
  /* eslint-enable react-hooks/set-state-in-effect */

  const transformRef = useRef(transform)
  useEffect(() => {
    transformRef.current = transform
  }, [transform])

  const fittedForLayoutRef = useRef<number>(-1)

  useEffect(() => {
    if (!nodes.length || viewport.width < 32 || viewport.height < 32) return
    const gen = layoutGenerationRef.current
    if (fittedForLayoutRef.current === gen) return
    const mobile = isMobileViewport()
    const mult = mobile ? INITIAL_ZOOM_MULTIPLIER_MOBILE : INITIAL_ZOOM_MULTIPLIER_DESKTOP
    const minK = mobile ? ZOOM_MIN_MOBILE : ZOOM_MIN_DESKTOP
    const maxK = mobile ? ZOOM_MAX_MOBILE : ZOOM_MAX_DESKTOP
    const t0 = initialFitTransform(
      viewport.width,
      viewport.height,
      CIRCLE_CX,
      CIRCLE_CY,
      VISUAL_SCENE_EXTENT,
      mult,
      minK,
      maxK
    )
    transformRef.current = t0
    setTransform(t0)
    fittedForLayoutRef.current = gen
  }, [nodes.length, viewport.width, viewport.height, dataKey])

  useEffect(() => {
    const el = canvasHostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setViewport({ width: Math.max(1, r.width), height: Math.max(1, r.height) })
    })
    ro.observe(el)
    const r = el.getBoundingClientRect()
    setViewport({ width: Math.max(1, r.width), height: Math.max(1, r.height) })
    return () => ro.disconnect()
  }, [])

  const recomputeVisibleGroups = useCallback(
    (t: WorldTransform, cluster: boolean) => {
      if (cluster || groupCount === 0) {
        setVisibleGroups(new Set())
        return
      }
      const margin = NODE_RADIUS + 20
      const b = getVisibleWorldBounds(viewport.width, viewport.height, t, margin)
      const seen = new Array<boolean>(groupCount).fill(false)
      for (const n of nodes) {
        const gi = n.__groupIndex ?? 0
        if (seen[gi]) continue
        if (n.x >= b.minX && n.x <= b.maxX && n.y >= b.minY && n.y <= b.maxY) {
          seen[gi] = true
        }
      }
      const next = new Set<number>()
      seen.forEach((v, i) => {
        if (v) next.add(i)
      })
      if (next.size === 0 && groupCount > 0) {
        for (let i = 0; i < groupCount; i++) next.add(i)
      }
      setVisibleGroups(next)
    },
    [groupCount, nodes, viewport.height, viewport.width]
  )

  const isClusterWanted = useCallback((t: WorldTransform, cluster: boolean) => {
    if (cluster) {
      return t.k < ZOOM_CLUSTER_THRESHOLD + CLUSTER_EXIT_HYSTERESIS
    }
    return t.k < ZOOM_CLUSTER_THRESHOLD
  }, [])

  const groupSizes = useMemo(() => {
    const sizes = new Array<number>(groupCount).fill(0)
    for (const n of nodes) {
      const gi = n.__groupIndex ?? 0
      sizes[gi] += 1
    }
    return sizes
  }, [nodes, groupCount])

  const clusterRecords: ClusterDrawRecord[] = useMemo(() => {
    if (!inClusterMode || !nodes.length) return []
    const out: ClusterDrawRecord[] = []
    for (let gi = 0; gi < groupCount; gi++) {
      if (groupSizes[gi]! < CLUSTER_GROUP_MIN_NODES) continue
      const groupNodes = nodes.filter((n) => (n.__groupIndex ?? 0) === gi)
      if (!groupNodes.length) continue
      const worldCx = groupNodes.reduce((s, n) => s + n.x, 0) / groupNodes.length
      const worldCy = groupNodes.reduce((s, n) => s + n.y, 0) / groupNodes.length
      const center = { x: worldCx, y: worldCy }
      const circles = buildColorClusterCircles(groupNodes, (n) => getNodeColor(n as LayoutNode), center)
      out.push({ gi, worldCx, worldCy, circles })
    }
    return out
  }, [inClusterMode, nodes, groupCount, groupSizes, getNodeColor])

  /** Zoom-out "cluster" mode hides the full graph only when we actually draw cluster blobs. */
  const clusterUiActive = inClusterMode && clusterRecords.length > 0

  /* eslint-disable react-hooks/set-state-in-effect -- cluster threshold is derived from zoom */
  useEffect(() => {
    const want = isClusterWanted(transform, inClusterMode)
    if (want !== inClusterMode) {
      setInClusterMode(want)
      return
    }
    recomputeVisibleGroups(transform, clusterUiActive)
  }, [transform, inClusterMode, clusterUiActive, isClusterWanted, recomputeVisibleGroups, nodes])
  /* eslint-enable react-hooks/set-state-in-effect */

  const updateUiSurfaceTheme = useCallback(() => {
    const controlsEl = controlsRef.current
    const host = canvasHostRef.current
    if (!controlsEl || !host) return
    const graphRect = host.getBoundingClientRect()
    const panelRect = controlsEl.getBoundingClientRect()
    if (!graphRect.width || !graphRect.height) return
    const sx = panelRect.left + panelRect.width / 2 - graphRect.left
    const sy = panelRect.top + panelRect.height / 2 - graphRect.top
    const tr = transformRef.current
    const wx = (sx - tr.tx) / tr.k
    const wy = (sy - tr.ty) / tr.k
    const dist = Math.hypot(wx - CIRCLE_CX, wy - CIRCLE_CY)
    const uiIsDark = dist >= CANVAS_WHITE_OUTER_RADIUS * 1.02
    setDarkSurface(uiIsDark)
  }, [])

  useEffect(() => {
    updateUiSurfaceTheme()
  }, [transform, updateUiSurfaceTheme])

  const activePointersRef = useRef(
    new Map<number, { x: number; y: number }>()
  )
  const pinchBaseRef = useRef<{
    distance: number
    zoom: number
    tx: number
    ty: number
  } | null>(null)

  const draggingRef = useRef<{
    id: number
    hadMove: boolean
  } | null>(null)

  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressClickRef = useRef(false)

  const minMaxK = useCallback(() => {
    const mobile = isMobileViewport()
    return { minK: mobile ? ZOOM_MIN_MOBILE : ZOOM_MIN_DESKTOP, maxK: mobile ? ZOOM_MAX_MOBILE : ZOOM_MAX_DESKTOP }
  }, [])

  const nodesRef = useRef(nodes)
  const groupMapRef = useRef(groupMap)
  const inClusterModeRef = useRef(inClusterMode)
  const clusterRecordsRef = useRef(clusterRecords)
  useEffect(() => {
    nodesRef.current = nodes
    groupMapRef.current = groupMap
    inClusterModeRef.current = clusterUiActive
    clusterRecordsRef.current = clusterRecords
  }, [nodes, groupMap, clusterUiActive, clusterRecords])

  const zoomToCluster = useCallback(
    (gi: number) => {
      const groupNodes = nodesRef.current.filter((n) => (n.__groupIndex ?? 0) === gi)
      if (!groupNodes.length || !canvasHostRef.current) return
      const cx = groupNodes.reduce((s, n) => s + n.x, 0) / groupNodes.length
      const cy = groupNodes.reduce((s, n) => s + n.y, 0) / groupNodes.length
      const rect = canvasHostRef.current.getBoundingClientRect()
      const { minK, maxK } = minMaxK()
      const targetK = Math.min(maxK, Math.max(minK, ZOOM_CLUSTER_THRESHOLD * 2.5))
      const tx = rect.width / 2 - cx * targetK
      const ty = rect.height / 2 - cy * targetK
      const start = transformRef.current
      const dur = 450
      const t0 = performance.now()
      const step = (now: number) => {
        const u = Math.min(1, (now - t0) / dur)
        const e = u * u * (3 - 2 * u)
        const next = {
          k: start.k + (targetK - start.k) * e,
          tx: start.tx + (tx - start.tx) * e,
          ty: start.ty + (ty - start.ty) * e,
        }
        transformRef.current = next
        setTransform(next)
        if (u < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    },
    [minMaxK]
  )

  useEffect(() => {
    const host = canvasHostRef.current
    if (!host) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = host.getBoundingClientRect()
      const lx = e.clientX - rect.left
      const ly = e.clientY - rect.top
      const { minK, maxK } = minMaxK()
      const t = transformRef.current
      if (e.ctrlKey || e.metaKey) {
        const sensitivity = 0.01
        const factor = Math.exp(-e.deltaY * sensitivity)
        const next = zoomAtScreenPoint(t, lx, ly, factor, minK, maxK)
        transformRef.current = next
        setTransform(next)
        return
      }
      const dx = e.shiftKey ? -e.deltaY : -e.deltaX
      const dy = e.shiftKey ? 0 : -e.deltaY
      const panned = panByScreenDelta(t, dx, dy)
      transformRef.current = panned
      setTransform(panned)
    }

    const onPointerDown = (e: PointerEvent) => {
      host.setPointerCapture(e.pointerId)
      const rect = host.getBoundingClientRect()
      const lx = e.clientX - rect.left
      const ly = e.clientY - rect.top
      const map = activePointersRef.current
      map.set(e.pointerId, { x: lx, y: ly })

      if (map.size === 2) {
        const pts = [...map.values()]
        const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)
        const tr = transformRef.current
        pinchBaseRef.current = { distance: d, zoom: tr.k, tx: tr.tx, ty: tr.ty }
        return
      }

      if (e.button === 0) {
        const w = screenToWorld(e.clientX, e.clientY, rect, transformRef.current)
        const nid = inClusterModeRef.current ? null : hitNodeId(nodesRef.current, w.x, w.y)
        if (nid != null) {
          const n = nodesRef.current.find((x) => x.id === nid)
          if (n) {
            draggingRef.current = { id: nid, hadMove: false }
            return
          }
        }
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect()
      const lx = e.clientX - rect.left
      const ly = e.clientY - rect.top
      const map = activePointersRef.current
      if (map.has(e.pointerId)) {
        map.set(e.pointerId, { x: lx, y: ly })
      }

      if (map.size === 2 && pinchBaseRef.current) {
        const pts = [...map.values()]
        const d0 = pinchBaseRef.current.distance
        const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)
        if (d0 > 8 && d > 8) {
          const midX = (pts[0]!.x + pts[1]!.x) / 2
          const midY = (pts[0]!.y + pts[1]!.y) / 2
          const b = pinchBaseRef.current
          const wx = (midX - b.tx) / b.zoom
          const wy = (midY - b.ty) / b.zoom
          const newK = Math.min(minMaxK().maxK, Math.max(minMaxK().minK, b.zoom * (d / d0)))
          const next = {
            k: newK,
            tx: midX - wx * newK,
            ty: midY - wy * newK,
          }
          transformRef.current = next
          setTransform(next)
        }
        return
      }

      const drag = draggingRef.current
      if (drag && map.size <= 1) {
        const w = screenToWorld(e.clientX, e.clientY, rect, transformRef.current)
        const c = clampNodeCenterToMovableDisk(w.x, w.y)
        drag.hadMove = true
        setNodes((prev) =>
          prev.map((n) => (n.id === drag.id ? { ...n, x: c.x, y: c.y } : n))
        )
        return
      }
    }

    const endPanOrPinch = (e: PointerEvent) => {
      const map = activePointersRef.current
      map.delete(e.pointerId)
      if (map.size < 2) {
        pinchBaseRef.current = null
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      const drag = draggingRef.current
      if (drag) {
        suppressClickRef.current = drag.hadMove
        draggingRef.current = null
        setNodes((prev) => {
          const copy = prev.map((n) => ({ ...n }))
          resolveOverlaps(copy)
          clampNodesInPlace(copy)
          return copy
        })
      }
      endPanOrPinch(e)
    }

    const onPointerCancel = (e: PointerEvent) => {
      draggingRef.current = null
      endPanOrPinch(e)
    }

    const onClick = (e: MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        return
      }
      const rect = host.getBoundingClientRect()
      const w = screenToWorld(e.clientX, e.clientY, rect, transformRef.current)
      if (inClusterModeRef.current) {
        for (const cr of clusterRecordsRef.current) {
          let hit = false
          for (const c of cr.circles) {
            const px = cr.worldCx + c.cx
            const py = cr.worldCy + c.cy
            const d = Math.hypot(w.x - px, w.y - py)
            if (d <= c.radius) {
              hit = true
              break
            }
          }
          if (hit) {
            zoomToCluster(cr.gi)
            break
          }
        }
        return
      }
      const nid = hitNodeId(nodesRef.current, w.x, w.y)
      if (nid == null) return
      const grp = groupMapRef.current.get(nid)
      if (grp === undefined) return
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null
        setHighlightGroup((h) => (h === grp ? null : grp))
      }, 280)
    }

    const onDblClick = (e: MouseEvent) => {
      e.preventDefault()
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current)
        clickTimerRef.current = null
      }
      const rect = host.getBoundingClientRect()
      const w = screenToWorld(e.clientX, e.clientY, rect, transformRef.current)
      const nid = hitNodeId(nodesRef.current, w.x, w.y)
      if (nid == null) return
      const n = nodesRef.current.find((x) => x.id === nid)
      const raw = n?.profileUrl != null ? String(n.profileUrl).trim() : ''
      const login = n?.login != null ? String(n.login) : ''
      const url =
        raw.length > 0 ? raw : `https://github.com/${encodeURIComponent(login)}`
      if (url.length > 0) window.open(url, '_blank', 'noopener,noreferrer')
    }

    host.addEventListener('wheel', onWheel, { passive: false })
    host.addEventListener('pointerdown', onPointerDown)
    host.addEventListener('pointermove', onPointerMove)
    host.addEventListener('pointerup', onPointerUp)
    host.addEventListener('pointercancel', onPointerCancel)
    host.addEventListener('click', onClick)
    host.addEventListener('dblclick', onDblClick)

    return () => {
      host.removeEventListener('wheel', onWheel)
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerup', onPointerUp)
      host.removeEventListener('pointercancel', onPointerCancel)
      host.removeEventListener('click', onClick)
      host.removeEventListener('dblclick', onDblClick)
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    }
  }, [minMaxK, zoomToCluster])

  const desktopSafariClass = isDesktopSafariBrowser() ? ' desktop-safari' : ''

  return (
    <div className={`network-container${desktopSafariClass}`}>
      <div className="visualization-area">
        <div ref={canvasHostRef} className="network-graph" aria-label="Network graph visualization">
          <NetworkGraphSkia
            width={viewport.width}
            height={viewport.height}
            transform={transform}
            nodes={nodes}
            links={links}
            colorBy={colorBy}
            colorMaps={colorMaps}
            inClusterMode={clusterUiActive}
            visibleGroups={visibleGroups}
            highlightGroup={highlightGroup}
            clusterRecords={clusterRecords}
          />
        </div>

        <div ref={controlsRef} className="controls-legend-container">
          <ControlPanel
            colorBy={colorBy}
            setColorBy={setColorBy}
            nodes={data.nodes}
            darkSurface={darkSurface}
          />
          <Legend colorBy={colorBy} data={data} darkSurface={darkSurface} />
        </div>
      </div>
    </div>
  )
}
