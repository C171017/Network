/** Categorical colors, top-to-bottom order maps to value index 0, 1, 2, … */
export const COLOR_PALETTE = [
  '#FF0000',
  '#FF0099',
  '#FF6000',
  '#FF9900',
  '#FFCC00',
  '#FFFF00',
  '#99FF00',
  '#33FF00',
  '#00FF66',
  '#00FFCC',
  '#00FFFF',
  '#0099FF',
  '#0033FF',
  '#6600FF',
  '#CC00FF',
] as const

/** Used when there are more distinct values than entries in `COLOR_PALETTE`. */
export const COLOR_PALETTE_OVERFLOW = '#9E9E9E'

export function getCategoricalColor(index: number): string {
  if (index >= 0 && index < COLOR_PALETTE.length) {
    return COLOR_PALETTE[index]!
  }
  return COLOR_PALETTE_OVERFLOW
}
