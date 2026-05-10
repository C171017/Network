import { useState } from 'react'
import ColumbiaNetworkGraph from '../graph/columbia/NetworkGraph'
import type { VisualizationGraphData } from '../graph/columbia/graphAdapter'

type Props = {
  data: VisualizationGraphData | null
  onNodeCrawl?: (login: string) => void
}

export default function NetworkGraph({ data, onNodeCrawl }: Props) {
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
    />
  )
}
