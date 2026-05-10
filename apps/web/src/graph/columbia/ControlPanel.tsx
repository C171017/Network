import { useEffect, useMemo } from 'react'
import './ControlPanel.css'
import { getColorableFieldKeys, toLabel } from './fieldMetadata'

type Props = {
  colorBy: string
  setColorBy: (v: string) => void
  nodes?: Array<Record<string, unknown>>
  darkSurface?: boolean
  physicsInteractionMode?: boolean
  setPhysicsInteractionMode?: (v: boolean) => void
}

export default function ControlPanel({
  colorBy,
  setColorBy,
  nodes = [],
  darkSurface = false,
  physicsInteractionMode = false,
  setPhysicsInteractionMode,
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
      {setPhysicsInteractionMode && (
        <div className="physics-mode-row">
          <button
            type="button"
            className="physics-mode-toggle"
            aria-pressed={physicsInteractionMode}
            onClick={() => setPhysicsInteractionMode(!physicsInteractionMode)}
          >
            {physicsInteractionMode ? 'Use zoom clusters' : 'Full physics (drag & tap)'}
          </button>
          <span className="physics-mode-hint">
            {physicsInteractionMode
              ? 'Drag or hold a node: in-group link, collision, and charge forces run like the Columbia prototype.'
              : 'When zoomed out, large groups become overview blobs until you enable this.'}
          </span>
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
