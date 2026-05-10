export const NODE_RADIUS = 39

/** Preferred edge length in the force simulation (node center–to–center along links). */
export const LINK_FORCE_DISTANCE = 600
/** Same for the temporary single-group mini simulation when dragging a cluster. */
export const LINK_FORCE_DISTANCE_GROUP_MINI = 450

/** Link stiffness [0,1]; lower = softer / more elastic (1 = rigid). */
export const LINK_FORCE_STRENGTH = 0.38

/**
 * Tapered-wedge link geometry. Each link is rendered as a filled trapezoid
 * that is wider at the source end and tapers toward the target — the wedge
 * IS the arrow, so direction is encoded by the shape itself (no separate
 * arrowhead marker is needed).
 *
 * For mutual / reciprocal edges, both members of the pair are shifted by
 * `LINK_WEDGE_MUTUAL_OFFSET` along the perpendicular to their forward
 * direction. Because the reverse edge has a flipped forward direction, the
 * same +offset along its own perpendicular naturally places it on the
 * opposite visual side, producing a "two-lane road" indicator.
 *
 * All values are in SVG user units (the same coordinate system as
 * NODE_RADIUS).
 */
export const LINK_WEDGE_SOURCE_HALF_WIDTH = 2.4
export const LINK_WEDGE_TARGET_HALF_WIDTH = 0.3
export const LINK_WEDGE_MUTUAL_OFFSET = 6

/** Hold duration (ms) on a node before it triggers a crawl from that node. */
export const LONG_PRESS_MS = 800
/** Pointer movement (px) during a long-press that cancels it (treated as drag/pan instead). */
export const LONG_PRESS_MOVE_CANCEL_PX = 6

export const ZOOM_MIN_DESKTOP = 0.03
export const ZOOM_MAX_DESKTOP = 0.8
export const ZOOM_MIN_MOBILE = 0.01
export const ZOOM_MAX_MOBILE = 1
export const INITIAL_ZOOM_MULTIPLIER_DESKTOP = 1.4
export const INITIAL_ZOOM_MULTIPLIER_MOBILE = 1.0

export const ZOOM_CLUSTER_THRESHOLD = 0.1
export const CLUSTER_GROUP_MIN_NODES = 20
export const CLUSTER_BASE_R = 80
export const CLUSTER_PX_PER_SQRT_NODE = 20
export const CLUSTER_EXIT_HYSTERESIS = 0.02
export const CLUSTER_SWITCH_DEBOUNCE_MS = 140

export const MOBILE_BREAKPOINT_PX = 768

export const LEGACY_SQUARE_SIDE = 25000
export const CANVAS_SCALE = 0.85
export const CIRCLE_DIAMETER = LEGACY_SQUARE_SIDE * 1.5 * CANVAS_SCALE
export const CIRCLE_RADIUS = CIRCLE_DIAMETER / 2
export const CIRCLE_CX = CIRCLE_RADIUS
export const CIRCLE_CY = CIRCLE_RADIUS
export const CANVAS_EDGE_FEATHER_HALF = 2800
export const CANVAS_BACKDROP_RADIUS = CIRCLE_RADIUS + CANVAS_EDGE_FEATHER_HALF
export const VISUAL_SCENE_EXTENT = CIRCLE_DIAMETER + 2 * CANVAS_EDGE_FEATHER_HALF
export const CANVAS_WHITE_INSET = 1300
export const CANVAS_WHITE_OUTER_RADIUS = Math.max(0, CIRCLE_RADIUS - CANVAS_EDGE_FEATHER_HALF - CANVAS_WHITE_INSET)
export const NODE_MOVABLE_DISK_PAD = NODE_RADIUS + 20
export const NODE_MOVE_MAX_RADIUS_FROM_CENTER = Math.max(600, CANVAS_WHITE_OUTER_RADIUS - NODE_MOVABLE_DISK_PAD)
