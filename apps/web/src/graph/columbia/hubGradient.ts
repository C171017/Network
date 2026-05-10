import {
  CANVAS_BACKDROP_RADIUS,
  CANVAS_EDGE_FEATHER_HALF,
  CANVAS_WHITE_OUTER_RADIUS,
  CIRCLE_CX,
  CIRCLE_CY,
} from './graphConstants'

const KEY_COLORS = [
  '#fafbfc',
  '#eef0f4',
  '#d4d7de',
  '#a8adb8',
  '#8b909b',
  '#6e737d',
  '#4b4e56',
  '#32343a',
  '#1b1c20',
  '#0a0a0b',
  '#000000',
]

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const x = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `#${((1 << 24) + (x(r) << 16) + (x(g) << 8) + x(b)).toString(16).slice(1)}`
}

function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

function interpolateKeyColors(u: number): string {
  const scaled = u * (KEY_COLORS.length - 1)
  const i = Math.min(KEY_COLORS.length - 2, Math.max(0, Math.floor(scaled)))
  const f = scaled - i
  return lerpColor(KEY_COLORS[i]!, KEY_COLORS[i + 1]!, f)
}

const smoothstep = (t: number) => t * t * (3 - 2 * t)

/**
 * Radial gradient stops for the hub backdrop (Skia `RadialGradient` colors + positions 0..1).
 * Positions are normalized by CANVAS_BACKDROP_RADIUS (same as former SVG % along radius).
 */
export function buildHubRadialGradientStops(): { colors: string[]; positions: number[] } {
  const R_grad = CANVAS_BACKDROP_RADIUS
  const H = CANVAS_EDGE_FEATHER_HALF
  const WHITE_EDGE = '#fafbfc'
  const transitionStartR = Math.max(0, CANVAS_WHITE_OUTER_RADIUS - H * 0.22)
  const fadeStartU = 0.94
  const fadePow = 0.85
  const stopCount = 40

  const pctOfDist = (dist: number) => Math.min(dist, R_grad) / R_grad

  const colors: string[] = [WHITE_EDGE]
  const positions: number[] = [0]

  for (let i = 0; i < stopCount; i++) {
    const u = i / (stopCount - 1)
    const r = transitionStartR + (R_grad - transitionStartR) * u
    const offset = pctOfDist(r)
    const eased = smoothstep(u)
    const opacity =
      u < fadeStartU ? 1 : Math.pow((1 - u) / (1 - fadeStartU), fadePow)
    const col = interpolateKeyColors(eased)
    colors.push(withAlphaHex(col, opacity))
    positions.push(offset)
  }

  return { colors, positions }
}

function withAlphaHex(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  const a = Math.max(0, Math.min(1, alpha))
  const rr = Math.round(r * a + 0 * (1 - a))
  const gg = Math.round(g * a + 0 * (1 - a))
  const bb = Math.round(b * a + 0 * (1 - a))
  return rgbToHex(rr, gg, bb)
}

export const HUB_GRADIENT_CENTER = { cx: CIRCLE_CX, cy: CIRCLE_CY, r: CANVAS_BACKDROP_RADIUS }
