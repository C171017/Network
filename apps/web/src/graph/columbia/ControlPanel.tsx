import { useEffect, useMemo } from 'react'
import './ControlPanel.css'
import { getColorableFieldKeys, toLabel } from './fieldMetadata'

type Props = {
  colorBy: string
  setColorBy: (v: string) => void
  nodes?: Array<Record<string, unknown>>
  darkSurface?: boolean
}

export default function ControlPanel({
  colorBy,
  setColorBy,
  nodes = [],
  darkSurface = false
}: Props) {
  const colorOptions = useMemo(() => {
    if (!nodes.length) return []
    return getColorableFieldKeys(nodes[0]!).map((k) => ({ value: k, label: toLabel(k) }))
  }, [nodes])

  useEffect(() => {
    if (!colorOptions.length) {
      if (colorBy !== '') setColorBy('')
      return
    }
    if (colorBy === '' || !colorOptions.some((o) => o.value === colorBy)) {
      setColorBy(colorOptions[0]!.value)
    }
  }, [colorOptions, colorBy, setColorBy])

  return (
    <div className={`control-panel${darkSurface ? ' dark-surface' : ''}`}>
      <div className="filter-section">
        <label htmlFor="color-select" />
        <select
          id="color-select"
          value={colorBy}
          onChange={(e) => {
            setColorBy(e.target.value)
          }}
        >
          {!colorOptions.length && (
            <option value="" disabled>
              No graph data
            </option>
          )}
          {colorOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
