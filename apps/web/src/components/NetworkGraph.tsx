import { useState } from 'react'
import ColumbiaNetworkGraph from '../graph/columbia/NetworkGraph'
import type { VisualizationGraphData } from '../graph/columbia/graphAdapter'

type Props = {
  data: VisualizationGraphData | null
  onNodeCrawl?: (login: string) => void
  /** Same dark/light chrome as control panel & legend (inner disk vs outer ramp). */
  onUiSurfaceChange?: (isDark: boolean) => void
}

export default function NetworkGraph({ data, onNodeCrawl, onUiSurfaceChange }: Props) {
  const [colorBy, setColorBy] = useState('depth')
  const [interactivePhysics, setInteractivePhysics] = useState(false)
  if (!data?.nodes?.length) return null
  return (
    <ColumbiaNetworkGraph
      colorBy={colorBy}
      setColorBy={setColorBy}
      data={data}
      interactivePhysics={interactivePhysics}
      setInteractivePhysics={setInteractivePhysics}
      onNodeCrawl={onNodeCrawl}
      onUiSurfaceChange={onUiSurfaceChange}
    />
  )
}
