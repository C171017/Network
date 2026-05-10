import { useState } from 'react'
import ColumbiaNetworkGraph from '../graph/columbia/NetworkGraph'
import type { VisualizationGraphData } from '../graph/columbia/graphAdapter'

type Props = {
  data: VisualizationGraphData | null
}

export default function NetworkGraph({ data }: Props) {
  const [colorBy, setColorBy] = useState('depth')
  if (!data?.nodes?.length) return null
  return <ColumbiaNetworkGraph colorBy={colorBy} setColorBy={setColorBy} data={data} />
}
