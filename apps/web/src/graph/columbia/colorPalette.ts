/** Categorical colors, top-to-bottom order maps to value index 0, 1, 2, … */
export const COLOR_PALETTE = [
  '#FF0000', // Red
  '#00D5D5', // Cyan
  '#FF7F00', // Orange
  '#0033FF', // Blue
  '#FFD300', // Yellow
  '#7A00FF', // Violet
  '#7FFF00', // Lime
  '#FF1493', // Pink
  '#00CC44', // Green
  '#CC00FF', // Magenta
  '#0099FF', // Sky Blue
  '#8B5A2B', // Brown
] as const

/** Used when there are more distinct values than entries in `COLOR_PALETTE`. */
export const COLOR_PALETTE_OVERFLOW = '#9E9E9E'

export function getCategoricalColor(index: number): string {
  if (index >= 0 && index < COLOR_PALETTE.length) {
    return COLOR_PALETTE[index]!
  }
  return COLOR_PALETTE_OVERFLOW
}
