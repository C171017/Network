import ColumbiaNetworkGraph from '../graph/columbia/NetworkGraph'
import type { VisualizationGraphData } from '../graph/columbia/graphAdapter'

const DEFAULT_COLOR_BY = 'degree'

type Props = {
  data: VisualizationGraphData | null
  focusLoginRequest?: { login: string; nonce: number } | null
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
  focusLoginRequest,
  onNodeCrawl,
  onUiSurfaceChange,
  interactivePhysics,
  authenticatedSession = false,
}: Props) {
  if (!data?.nodes?.length) return null
  return (
    <ColumbiaNetworkGraph
      colorBy={DEFAULT_COLOR_BY}
      data={data}
      focusLoginRequest={focusLoginRequest}
      interactivePhysics={interactivePhysics}
      authenticatedSession={authenticatedSession}
      onNodeCrawl={onNodeCrawl}
      onUiSurfaceChange={onUiSurfaceChange}
    />
  )
}
