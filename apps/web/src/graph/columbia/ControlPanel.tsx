import { useEffect, useMemo } from 'react'
import './ControlPanel.css'
import { getColorableFieldKeys, toLabel } from './fieldMetadata'

type Props = {
  colorBy: string
  setColorBy: (v: string) => void
  nodes?: Array<Record<string, unknown>>
  darkSurface?: boolean
  interactivePhysics?: boolean
  setInteractivePhysics?: (v: boolean) => void
}

export default function ControlPanel({
  colorBy,
  setColorBy,
  nodes = [],
  darkSurface = false,
  interactivePhysics = false,
  setInteractivePhysics
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
      {setInteractivePhysics != null && (
        <div className="physics-toggle-section">
          <span id="physics-toggle-label" className="physics-toggle-label">
            Drag physics
          </span>
          <button
            type="button"
            id="interactive-physics-toggle"
            className={`physics-toggle${interactivePhysics ? ' is-on' : ''}`}
            role="switch"
            aria-checked={interactivePhysics}
            aria-labelledby="physics-toggle-label"
            onClick={() => setInteractivePhysics(!interactivePhysics)}
          >
            <span className="physics-toggle-knob" />
          </button>
        </div>
      )}
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
