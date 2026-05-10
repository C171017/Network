import { useMemo } from 'react'
import './Legend.css'

type LegendItem = { color: string; label: string; isDashed?: boolean }

type Props = {
  colorBy: string
  colorMaps: Record<string, Record<string, string>>
  darkSurface?: boolean
}

export default function Legend({ colorBy, colorMaps, darkSurface = false }: Props) {
  const legendItems = useMemo(() => {
    const items: Record<string, LegendItem[]> = {}
    Object.entries(colorMaps || {}).forEach(([key, map]) => {
      items[key] = Object.entries(map || {}).map(([label, color]) => ({
        label,
        color,
      }))
    })
    return items
  }, [colorMaps])

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
