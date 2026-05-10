import { getCategoricalColor } from './colorPalette'
import { extractNodeValues, getColorableFieldKeys } from './fieldMetadata'

const TOP_COLOR_VALUES_LIMIT = 12

type RankedValue = {
  value: string
  count: number
}

function insertRankedValue(top: RankedValue[], candidate: RankedValue): void {
  let insertAt = top.length
  for (let i = 0; i < top.length; i += 1) {
    const current = top[i]!
    if (
      candidate.count > current.count ||
      (candidate.count === current.count && candidate.value.localeCompare(current.value) < 0)
    ) {
      insertAt = i
      break
    }
  }
  top.splice(insertAt, 0, candidate)
  if (top.length > TOP_COLOR_VALUES_LIMIT) {
    top.pop()
  }
}

export function buildColorMaps(nodes: Record<string, unknown>[] = []): Record<string, Record<string, string>> {
  if (!nodes.length) return {}
  const maps: Record<string, Record<string, string>> = {}
  const first = nodes[0]!
  getColorableFieldKeys(first).forEach((key) => {
    const frequencies = new Map<string, number>()
    nodes.forEach((n) => {
      extractNodeValues(n, key).forEach((v) => {
        frequencies.set(v, (frequencies.get(v) || 0) + 1)
      })
    })
    if (!frequencies.size) return

    const topValues: RankedValue[] = []
    frequencies.forEach((count, value) => {
      insertRankedValue(topValues, { value, count })
    })

    maps[key] = {}
    topValues.forEach((item, i) => {
      maps[key]![item.value] = getCategoricalColor(i)
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
