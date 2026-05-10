import { Fragment, useMemo } from 'react'
import { Canvas, Circle, Group, Line, Path, RadialGradient, Rect, Skia, vec } from '@shopify/react-native-skia'

/** Skia `Canvas` + react-native-web typings are incomplete in strict TS. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SkiaCanvas = Canvas as any
import { clusterCircleDrawStyle, type ColorCircle } from './clusters'
import { getNodeColor } from './colors'
import { HUB_GRADIENT_CENTER, buildHubRadialGradientStops } from './hubGradient'
import {
  CANVAS_BACKDROP_RADIUS,
  CIRCLE_CX,
  CIRCLE_CY,
  CIRCLE_RADIUS,
  NODE_RADIUS,
} from './graphConstants'
import { arrowSegment, linkSegment } from './geometry'
import type { WorldTransform } from '../skia/viewTransform'
import type { LayoutNode } from './initialLayout'

export type ResolvedLink = {
  source: LayoutNode
  target: LayoutNode
  __groupIndex: number
}

export type ClusterDrawRecord = {
  gi: number
  worldCx: number
  worldCy: number
  circles: ColorCircle[]
}

type Props = {
  width: number
  height: number
  transform: WorldTransform
  nodes: LayoutNode[]
  links: ResolvedLink[]
  colorBy: string
  colorMaps: Record<string, Record<string, string>>
  inClusterMode: boolean
  visibleGroups: Set<number>
  highlightGroup: number | null
  clusterRecords: ClusterDrawRecord[]
}

const LINK_STROKE = '#999999'
const LINK_WIDTH = 3
const ARROW_FILL = '#808080'

function groupIndexOfNode(n: LayoutNode): number {
  const g = n.__groupIndex
  return typeof g === 'number' && Number.isFinite(g) ? g : 0
}

function isDimmed(gi: number, highlight: number | null): boolean {
  return highlight !== null && gi !== highlight
}

function arrowHeadPath(l: ResolvedLink): ReturnType<typeof Skia.Path.Make> | null {
  const ar = arrowSegment(l, 1 / 3)
  if (!ar) return null
  const { x2, y2, ux, uy } = ar
  const px = -uy
  const py = ux
  const tip = 10
  const half = 5
  const tri = Skia.Path.Make()
  tri.moveTo(x2, y2)
  tri.lineTo(x2 - ux * tip + px * half, y2 - uy * tip + py * half)
  tri.lineTo(x2 - ux * tip - px * half, y2 - uy * tip - py * half)
  tri.close()
  return tri
}

export default function NetworkGraphSkia({
  width,
  height,
  transform,
  nodes,
  links,
  colorBy,
  colorMaps,
  inClusterMode,
  visibleGroups,
  highlightGroup,
  clusterRecords,
}: Props) {
  const hub = useMemo(() => buildHubRadialGradientStops(), [])

  const clipPath = useMemo(() => {
    const p = Skia.Path.Make()
    p.addCircle(CIRCLE_CX, CIRCLE_CY, CIRCLE_RADIUS)
    return p
  }, [])

  const vw = Math.max(1, width)
  const vh = Math.max(1, height)
  const t = transform

  const visibleLinks = useMemo(() => {
    if (inClusterMode) return []
    return links.filter((l) => visibleGroups.has(l.__groupIndex))
  }, [links, visibleGroups, inClusterMode])

  const visibleNodes = useMemo(() => {
    if (inClusterMode) return []
    return nodes.filter((n) => visibleGroups.has(groupIndexOfNode(n)))
  }, [nodes, visibleGroups, inClusterMode])

  return (
    <SkiaCanvas
      style={{ width: vw, height: vh, flex: 1, minWidth: vw, minHeight: vh, alignSelf: 'stretch' }}
      opaque={false}
    >
      <Rect x={0} y={0} width={vw} height={vh} color="#000000" />

      <Group transform={[{ scale: t.k }, { translateX: t.tx }, { translateY: t.ty }]}>
        <Circle cx={HUB_GRADIENT_CENTER.cx} cy={HUB_GRADIENT_CENTER.cy} r={HUB_GRADIENT_CENTER.r}>
          <RadialGradient
            c={vec(HUB_GRADIENT_CENTER.cx, HUB_GRADIENT_CENTER.cy)}
            r={HUB_GRADIENT_CENTER.r}
            colors={hub.colors}
            positions={hub.positions}
          />
        </Circle>

        <Group clip={clipPath}>
          {!inClusterMode
            ? visibleLinks.map((l, i) => {
                const gi = l.__groupIndex
                const dim = isDimmed(gi, highlightGroup)
                const seg = linkSegment(l)
                const tri = arrowHeadPath(l)
                if (!seg || !tri) return null
                const opacity = dim ? 0.1 : 0.8
                return (
                  <Fragment key={`lk-${l.source.id}-${l.target.id}-${i}`}>
                    <Line
                      p1={vec(seg.x1, seg.y1)}
                      p2={vec(seg.x2, seg.y2)}
                      color={LINK_STROKE}
                      strokeWidth={LINK_WIDTH}
                      opacity={opacity}
                    />
                    <Path path={tri} color={ARROW_FILL} opacity={opacity} />
                  </Fragment>
                )
              })
            : null}

          {!inClusterMode
            ? visibleNodes.map((n) => {
                const gi = groupIndexOfNode(n)
                const dim = isDimmed(gi, highlightGroup)
                const fill = getNodeColor(n, colorBy, colorMaps)
                const opacity = dim ? 0.1 : 1
                return (
                  <Circle key={n.id} cx={n.x} cy={n.y} r={NODE_RADIUS} color={fill} opacity={opacity} />
                )
              })
            : null}

          {inClusterMode
            ? clusterRecords.map((cr) => {
                const styles = clusterCircleDrawStyle(cr.circles)
                return (
                  <Group key={`cl-${cr.gi}`} transform={[{ translateX: cr.worldCx }, { translateY: cr.worldCy }]}>
                    {styles.map((c, j) => (
                      <Circle key={j} cx={c.cx} cy={c.cy} r={c.radius} color={c.color} opacity={c.opacity} />
                    ))}
                  </Group>
                )
              })
            : null}
        </Group>
      </Group>
    </SkiaCanvas>
  )
}

export { CANVAS_BACKDROP_RADIUS, CIRCLE_CX, CIRCLE_CY }
