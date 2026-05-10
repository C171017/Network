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
}

export default function NetworkGraph({ data, onNodeCrawl, onUiSurfaceChange, interactivePhysics }: Props) {
  const [colorBy, setColorBy] = useState('depth')
  if (!data?.nodes?.length) return null
  return (
    <ColumbiaNetworkGraph
      colorBy={colorBy}
      setColorBy={setColorBy}
      data={data}
      interactivePhysics={interactivePhysics}
      onNodeCrawl={onNodeCrawl}
      onUiSurfaceChange={onUiSurfaceChange}
    />
  )
}
