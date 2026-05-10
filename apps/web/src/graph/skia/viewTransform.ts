/**
 * Columbia graph camera: same mapping as former d3.zoom on the root <g>
 * (screen = k * world + (tx, ty)).
 */

export type WorldTransform = { tx: number; ty: number; k: number }

export function screenToWorld(sx: number, sy: number, t: WorldTransform): { x: number; y: number } {
  return { x: (sx - t.tx) / t.k, y: (sy - t.ty) / t.k }
}

export function worldToScreen(wx: number, wy: number, t: WorldTransform): { x: number; y: number } {
  return { x: wx * t.k + t.tx, y: wy * t.k + t.ty }
}

export function clampZoom(k: number, minK: number, maxK: number): number {
  return Math.min(maxK, Math.max(minK, k))
}

/** Zoom around a screen point (container-local); keeps world point fixed. */
export function zoomAtScreenPoint(
  t: WorldTransform,
  sx: number,
  sy: number,
  factor: number,
  minK: number,
  maxK: number
): WorldTransform {
  const wx = (sx - t.tx) / t.k
  const wy = (sy - t.ty) / t.k
  const newK = clampZoom(t.k * factor, minK, maxK)
  return {
    k: newK,
    tx: sx - wx * newK,
    ty: sy - wy * newK,
  }
}

/** Pan in container-local screen pixels (same space as `lx` / `ly` for zoom). Adds to tx, ty. */
export function panByScreenDelta(t: WorldTransform, dx: number, dy: number): WorldTransform {
  return { k: t.k, tx: t.tx + dx, ty: t.ty + dy }
}

/**
 * Initial fit: world (CIRCLE_CX, CIRCLE_CY) → viewport center, scale so VISUAL_SCENE_EXTENT fits.
 * Matches former `d3.zoomIdentity.translate(w/2,h/2).scale(s).translate(-cx,-cy)` → tx = w/2 - s*cx.
 */
export function initialFitTransform(
  viewportW: number,
  viewportH: number,
  circleCx: number,
  circleCy: number,
  visualSceneExtent: number,
  zoomMultiplier: number,
  minK: number,
  maxK: number
): WorldTransform {
  const scaleX = viewportW / visualSceneExtent
  const scaleY = viewportH / visualSceneExtent
  const base = Math.min(scaleX, scaleY)
  const k = clampZoom(base * zoomMultiplier, minK, maxK)
  const tx = viewportW / 2 - k * circleCx
  const ty = viewportH / 2 - k * circleCy
  return { tx, ty, k }
}

/** Axis-aligned world bounds visible in the viewport (with optional padding in world units). */
export function getVisibleWorldBounds(
  vw: number,
  vh: number,
  t: WorldTransform,
  padWorld = 0
): { minX: number; maxX: number; minY: number; maxY: number } {
  const corners = [
    screenToWorld(0, 0, t),
    screenToWorld(vw, 0, t),
    screenToWorld(vw, vh, t),
    screenToWorld(0, vh, t),
  ]
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  return {
    minX: Math.min(...xs) - padWorld,
    maxX: Math.max(...xs) + padWorld,
    minY: Math.min(...ys) - padWorld,
    maxY: Math.max(...ys) + padWorld,
  }
}

export const MIN_PINCH_SPAN_PX = 8

export function pinchDistance(pts: Array<{ x: number; y: number }>): number {
  if (pts.length < 2) return 0
  return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)
}

export function pinchMidpoint(pts: Array<{ x: number; y: number }>): { x: number; y: number } {
  return { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 }
}

export function computePinchZoomPan(
  startDistance: number,
  startZoom: number,
  startTx: number,
  startTy: number,
  pointerPts: Array<{ x: number; y: number }>
): WorldTransform {
  const d = pinchDistance(pointerPts)
  const center = pinchMidpoint(pointerPts)
  if (d < MIN_PINCH_SPAN_PX || startDistance <= 0) {
    return { tx: startTx, ty: startTy, k: startZoom }
  }
  const wx = (center.x - startTx) / startZoom
  const wy = (center.y - startTy) / startZoom
  const newK = startZoom * (d / startDistance)
  return {
    k: newK,
    tx: center.x - wx * newK,
    ty: center.y - wy * newK,
  }
}
