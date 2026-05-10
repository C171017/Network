type LinkLike = { source: { id?: number } | number; target: { id?: number } | number }
type NodeLike = { id: number }

export function buildGroups(nodes: NodeLike[], links: LinkLike[]): Map<number, number> {
  const adj = new Map<number, number[]>(nodes.map((n) => [n.id, []]))
  links.forEach((l) => {
    const s = typeof l.source === 'object' && l.source !== null ? (l.source.id ?? l.source) : l.source
    const t = typeof l.target === 'object' && l.target !== null ? (l.target.id ?? l.target) : l.target
    const si = typeof s === 'number' ? s : Number(s)
    const ti = typeof t === 'number' ? t : Number(t)
    adj.get(si)?.push(ti)
    adj.get(ti)?.push(si)
  })

  let current = 0
  const groupMap = new Map<number, number>()
  nodes.forEach((n) => {
    if (groupMap.has(n.id)) return
    const stack = [n.id]
    while (stack.length) {
      const id = stack.pop()!
      if (groupMap.has(id)) continue
      groupMap.set(id, current)
      adj.get(id)?.forEach((nei) => stack.push(nei))
    }
    current += 1
  })
  return groupMap
}
