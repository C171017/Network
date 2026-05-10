import { useMemo } from 'react'
import './Legend.css'
import { getCategoricalColor } from './colorPalette'
import { extractNodeValues, getColorableFieldKeys } from './fieldMetadata'

type LegendItem = { color: string; label: string; isDashed?: boolean }

type Props = {
  colorBy: string
  data: { nodes?: Array<Record<string, unknown>> } | null
  darkSurface?: boolean
}

export default function Legend({ colorBy, data, darkSurface = false }: Props) {
  const legendItems = useMemo(() => {
    const nodes = data?.nodes
    if (!nodes?.length) return {} as Record<string, LegendItem[]>

    const toLegend = (key: string): LegendItem[] => {
      const uniq = [...new Set(nodes.flatMap((n) => extractNodeValues(n, key)))]
      return uniq.map((v, i) => ({
        color: getCategoricalColor(i),
        label: v,
      }))
    }

    const items: Record<string, LegendItem[]> = {}
    getColorableFieldKeys(nodes[0]!).forEach((k) => {
      items[k] = toLegend(k)
    })
    return items
  }, [data])

  const currentItems = legendItems[colorBy] || []

  return (
    <div className={`legend${darkSurface ? ' dark-surface' : ''}`}>
      {currentItems.length === 0 ? (
        <p className="no-legend">No legend items available for this filter</p>
      ) : (
        <ul>
          {currentItems.map((item, index) => (
            <li key={index}>
              {item.isDashed ? (
                <div className="dashed-line" style={{ borderColor: item.color }} />
              ) : (
                <div className="color-box" style={{ backgroundColor: item.color }} />
              )}
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
