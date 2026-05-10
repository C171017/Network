import { useState } from 'react'
import ColumbiaNetworkGraph from '../graph/columbia/NetworkGraph'
import type { VisualizationGraphData } from '../graph/columbia/graphAdapter'

type Props = {
  data: VisualizationGraphData | null
  onNodeCrawl?: (login: string) => void
  /** Same dark/light chrome as control panel & legend (inner disk vs outer ramp). */
  onUiSurfaceChange?: (isDark: boolean) => void
  /** Drag physics (node forces); toggled from app chrome (logo long-press). */
  interactivePhysics: boolean
  /** Signed-in graphs are usually larger; layout uses more of the movable disk. */
  authenticatedSession?: boolean
}

export default function NetworkGraph({
  data,
  onNodeCrawl,
  onUiSurfaceChange,
  interactivePhysics,
  authenticatedSession = false,
}: Props) {
  const [colorBy, setColorBy] = useState('degree')
  if (!data?.nodes?.length) return null
  return (
    <ColumbiaNetworkGraph
      colorBy={colorBy}
      setColorBy={setColorBy}
      data={data}
      interactivePhysics={interactivePhysics}
      authenticatedSession={authenticatedSession}
      onNodeCrawl={onNodeCrawl}
      onUiSurfaceChange={onUiSurfaceChange}
    />
  )
}
