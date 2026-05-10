/** Fields allowed in “color by” for GitHub graph nodes (low-cardinality / useful only). */
const COLORABLE_ORDER = ['depth', 'company', 'location', 'isRoot', 'expanded'] as const

export const toLabel = (key: string): string =>
  String(key)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

export function getColorableFieldKeys(sampleNode: Record<string, unknown> = {}): string[] {
  return COLORABLE_ORDER.filter((k) => k in sampleNode)
}

export function extractNodeValues(node: Record<string, unknown>, key: string): string[] {
  const raw = node?.[key]
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (raw != null && raw !== '') {
    return [String(raw)]
  }
  return []
}
