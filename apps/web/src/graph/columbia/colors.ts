import { COLOR_PALETTE } from './colorPalette'
import { extractNodeValues, getColorableFieldKeys } from './fieldMetadata'

export function buildColorMaps(nodes: Record<string, unknown>[] = []): Record<string, Record<string, string>> {
  if (!nodes.length) return {}
  const maps: Record<string, Record<string, string>> = {}
  const first = nodes[0]!
  getColorableFieldKeys(first).forEach((key) => {
      const vals = [...new Set(nodes.flatMap((n) => extractNodeValues(n, key)))]
      if (!vals.length) return
      maps[key] = {}
      vals.forEach((v, i) => {
        maps[key]![v] = COLOR_PALETTE[i % COLOR_PALETTE.length]!
      })
    })
  return maps
}

export function getNodeColor(
  node: Record<string, unknown>,
  colorBy: string,
  colorMaps: Record<string, Record<string, string>>,
): string {
  if (!node || !colorBy || !colorMaps) return '#9e9e9e'
  const field = node[colorBy]
  if (field == null || field === '') return '#9e9e9e'
  const firstVal = String(field).split(',')[0]!.trim()
  if (colorMaps[colorBy]?.[firstVal]) return colorMaps[colorBy]![firstVal]!
  if (colorBy === 'email-sequence') return '#5F6368'
  return '#9e9e9e'
}

export function createNodePathInfo(
  node: Record<string, unknown>,
  colorBy: string,
  colorMaps: Record<string, Record<string, string>>,
): { items: string[]; colorMap: Record<string, string> } | null {
  if (!node || !colorBy || !colorMaps) return null
  const field = node[colorBy]
  if (typeof field !== 'string' || !field.includes(',')) return null
  const items = field
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (items.length <= 1) return null
  return { items, colorMap: colorMaps[colorBy] || {} }
}
