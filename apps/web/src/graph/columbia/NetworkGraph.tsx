// Columbia D3 graph port — strict typing deferred (large d3/simulation surface).
// @ts-nocheck

////////////////////////////////////////////
////////////////////////////////////////////
// Imports (module imports)

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import ControlPanel from './ControlPanel';
import Legend from './Legend';
import './NetworkGraph.css';
import {
  buildColorMaps,
  createNodePathInfo,
  getNodeColor as getNodeColorFromMaps
} from './colors';
import { buildGroups as buildGroupsFromData } from './groups';
import {
  clampNodeCenterToMovableDisk as clampNodeToDisk,
  clampNodesInPlace as clampNodesToDisk,
  linkWedgePath as computeLinkPath
} from './geometry';
import { renderClusterContents as renderClusterContentsFromModule } from './clusters';
import {
  LINK_FORCE_DISTANCE,
  LINK_FORCE_DISTANCE_GROUP_MINI,
  LINK_FORCE_STRENGTH,
  LONG_PRESS_MOVE_CANCEL_PX,
  LONG_PRESS_MS,
  NODE_RADIUS
} from './graphConstants';
////////////////////////////////////////////
////////////////////////////////////////////

/** Present GitHub profile payload fields first; append remaining scalar keys. */
const PROFILE_HOVER_PRIORITY = [
  'login',
  'name',
  'bio',
  'company',
  'location',
  'blog',
  'email',
  'twitter_username',
  'hireable',
  'public_repos',
  'public_gists',
  'followers',
  'following',
  'created_at',
  'updated_at',
  'html_url',
  'type'
];

function formatNodeHoverText(d) {
  const p = d.profile;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const lines = [];
    const shown = new Set();
    for (const k of PROFILE_HOVER_PRIORITY) {
      if (!Object.prototype.hasOwnProperty.call(p, k)) continue;
      const v = p[k];
      if (v == null || v === '') continue;
      lines.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
      shown.add(k);
    }
    for (const [k, v] of Object.entries(p)) {
      if (shown.has(k)) continue;
      if (v == null || v === '') continue;
      if (typeof v === 'object') continue;
      lines.push(`${k}: ${String(v)}`);
    }
    return lines.join('\n');
  }
  const bits = [
    d.login && `login: ${d.login}`,
    d.name && `name: ${d.name}`,
    d.company && `company: ${d.company}`,
    d.location && `location: ${d.location}`,
    d.bio && `bio: ${d.bio}`,
    d.websiteUrl && `blog: ${d.websiteUrl}`
  ].filter(Boolean);
  return bits.length ? bits.join('\n') : String(d.login ?? d.id ?? '');
}

function nodeAvatarUrl(d) {
  const u = d.avatarUrl != null ? String(d.avatarUrl).trim() : '';
  return u.length > 0 ? u : '';
}

/////////////////////////////////////////////
/////////////////////////////////////////////
// buildGroups function (build groups)

function renderNodeVisual(nodeGroup, d, nodePathInfo, options) {
  const {
    colorMaps,
    colorBy,
    getNodeColor,
    includeHub = false,
    includeDataAttrs = false,
    simplified = false
  } = options;

  const avatarUrl = nodeAvatarUrl(d);

  if (avatarUrl) {
    const clipId = `node-avatar-clip-${d.id}`;
    nodeGroup.append('defs')
      .append('clipPath')
      .attr('id', clipId)
      .append('circle')
      .attr('r', NODE_RADIUS)
      .attr('cx', 0)
      .attr('cy', 0);
    const img = nodeGroup
      .append('image')
      .attr('href', avatarUrl)
      .attr('x', -NODE_RADIUS)
      .attr('y', -NODE_RADIUS)
      .attr('width', NODE_RADIUS * 2)
      .attr('height', NODE_RADIUS * 2)
      .attr('preserveAspectRatio', 'xMidYMid slice')
      .attr('clip-path', `url(#${clipId})`);
    if (includeDataAttrs) img.attr('data-avatar', true);
    nodeGroup
      .append('circle')
      .attr('class', 'node-outline')
      .attr('r', NODE_RADIUS)
      .attr('fill', 'none')
      .attr('pointer-events', 'none');
  } else if (!simplified && nodePathInfo) {
    const items = nodePathInfo.items;
    const colorMap = colorMaps[colorBy];
    const anglePerItem = (2 * Math.PI) / items.length;

    items.forEach((item, i) => {
      const startAngle = i * anglePerItem;
      const endAngle = (i + 1) * anglePerItem;
      const path = nodeGroup
        .append('path')
        .attr('d', d3.arc().innerRadius(0).outerRadius(NODE_RADIUS).startAngle(startAngle).endAngle(endAngle))
        .attr('fill', colorMap[item] || '#9e9e9e');
      if (includeDataAttrs) path.attr('data-slice', item);
    });
  } else {
    const circle = nodeGroup.append('circle').attr('r', NODE_RADIUS).attr('fill', getNodeColor(d)).attr('stroke', 'none');
    if (includeDataAttrs) circle.attr('data-single', true);
  }

  if (includeHub && !simplified) {
    nodeGroup.append('circle').attr('class', 'node-hub').attr('r', 6);
  }
}

//////////////////////////////////////////////////////
//////////////////////////////////////////////////////


// Define zoom settings (split mobile vs desktop).
// Values below default to the existing behavior; tweak separately as needed.
const ZOOM_MIN_DESKTOP = 0.03;
const ZOOM_MAX_DESKTOP = 0.8;
const ZOOM_MIN_MOBILE = 0.01;
const ZOOM_MAX_MOBILE = 1;

// Multiplier applied to the computed "fit-to-viewport" initial zoom scale.
// (1 keeps current behavior; increase >1 to zoom in more initially on mobile/desktop.)
const INITIAL_ZOOM_MULTIPLIER_DESKTOP = 1.4;
const INITIAL_ZOOM_MULTIPLIER_MOBILE = 1.0;

// Cluster mode: when zoomed below the viewport-specific threshold, large groups collapse
// into a single organic "cloud" shape and smaller groups disappear entirely.
// This avoids per-node DOM/physics work when the user can't visually distinguish
// individual nodes anyway.
const ZOOM_CLUSTER_THRESHOLD_DESKTOP = 0.08;
const ZOOM_CLUSTER_THRESHOLD_MOBILE = 0.08;
const CLUSTER_GROUP_MIN_NODES = 8;
const CLUSTER_EXIT_HYSTERESIS = 0.02;
const CLUSTER_EXCLUDED_COLORS = new Set(['#9e9e9e', '#999999', '#808080', 'gray', 'grey']);

const MOBILE_BREAKPOINT_PX = 768;
function isMobileViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches;
}

function isDesktopSafariBrowser() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isSafariEngine = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|CriOS\/|FxiOS\//.test(ua);
  const isMacDesktop = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) === 0;
  return isSafariEngine && isMacDesktop;
}

function getZoomClusterThreshold() {
  return isMobileViewport() ? ZOOM_CLUSTER_THRESHOLD_MOBILE : ZOOM_CLUSTER_THRESHOLD_DESKTOP;
}

function shouldExcludeClusterColor(color) {
  if (color == null) return true;
  return CLUSTER_EXCLUDED_COLORS.has(String(color).trim().toLowerCase());
}

const MIN_CLUSTER_COLOR_RADIUS = 14;
const MIN_CLUSTER_AREA = Math.PI * MIN_CLUSTER_COLOR_RADIUS * MIN_CLUSTER_COLOR_RADIUS;

function buildColorClusterCircles(groupNodes, getNodeColor, groupCenter) {
  const nodesByColor = new Map();
  groupNodes.forEach((n) => {
    const color = getNodeColor(n);
    if (shouldExcludeClusterColor(color)) return;
    if (!nodesByColor.has(color)) nodesByColor.set(color, []);
    nodesByColor.get(color).push(n);
  });

  const circles = [];
  nodesByColor.forEach((nodes, color) => {
    if (!nodes.length) return;

    let bestDx = 0;
    let bestDy = 0;
    let maxDistSq = 0;
    let midX = nodes[0].x;
    let midY = nodes[0].y;

    if (nodes.length > 1) {
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const distSq = dx * dx + dy * dy;
          if (distSq > maxDistSq) {
            maxDistSq = distSq;
            bestDx = dx;
            bestDy = dy;
            midX = (nodes[i].x + nodes[j].x) / 2;
            midY = (nodes[i].y + nodes[j].y) / 2;
          }
        }
      }
    }

    const furthestDistance = Math.sqrt(bestDx * bestDx + bestDy * bestDy);
    const rawRadius = furthestDistance / 2;
    const radius = Math.max(MIN_CLUSTER_COLOR_RADIUS, rawRadius);
    const area = Math.max(MIN_CLUSTER_AREA, Math.PI * radius * radius);
    const density = nodes.length / area;

    circles.push({
      color,
      count: nodes.length,
      cx: midX - groupCenter.x,
      cy: midY - groupCenter.y,
      radius,
      density
    });
  });

  return circles;
}

// Canvas: circle clip, soft rim; dark inner disk ↔ light outer; drag clamp shares CANVAS_WHITE_INSET / OUTER_RADIUS.
const LEGACY_SQUARE_SIDE = 25000;
const CANVAS_SCALE = 0.85;
const CIRCLE_DIAMETER = LEGACY_SQUARE_SIDE * 1.5 * CANVAS_SCALE;
const CIRCLE_RADIUS = CIRCLE_DIAMETER / 2;
const CIRCLE_CX = CIRCLE_RADIUS;
const CIRCLE_CY = CIRCLE_RADIUS;

const CANVAS_EDGE_FEATHER_HALF = 2800;
const CANVAS_BACKDROP_RADIUS = CIRCLE_RADIUS + CANVAS_EDGE_FEATHER_HALF;
const VISUAL_SCENE_EXTENT = CIRCLE_DIAMETER + 2 * CANVAS_EDGE_FEATHER_HALF;
const CANVAS_WHITE_INSET = 1300;
const CANVAS_WHITE_OUTER_RADIUS = Math.max(0, CIRCLE_RADIUS - CANVAS_EDGE_FEATHER_HALF - CANVAS_WHITE_INSET);

/** Widen the logo’s dark zone vs panel math so blackback kicks in at the edge of the ramp, not only when fully black. */
const LOGO_DARK_DISK_RADIUS_FACTOR = 1.06;

// clamping and color-map helpers are extracted in feature modules.

////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////

// 4. Component definition and state initialization

const NetworkGraph = ({
  colorBy,
  setColorBy,
  data,
  interactivePhysics = false,
  onNodeCrawl,
  onUiSurfaceChange
}) => {
  const svgRef = useRef();
  const visualizationAreaRef = useRef(null);
  const hoverStatusRef = useRef(null);
  const controlsRef = useRef(null);
  const zoomRef = useRef(null);
  const zoomCleanupRef = useRef(null);
  const interactivePhysicsRef = useRef(interactivePhysics);
  interactivePhysicsRef.current = interactivePhysics;
  // Latest onNodeCrawl callback, accessed inside long-press handlers without rebinding.
  const onNodeCrawlRef = useRef(onNodeCrawl);
  useEffect(() => {
    onNodeCrawlRef.current = onNodeCrawl;
  });
  const onUiSurfaceChangeRef = useRef(onUiSurfaceChange);
  useEffect(() => {
    onUiSurfaceChangeRef.current = onUiSurfaceChange;
  });
  const [colorMaps, setColorMaps] = useState({});
  const [darkSurface, setDarkSurface] = useState(false);

///////////////////////////////////////////////////////
///////////////////////////////////////////////////////

// 5. Color-map generation useEffect

  // Build one `colorMaps[key] = { value→color }` map for *all* keys in one pass
  useEffect(() => {
    const nodes = data.nodes;
    if (!nodes?.length) {
        setColorMaps({});
      return;
    }
    setColorMaps(buildColorMaps(nodes));
  }, [data]);


////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////

// 8. getNodeColor & createNodePath (node coloring and multi-value splitting)

  const getNodeColor = useCallback((d) => {
    return getNodeColorFromMaps(d, colorBy, colorMaps);
  }, [colorMaps, colorBy]);

  /**
   * Build slice information for ANY comma‑separated multivalue field.
   * Returns { items, colorMap } or null if single‑valued.
   */
  const createNodePath = useCallback((d) => {
    return createNodePathInfo(d, colorBy, colorMaps);
  }, [colorMaps, colorBy]);

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

// 9. setupZoom behavior configuration


  // Setup zoom behavior
  // Hybrid pan/zoom (Figma-ish on trackpad, Maps-ish on mouse):
  //   - trackpad pinch  -> zoom (wheel + ctrlKey/metaKey)
  //   - trackpad swipe  -> pan  (wheel, small/fractional/horizontal delta)
  //   - mouse wheel     -> zoom (focal at cursor)
  //   - shift + wheel   -> horizontal pan
  //   - left drag       -> pan  (handled by d3.zoom)
  //   - middle drag     -> pan  (custom pointer handler below)
  //   - dblclick        -> ignored
  const setupZoom = (svg, g, containerWidth, containerHeight, onTransformChange) => {
    const node = svg.node();

    const mobile = isMobileViewport();
    const ZOOM_MIN = mobile ? ZOOM_MIN_MOBILE : ZOOM_MIN_DESKTOP;
    const ZOOM_MAX = mobile ? ZOOM_MAX_MOBILE : ZOOM_MAX_DESKTOP;

    const zoom = d3.zoom()
      .scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .translateExtent([
        [CIRCLE_CX - CANVAS_BACKDROP_RADIUS - 100, CIRCLE_CY - CANVAS_BACKDROP_RADIUS - 100],
        [CIRCLE_CX + CANVAS_BACKDROP_RADIUS + 100, CIRCLE_CY + CANVAS_BACKDROP_RADIUS + 100]
      ])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        onTransformChange?.(event.transform);
      })
      .filter((event) => {
        if (event.type === 'dblclick') return false;
        // Wheel is routed manually to support hybrid pan/zoom semantics.
        if (event.type === 'wheel') return false;
        // Allow left button (0) for normal pan; middle button (1) is handled separately.
        if (event.type === 'mousedown') return event.button === 0;
        return true;
      });

    // Fit the circular bounding box in the viewport
    const scaleX = containerWidth / VISUAL_SCENE_EXTENT;
    const scaleY = containerHeight / VISUAL_SCENE_EXTENT;
    const initialScaleBase = Math.min(scaleX, scaleY);
    const initialZoomMultiplier = mobile ? INITIAL_ZOOM_MULTIPLIER_MOBILE : INITIAL_ZOOM_MULTIPLIER_DESKTOP;
    const initialScale = initialScaleBase * initialZoomMultiplier;

    const initialTransform = d3.zoomIdentity
      .translate(containerWidth / 2, containerHeight / 2)
      .scale(initialScale)
      .translate(-CIRCLE_CX, -CIRCLE_CY);

    svg.call(zoom)
      .call(zoom.transform, initialTransform)
      .call(zoom.touchable(true));

    // Pan cursor: only force grabbing while actively panning the view (not on node drag).
    // Idle graph uses cursor: default from CSS; clear inline cursor when done so that applies again.
    const resetSvgPanCursor = () => {
      svg.style('cursor', null);
    };

    const clearGrabIfNoButtonHeld = (e) => {
      if (!e.buttons) resetSvgPanCursor();
    };

    const isViewPanCursorSurface = (event) => {
      const el = event.target;
      return Boolean(el && typeof el.closest === 'function' && !el.closest('.node'));
    };

    svg
      .on('mousedown.indicator', (event) => {
        if (event.button !== 0) return;
        if (!isViewPanCursorSurface(event)) return;
        svg.style('cursor', 'grabbing');
      })
      .on('mouseup.indicator', (event) => {
        if (event.button !== 0) return;
        resetSvgPanCursor();
      });

    window.addEventListener('pointerup', resetSvgPanCursor, true);
    window.addEventListener('pointercancel', resetSvgPanCursor, true);
    window.addEventListener('pointermove', clearGrabIfNoButtonHeld, true);

    const onWheel = (e) => {
      e.preventDefault();
      const sel = d3.select(node);
      const isPinchZoom = e.ctrlKey || e.metaKey;

      if (isPinchZoom) {
        const [px, py] = d3.pointer(e, node);
        const sensitivity = 0.01;
        const factor = Math.exp(-e.deltaY * sensitivity);
        sel.call(zoom.scaleBy, factor, [px, py]);
        return;
      }

      // pan: convert screen-pixel delta to world units (divide by current scale k).
      const t = d3.zoomTransform(node);
      const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
      const dy = e.shiftKey ? 0 : -e.deltaY;
      sel.call(zoom.translateBy, dx / t.k, dy / t.k);
    };
    node.addEventListener('wheel', onWheel, { passive: false });

    // Middle-mouse drag pan (kept separate from d3.zoom which only handles button 0).
    const onPointerDown = (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      try { node.setPointerCapture(e.pointerId); } catch (_) { /* not all targets support capture */ }

      let lastX = e.clientX;
      let lastY = e.clientY;
      svg.style('cursor', 'grabbing');

      const onMove = (m) => {
        const dx = m.clientX - lastX;
        const dy = m.clientY - lastY;
        lastX = m.clientX;
        lastY = m.clientY;
        const t = d3.zoomTransform(node);
        d3.select(node).call(zoom.translateBy, dx / t.k, dy / t.k);
      };
      const onUp = () => {
        node.removeEventListener('pointermove', onMove);
        node.removeEventListener('pointerup', onUp);
        node.removeEventListener('pointercancel', onUp);
        svg.style('cursor', null);
      };
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', onUp);
      node.addEventListener('pointercancel', onUp);
    };
    node.addEventListener('pointerdown', onPointerDown);

    // Suppress browser auto-scroll cursor / context menu on middle button.
    const onAuxClick = (e) => {
      if (e.button === 1) e.preventDefault();
    };
    node.addEventListener('auxclick', onAuxClick);

    const cleanup = () => {
      window.removeEventListener('pointerup', resetSvgPanCursor, true);
      window.removeEventListener('pointercancel', resetSvgPanCursor, true);
      window.removeEventListener('pointermove', clearGrabIfNoButtonHeld, true);
      svg.on('mousedown.indicator', null).on('mouseup.indicator', null);
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('auxclick', onAuxClick);
    };

    return { zoom, cleanup };
  };


  useEffect(() => {
    const handleResize = () => {
      if (svgRef.current?.parentElement) {
        const svg = d3.select(svgRef.current);
        svg.attr('viewBox', `0 0 ${svgRef.current.parentElement.clientWidth} ${window.innerHeight * 0.7}`);

        if (zoomRef.current) {
          svg.select('g').attr('transform', d3.zoomTransform(svg.node()));
        }
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Touch event handler
  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return undefined;

    const handleTouch = (e) => {
      if (e.touches?.length >= 2) e.preventDefault();
    };

    const options = { passive: false };
    svgElement.addEventListener('touchmove', handleTouch, options);
    svgElement.addEventListener('touchstart', handleTouch, options);

    return () => {
      svgElement.removeEventListener('touchmove', handleTouch);
      svgElement.removeEventListener('touchstart', handleTouch);
    };
  }, []);

  // Main visualization effect
  useEffect(() => {
    if (!svgRef.current || !data || !data.nodes || data.nodes.length === 0) return undefined;
    const isMobile = isMobileViewport();
    const isDesktopSafari = isDesktopSafariBrowser();
    const enableHeavySvgEffects = !isMobile && !isDesktopSafari;

    if (zoomCleanupRef.current) {
      zoomCleanupRef.current();
      zoomCleanupRef.current = null;
    }
    // Declared outside `try` so effect cleanup can remove listeners / stop simulators safely.
    let handleGlobalDragRelease = null;
    let simulation = null;
    let nodeClickTimer = null;
    let groupMiniSimInstance = null;
    let longPressTeardown = null;
    /** Assigned inside try once helpers exist; cleanup always calls a safe no-op if render failed. */
    let teardownGroupMiniSimOnly = () => {};
    try {
      const containerWidth = svgRef.current.parentElement.clientWidth || 800;
      const containerHeight = window.innerHeight * 0.7 || 600;

      const width = containerWidth;
      const height = containerHeight;

      // Clear previous SVG content
      d3.select(svgRef.current).selectAll('*').remove();

      // Create SVG with responsive sizing
      const svg = d3.select(svgRef.current)
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet');

      const defs = svg.append('defs');
      defs.append('clipPath')
        .attr('id', 'viewport-circle-clip')
        .append('circle')
        .attr('cx', CIRCLE_CX)
        .attr('cy', CIRCLE_CY)
        .attr('r', CIRCLE_RADIUS);

      const R_grad = CANVAS_BACKDROP_RADIUS;
      const H = CANVAS_EDGE_FEATHER_HALF;
      const pctOfDist = dist => `${(Math.min(dist, R_grad) / R_grad) * 100}%`;

      const canvasEdgeGrad = defs.append('radialGradient')
        .attr('id', 'canvas-edge-soft')
        .attr('gradientUnits', 'userSpaceOnUse')
        .attr('cx', CIRCLE_CX)
        .attr('cy', CIRCLE_CY)
        .attr('fx', CIRCLE_CX)
        .attr('fy', CIRCLE_CY)
        .attr('r', R_grad);

      // Smoother black→white backdrop ramp (center dark → outer light; avoid visible “banding” / seam).
      // We generate many stops between a slightly earlier transition start and the
      // outer radius, using easing + a dense color interpolation.
      const INNER_EDGE = '#0a0a0b';
      const transitionStartR = Math.max(0, CANVAS_WHITE_OUTER_RADIUS - H * 0.22);
      const fadeStartU = 0.94; // start fading to transparent only near the very edge
      const fadePow = 0.85; // lower = gentler fade curve
      const stopCount = 40; // denser stops => fewer chances of visible banding

      const colorInterp = d3.interpolateRgbBasis([
        '#fafbfc',
        '#eef0f4',
        '#d4d7de',
        '#a8adb8',
        '#8b909b',
        '#6e737d',
        '#4b4e56',
        '#32343a',
        '#1b1c20',
        '#0a0a0b',
        '#000000',
      ]);

      // Keep the early region flat/dark so the inner disk feels crisp.
      canvasEdgeGrad.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', INNER_EDGE)
        .attr('stop-opacity', 1);

      const smoothstep = (t) => t * t * (3 - 2 * t);

      for (let i = 0; i < stopCount; i++) {
        const u = i / (stopCount - 1); // 0..1 across (transitionStartR..R_grad)
        const r = transitionStartR + (R_grad - transitionStartR) * u;
        const offset = pctOfDist(r);
        const eased = smoothstep(u);

        // Fade only in the last ~6% of the radius; this preserves the “solid”
        // look before blending into the white page background.
        const opacity = u < fadeStartU
          ? 1
          : Math.pow((1 - u) / (1 - fadeStartU), fadePow);

        canvasEdgeGrad.append('stop')
          .attr('offset', offset)
          .attr('stop-color', colorInterp(1 - eased))
          .attr('stop-opacity', opacity);
      }

      if (enableHeavySvgEffects) {
        // Keep blur polish on desktop only; skip on mobile for GPU headroom.
        const backdropSoften = defs.append('filter')
          .attr('id', 'backdrop-soften')
          .attr('x', '-15%')
          .attr('y', '-15%')
          .attr('width', '130%')
          .attr('height', '130%');
        backdropSoften.append('feGaussianBlur')
          .attr('in', 'SourceGraphic')
          .attr('stdDeviation', 2.2);
      }
      // No arrowhead marker: each link is rendered as a tapered wedge
      // (linkWedgePath in ./geometry) whose shape itself encodes direction.

      if (enableHeavySvgEffects) {
        // Soft halo around link wedges — applied to the active link layer
        // so links read as luminous filaments rather than flat polygons.
        const linkGlow = defs.append('filter')
          .attr('id', 'link-glow')
          .attr('x', '-20%')
          .attr('y', '-20%')
          .attr('width', '140%')
          .attr('height', '140%');
        linkGlow.append('feGaussianBlur')
          .attr('in', 'SourceGraphic')
          .attr('stdDeviation', 1.2)
          .attr('result', 'blur');
        const linkGlowMerge = linkGlow.append('feMerge');
        linkGlowMerge.append('feMergeNode').attr('in', 'blur');
        linkGlowMerge.append('feMergeNode').attr('in', 'SourceGraphic');
      }

      if (enableHeavySvgEffects) {
        // Keep cluster cloud blur on desktop only; skip on mobile.
        const clusterFilter = defs.append('filter')
          .attr('id', 'cluster-cloud')
          .attr('x', '-30%')
          .attr('y', '-30%')
          .attr('width', '160%')
          .attr('height', '160%');
        clusterFilter.append('feGaussianBlur')
          .attr('in', 'SourceGraphic')
          .attr('stdDeviation', 14)
          .attr('result', 'blur');
        clusterFilter.append('feColorMatrix')
          .attr('in', 'blur')
          .attr('mode', 'matrix')
          .attr('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 14 -6');
      }

      // Create a group for the visualization (zoom target)
      const g = svg.append('g');

      g.append('g')
        .attr('class', 'canvas-backdrop')
        .attr('pointer-events', 'none')
        .append('circle')
        .attr('cx', CIRCLE_CX)
        .attr('cy', CIRCLE_CY)
        .attr('r', CANVAS_BACKDROP_RADIUS)
        .attr('fill', 'url(#canvas-edge-soft)')
        .attr('filter', enableHeavySvgEffects ? 'url(#backdrop-soften)' : null);

      const world = g.append('g')
        .attr('clip-path', 'url(#viewport-circle-clip)')
        .attr('class', 'network-world');

      /* ──────────  GROUP‑AWARE LAYOUT (inside disk) ────────── */
      const groupMap = buildGroupsFromData(data.nodes, data.links);
      const groupCount = Math.max(...groupMap.values()) + 1;

      const groupSizes = Array.from({ length: groupCount }, () => 0);
      data.nodes.forEach(n => { groupSizes[groupMap.get(n.id)] += 1; });

      const BASE_R = 200;
      const PX_PER_NODE = 25;
      const groupR = groupSizes.map(s => BASE_R + PX_PER_NODE * Math.sqrt(s));

      const PAD = 700;
      const centres = Array.from({ length: groupCount }, () => null);
      const rng = () => Math.random();

      const uniformPointInDisk = (maxDistFromCentre) => {
        const theta = rng() * 2 * Math.PI;
        const radius = Math.sqrt(rng()) * Math.max(0, maxDistFromCentre);
        return {
          x: CIRCLE_CX + radius * Math.cos(theta),
          y: CIRCLE_CY + radius * Math.sin(theta)
        };
      };

      const movableLimit = Math.max(0, CANVAS_WHITE_OUTER_RADIUS - NODE_RADIUS - 10);
      const clampToMovableDisk = (x, y) => {
        const dx = x - CIRCLE_CX;
        const dy = y - CIRCLE_CY;
        const dist = Math.hypot(dx, dy);
        if (!Number.isFinite(dist) || dist <= movableLimit || dist === 0) return { x, y };
        const s = movableLimit / dist;
        return { x: CIRCLE_CX + dx * s, y: CIRCLE_CY + dy * s };
      };

      // Place larger groups first and choose the best candidate (maximizes
      // clearance to both existing groups and the outer wall) to avoid clumping.
      const groupOrder = Array.from({ length: groupCount }, (_, gi) => gi)
        .sort((a, b) => groupR[b] - groupR[a]);
      const candidateCount = 220;
      const golden = Math.PI * (3 - Math.sqrt(5));
      groupOrder.forEach((gi, orderIndex) => {
        const maxCenterDist = Math.max(140, movableLimit - groupR[gi] - PAD);
        let best = null;
        let bestScore = -Infinity;
        const nCandidates = Math.max(36, candidateCount - orderIndex * 5);

        for (let i = 0; i < nCandidates; i++) {
          const u = (i + 0.5) / nCandidates;
          const theta = i * golden + rng() * 0.18;
          const radius = Math.sqrt(u) * maxCenterDist;
          const cand = {
            x: CIRCLE_CX + radius * Math.cos(theta),
            y: CIRCLE_CY + radius * Math.sin(theta)
          };

          const wallClearance = maxCenterDist - radius;
          let overlapPenalty = 0;
          let nearestGap = Infinity;
          for (let j = 0; j < groupCount; j++) {
            const c = centres[j];
            if (!c) continue;
            const dx = c.x - cand.x;
            const dy = c.y - cand.y;
            const dist = Math.hypot(dx, dy);
            const minGap = groupR[j] + groupR[gi] + PAD;
            const gap = dist - minGap;
            nearestGap = Math.min(nearestGap, gap);
            if (gap < 0) overlapPenalty += (-gap) * 1000;
          }
          if (!Number.isFinite(nearestGap)) nearestGap = maxCenterDist;

          const score = nearestGap * 2.5 + wallClearance - overlapPenalty;
          if (score > bestScore) {
            bestScore = score;
            best = cand;
          }
        }

        centres[gi] = best || uniformPointInDisk(maxCenterDist);
      });

      const nodesByGroupSeed = Array.from({ length: groupCount }, () => []);
      data.nodes.forEach((n) => {
        nodesByGroupSeed[groupMap.get(n.id)].push(n);
      });

      // Seed nodes with Poisson-like rejection inside each group's disk so they
      // start dispersed instead of piled near the center.
      for (let gi = 0; gi < groupCount; gi++) {
        const c = centres[gi] || { x: CIRCLE_CX, y: CIRCLE_CY };
        const groupNodes = nodesByGroupSeed[gi];
        const seeded = [];
        const radialLimit = Math.max(groupR[gi] - 36, 28);
        const minSepBase = Math.min(92, Math.max(42, NODE_RADIUS * 1.7));

        groupNodes.forEach((n, idx) => {
          let placed = null;
          for (let attempt = 0; attempt < 60; attempt++) {
            const θ = rng() * 2 * Math.PI;
            const r = Math.sqrt(rng()) * radialLimit;
            const cand = {
              x: c.x + r * Math.cos(θ),
              y: c.y + r * Math.sin(θ)
            };
            const clamped = clampToMovableDisk(cand.x, cand.y);
            const minSep = Math.max(20, minSepBase - attempt * 0.85);
            const isFarEnough = seeded.every((p) => {
              const dx = p.x - clamped.x;
              const dy = p.y - clamped.y;
              return (dx * dx + dy * dy) >= minSep * minSep;
            });
            if (isFarEnough) {
              placed = clamped;
              break;
            }
          }

          if (!placed) {
            const fallbackTheta = (idx + 1) * golden;
            const fallbackR = Math.sqrt((idx + 1) / (groupNodes.length + 1)) * radialLimit;
            placed = clampToMovableDisk(
              c.x + fallbackR * Math.cos(fallbackTheta),
              c.y + fallbackR * Math.sin(fallbackTheta)
            );
          }

          n.x = placed.x;
          n.y = placed.y;
          seeded.push(placed);
        });
      }

      let currentTransform = d3.zoomIdentity;
      let visibleGroups = new Set();
      let lastPanelUiIsDark = null;
      let lastLogoUiIsDark = null;
      let inClusterMode = false;

      const linkForce = d3.forceLink(data.links)
        .id(d => d.id)
        .distance(LINK_FORCE_DISTANCE)
        .strength(LINK_FORCE_STRENGTH);

      simulation = d3.forceSimulation(data.nodes)
        .force('link', linkForce)
        .force('collision', d3.forceCollide().radius(84))
        .alphaDecay(0.1) // controls cooldown speed
        .on('end', () => {
          simulation.stop(); // freeze after global layout settles
        });

      data.nodes.forEach((n) => {
        n.__groupIndex = groupMap.get(n.id);
      });
      data.links.forEach((l) => {
        l.__groupIndex = groupMap.get(l.source.id ?? l.source);
      });

      // Mutual / reciprocal edge detection. The data model is purely directed
      // (one row per "A follows B"), so a mutual relationship appears as two
      // separate links. We tag both members with __isMutual so the wedge
      // geometry can offset them perpendicularly into a "two-lane" layout.
      {
        const directed = new Set();
        for (const l of data.links) {
          const sId = l.source.id ?? l.source;
          const tId = l.target.id ?? l.target;
          directed.add(`${sId}\u0001${tId}`);
        }
        for (const l of data.links) {
          const sId = l.source.id ?? l.source;
          const tId = l.target.id ?? l.target;
          l.__isMutual = directed.has(`${tId}\u0001${sId}`);
        }
      }

      // Active + parked layers for DOM culling. Culled elements are moved to parked
      // layers (detached from visible world) and reattached when needed.
      const activeLinkLayer = world.append('g')
        .attr('class', 'link-layer-active')
        .attr('filter', enableHeavySvgEffects ? 'url(#link-glow)' : null);
      const activeNodeLayer = world.append('g').attr('class', 'node-layer-active');
      const activeClusterLayer = world.append('g').attr('class', 'cluster-layer-active');
      const parkedRoot = g.append('g')
        .attr('class', 'parked-dom-root')
        .attr('display', 'none')
        .attr('pointer-events', 'none');
      const parkedLinkLayer = parkedRoot.append('g').attr('class', 'link-layer-parked');
      const parkedNodeLayer = parkedRoot.append('g').attr('class', 'node-layer-parked');
      const parkedClusterLayer = parkedRoot.append('g').attr('class', 'cluster-layer-parked');

      // Create links — one filled tapered wedge per directed edge. The wedge
      // narrows toward the target, so the geometry itself communicates
      // direction (no separate arrow marker required). Mutual pairs are
      // offset perpendicularly inside computeLinkPath().
      const fullLinks = activeLinkLayer.selectAll('.link-full')
        .data(data.links)
        .enter()
        .append('path')
        .attr('class', 'link-full')
        .attr('fill', '#e5e7eb')
        .attr('stroke', 'none');

      // Create nodes
      const node = activeNodeLayer
        .selectAll('.node')
        .data(data.nodes)
        .enter()
        .append('g')
        .attr('class', 'node')
        .call(d3.drag()
          .on('start', dragstarted)
          .on('drag', dragged)
          .on('end', dragended));

      // ── Cluster layer (zoom-out cloud blobs) ─────────────────────────────
      // One <g class="cluster"> per qualifying group. They start parked, then
      // get attached into activeClusterLayer in cluster mode.
      const clusterLayer = parkedClusterLayer;

      const computeGroupCentroid = (gi) => {
        let sx = 0;
        let sy = 0;
        let count = 0;
        for (const n of data.nodes) {
          if (n.__groupIndex === gi) {
            sx += n.x;
            sy += n.y;
            count += 1;
          }
        }
        if (count === 0) return { x: CIRCLE_CX, y: CIRCLE_CY };
        return { x: sx / count, y: sy / count };
      };

      const computeGroupClusterCircles = (gi) => {
        const groupNodes = [];
        for (const n of data.nodes) {
          if (n.__groupIndex === gi) groupNodes.push(n);
        }
        if (!groupNodes.length) return [];
        const center = computeGroupCentroid(gi);
        return buildColorClusterCircles(groupNodes, getNodeColor, center);
      };

      // Build one cluster <g> per qualifying group (hidden by default).
      const clusterGroupRecords = [];
      for (let gi = 0; gi < groupCount; gi++) {
        if (groupSizes[gi] < CLUSTER_GROUP_MIN_NODES) continue;
        const cg = clusterLayer.append('g')
          .attr('class', 'cluster')
          .attr('data-gi', gi)
          .attr('display', 'none')
          .style('cursor', 'pointer');
        clusterGroupRecords.push({ gi, sel: cg, size: groupSizes[gi] });
      }

      // Initial paint using current colorBy.
      clusterGroupRecords.forEach(({ gi, sel }) => {
        renderClusterContentsFromModule(sel, computeGroupClusterCircles(gi));
      });

      const fullLinksByGroup = Array.from({ length: groupCount }, () => []);
      fullLinks.each(function (d) {
        fullLinksByGroup[d.__groupIndex].push(this);
      });
      const nodesByGroup = Array.from({ length: groupCount }, () => []);
      node.each(function (d) {
        nodesByGroup[d.__groupIndex].push(this);
      });

      let currentHighlight = null;

      /** Apply highlight/dim only to viewport-visible groups (same culling as physics/DOM). */
      const applyViewportHighlightClasses = () => {
        if (inClusterMode || groupCount === 0) return;

        for (let gi = 0; gi < groupCount; gi++) {
          if (!visibleGroups.has(gi)) continue;

          const ns = nodesByGroup[gi];
          for (let i = 0; i < ns.length; i++) {
            const d = d3.select(ns[i]).datum();
            const gId = groupMap.get(d.id);
            const isHi = currentHighlight !== null && gId === currentHighlight;
            d3.select(ns[i])
              .classed('highlight', isHi)
              .classed('dim', currentHighlight !== null && !isHi);
          }

          const fl = fullLinksByGroup[gi];
          for (let i = 0; i < fl.length; i++) {
            const lk = d3.select(fl[i]).datum();
            const s = groupMap.get(lk.source.id ?? lk.source);
            const t = groupMap.get(lk.target.id ?? lk.target);
            const isLinkHi = s === currentHighlight && t === currentHighlight;
            d3.select(fl[i])
              .classed('highlight', isLinkHi)
              .classed('dim', currentHighlight !== null && !isLinkHi);
          }
        }
      };

      // Columbia Barnard legacy: per-group mini simulation while dragging (hold). Optional via UI toggle.
      teardownGroupMiniSimOnly = () => {
        if (groupMiniSimInstance) {
          groupMiniSimInstance.stop();
          groupMiniSimInstance = null;
        }
      };

      const resumeMainSimulationAfterGroupSim = () => {
        simulation.alphaTarget(0);
        simulation.alpha(0.08).restart();
      };

      const stopGroupMiniSimFully = () => {
        teardownGroupMiniSimOnly();
        resumeMainSimulationAfterGroupSim();
      };

      const updateGroupMiniDom = (gi) => {
        const ns = nodesByGroup[gi];
        for (let i = 0; i < ns.length; i += 1) {
          const el = ns[i];
          const nd = d3.select(el).datum();
          d3.select(el).attr('transform', `translate(${nd.x},${nd.y})`);
        }
        const fl = fullLinksByGroup[gi];
        for (let i = 0; i < fl.length; i += 1) {
          const el = fl[i];
          const lk = d3.select(el).datum();
          d3.select(el).attr('d', computeLinkPath(lk));
        }
      };

      const startGroupMiniSim = (gi) => {
        if (!interactivePhysicsRef.current) return false;
        if (inClusterMode) return false;
        if (!Number.isFinite(gi)) return false;
        teardownGroupMiniSimOnly();
        simulation.stop();

        const groupNodes = data.nodes.filter((n) => n.__groupIndex === gi);
        const groupLinks = data.links.filter((l) => {
          const s = groupMap.get(l.source.id ?? l.source);
          const t = groupMap.get(l.target.id ?? l.target);
          return s === gi && t === gi;
        });
        if (groupNodes.length === 0) {
          resumeMainSimulationAfterGroupSim();
          return false;
        }

        groupMiniSimInstance = d3
          .forceSimulation(groupNodes)
          .force('link', d3.forceLink(groupLinks).id((n) => n.id).distance(LINK_FORCE_DISTANCE_GROUP_MINI).strength(LINK_FORCE_STRENGTH))
          .force('collision', d3.forceCollide().radius(56))
          .alphaDecay(0)
          .force('charge', d3.forceManyBody().strength(-1500))
          .on('tick', () => {
            clampNodesToDisk(groupNodes);
            updateGroupMiniDom(gi);
          });

        groupMiniSimInstance.alpha(1).restart();
        return true;
      };

      const clusterByGroup = Array.from({ length: groupCount }, () => null);
      clusterGroupRecords.forEach(({ gi, sel }) => {
        clusterByGroup[gi] = sel.node();
      });

      let nodeAttached = Array.from({ length: groupCount }, () => true);
      let linkAttached = Array.from({ length: groupCount }, () => true);
      let clusterAttached = Array.from({ length: groupCount }, () => false);

      const moveElems = (elems, parentNode) => {
        if (!parentNode || !elems?.length) return;
        elems.forEach((el) => {
          if (el && el.parentNode !== parentNode) {
            parentNode.appendChild(el);
          }
        });
      };

      const setGroupNodeAttachment = (gi, attach) => {
        if (nodeAttached[gi] === attach) return;
        moveElems(nodesByGroup[gi], attach ? activeNodeLayer.node() : parkedNodeLayer.node());
        nodeAttached[gi] = attach;
      };

      const setGroupLinkAttachment = (gi, attach) => {
        if (linkAttached[gi] === attach) return;
        const target = attach ? activeLinkLayer.node() : parkedLinkLayer.node();
        moveElems(fullLinksByGroup[gi], target);
        linkAttached[gi] = attach;
      };

      const setGroupClusterAttachment = (gi, attach) => {
        if (clusterAttached[gi] === attach) return;
        const el = clusterByGroup[gi];
        if (!el) {
          clusterAttached[gi] = false;
          return;
        }
        const target = attach ? activeClusterLayer.node() : parkedClusterLayer.node();
        if (el.parentNode !== target) target.appendChild(el);
        clusterAttached[gi] = attach;
      };

      const updateUiSurfaceTheme = () => {
        const graphRect = svgRef.current.getBoundingClientRect();
        if (!graphRect.width || !graphRect.height) return;

        const screenPxIsDark = (sx, sy) => {
          const wx = (sx - currentTransform.x) / currentTransform.k;
          const wy = (sy - currentTransform.y) / currentTransform.k;
          const dist = Math.hypot(wx - CIRCLE_CX, wy - CIRCLE_CY);
          return dist < CANVAS_WHITE_OUTER_RADIUS * 1.5;
        };

        const logoPxIsDark = (sx, sy) => {
          const wx = (sx - currentTransform.x) / currentTransform.k;
          const wy = (sy - currentTransform.y) / currentTransform.k;
          const dist = Math.hypot(wx - CIRCLE_CX, wy - CIRCLE_CY);
          return dist < CANVAS_WHITE_OUTER_RADIUS * 1.2 * LOGO_DARK_DISK_RADIUS_FACTOR;
        };

        const controlsEl = controlsRef.current;
        if (controlsEl) {
          const panelRect = controlsEl.getBoundingClientRect();
          const sx = panelRect.left + panelRect.width / 2 - graphRect.left;
          const sy = panelRect.top + panelRect.height / 2 - graphRect.top;
          const panelIsDark = screenPxIsDark(sx, sy);
          if (panelIsDark !== lastPanelUiIsDark) {
            lastPanelUiIsDark = panelIsDark;
            setDarkSurface(panelIsDark);
          }
        }

        // Upper-left app logo (`App.css` `.app-logo-anchor` + ~half rendered size).
        const logoInset = 12;
        const logoSx = logoInset + 36;
        const logoSy = logoInset + 17;
        const logoIsDark = logoPxIsDark(logoSx, logoSy);
        if (logoIsDark !== lastLogoUiIsDark) {
          lastLogoUiIsDark = logoIsDark;
          const notify = onUiSurfaceChangeRef.current;
          if (typeof notify === 'function') notify(logoIsDark);
        }
      };

      const enterClusterMode = () => {
        inClusterMode = true;
        teardownGroupMiniSimOnly();

        // DOM-cull all individual nodes/links while clustered.
        for (let gi = 0; gi < groupCount; gi++) {
          setGroupNodeAttachment(gi, false);
          setGroupLinkAttachment(gi, false);
        }

        // Freeze physics for ALL nodes so they hold position while clustered.
        data.nodes.forEach((n) => {
          if (!n.__clusterFrozen) {
            n.__prevFx = n.fx;
            n.__prevFy = n.fy;
            n.fx = n.x;
            n.fy = n.y;
            n.__clusterFrozen = true;
          }
        });
        simulation.stop();

        // Attach and position only qualifying clusters.
        clusterGroupRecords.forEach(({ gi, sel, size }) => {
          const c = computeGroupCentroid(gi);
          if (size >= CLUSTER_GROUP_MIN_NODES) {
            setGroupClusterAttachment(gi, true);
          }
          sel.attr('transform', `translate(${c.x},${c.y})`)
            .attr('display', null)
            .classed('culled', false);
        });
        for (let gi = 0; gi < groupCount; gi++) {
          if (groupSizes[gi] < CLUSTER_GROUP_MIN_NODES) {
            setGroupClusterAttachment(gi, false);
          }
        }

        visibleGroups = new Set();
      };

      const exitClusterMode = () => {
        inClusterMode = false;

        // Park all clusters when leaving cluster mode.
        clusterGroupRecords.forEach(({ gi, sel }) => {
          sel.attr('display', null).classed('culled', false);
          setGroupClusterAttachment(gi, false);
        });

        // Restore prior fx/fy on cluster-frozen nodes (which may have been null,
        // or pinned by the older viewport-cull path).
        data.nodes.forEach((n) => {
          if (n.__clusterFrozen) {
            n.fx = n.__prevFx ?? null;
            n.fy = n.__prevFy ?? null;
            n.__prevFx = undefined;
            n.__prevFy = undefined;
            n.__clusterFrozen = false;
            // Clear the older viewport-cull flag too, since we just set fx/fy.
            n.__culledFixed = false;
          }
        });

        // Force the cull below to re-evaluate from a clean slate.
        visibleGroups = new Set();
        simulation.alpha(0.2).restart();
      };

      const isClusterWanted = () => {
        const clusterThreshold = getZoomClusterThreshold();
        if (inClusterMode) {
          return currentTransform.k < (clusterThreshold + CLUSTER_EXIT_HYSTERESIS);
        }
        return currentTransform.k < clusterThreshold;
      };

      const commitClusterModeIfNeeded = () => {
        const wantClusterMode = isClusterWanted();
        if (wantClusterMode === inClusterMode) return false;
        if (wantClusterMode) {
          enterClusterMode();
        } else {
          exitClusterMode();
        }
        return true;
      };

      const applyGroupCulling = () => {
        const t = currentTransform;
        const wantClusterMode = isClusterWanted();
        if (wantClusterMode !== inClusterMode) {
          commitClusterModeIfNeeded();
        }
        if (inClusterMode) return;

        // ── Normal mode: viewport cull ──
        const margin = NODE_RADIUS + 20;
        const minX = (-t.x) / t.k - margin;
        const maxX = (width - t.x) / t.k + margin;
        const minY = (-t.y) / t.k - margin;
        const maxY = (height - t.y) / t.k + margin;

        const seen = Array.from({ length: groupCount }, () => false);
        let seenCount = 0;
        for (const n of data.nodes) {
          const gi = n.__groupIndex;
          if (seen[gi]) continue;
          if (n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY) {
            seen[gi] = true;
            seenCount += 1;
            if (seenCount === groupCount) break;
          }
        }

        const nextVisibleGroups = new Set();
        seen.forEach((v, i) => { if (v) nextVisibleGroups.add(i); });
        if (nextVisibleGroups.size === 0 && groupCount > 0) {
          nextVisibleGroups.add(0);
        }

        const changed =
          nextVisibleGroups.size !== visibleGroups.size
          || [...nextVisibleGroups].some(gi => !visibleGroups.has(gi));
        visibleGroups = nextVisibleGroups;
        if (!changed) return;

        // DOM-cull by moving full groups between active and parked layers.
        for (let gi = 0; gi < groupCount; gi++) {
          const shouldAttach = visibleGroups.has(gi);
          setGroupNodeAttachment(gi, shouldAttach);
          setGroupLinkAttachment(gi, shouldAttach);
          setGroupClusterAttachment(gi, false);
        }

        // Freeze physics for offscreen groups and unfreeze when visible again.
        data.nodes.forEach((n) => {
          const isVisible = visibleGroups.has(n.__groupIndex);
          if (!isVisible) {
            if (!n.__culledFixed && n.fx == null && n.fy == null) {
              n.fx = n.x;
              n.fy = n.y;
              n.__culledFixed = true;
            }
          } else if (n.__culledFixed) {
            n.fx = null;
            n.fy = null;
            n.__culledFixed = false;
          }
        });

        simulation.alpha(0.12).restart();
        updateUiSurfaceTheme();
        applyViewportHighlightClasses();
      };

      const { zoom, cleanup: cleanupZoom } = setupZoom(
        svg,
        g,
        width,
        height,
        (transform) => {
          currentTransform = transform;
          applyGroupCulling();
          updateUiSurfaceTheme();
        }
      );
      zoomRef.current = zoom;
      zoomCleanupRef.current = cleanupZoom;

      let suppressNextClick = false;

      node.on('click', (event, d) => {
        if (suppressNextClick) {
          suppressNextClick = false;
          return;
        }
        if (nodeClickTimer) clearTimeout(nodeClickTimer);
        nodeClickTimer = setTimeout(() => {
          nodeClickTimer = null;
          const grp = groupMap.get(d.id);
          currentHighlight = (currentHighlight === grp ? null : grp);
          applyViewportHighlightClasses();
          if (interactivePhysicsRef.current && currentHighlight == null) {
            stopGroupMiniSimFully();
          }
        }, 280);
      });

      node.on('dblclick', (event, d) => {
        event.preventDefault();
        event.stopPropagation();
        if (nodeClickTimer) {
          clearTimeout(nodeClickTimer);
          nodeClickTimer = null;
        }
        const raw = d.profileUrl != null ? String(d.profileUrl).trim() : '';
        const url =
          raw.length > 0 ? raw : `https://github.com/${encodeURIComponent(String(d.login ?? ''))}`;
        if (url.length > 0) {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      });

      const placeHoverNearPointer = (event) => {
        const el = hoverStatusRef.current;
        const areaEl = visualizationAreaRef.current;
        if (!el || !areaEl) return;
        const rect = areaEl.getBoundingClientRect();
        const pad = 8;
        const gap = 14;

        el.style.display = 'block';
        const ew = el.offsetWidth;
        const eh = el.offsetHeight;

        let left = event.clientX - rect.left + gap;
        let top = event.clientY - rect.top + gap;

        if (left + ew > rect.width - pad) {
          left = event.clientX - rect.left - gap - ew;
        }
        if (top + eh > rect.height - pad) {
          top = event.clientY - rect.top - gap - eh;
        }

        left = Math.max(pad, Math.min(left, rect.width - Math.max(ew, 40) - pad));
        top = Math.max(pad, Math.min(top, rect.height - Math.max(eh, 24) - pad));

        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
      };

      node
        .on('mouseover', (event, d) => {
          const el = hoverStatusRef.current;
          if (!el) return;
          el.textContent = formatNodeHoverText(d);
          el.style.display = 'block';
          placeHoverNearPointer(event);
        })
        .on('mousemove', (event) => {
          const el = hoverStatusRef.current;
          if (!el || el.style.display === 'none') return;
          placeHoverNearPointer(event);
        })
        .on('mouseout', () => {
          const el = hoverStatusRef.current;
          if (el) el.style.display = 'none';
        });

      // ── Long-press a node to crawl from it (hold-to-crawl) ───────────────
      // Held without movement for LONG_PRESS_MS → call onNodeCrawl(d.login).
      // Movement past LONG_PRESS_MOVE_CANCEL_PX cancels (becomes a drag/pan).
      let longPressTimer = null;
      let longPressStartX = 0;
      let longPressStartY = 0;
      let longPressActiveNode = null;
      let longPressActiveRing = null;
      // Set true when timer fires; OR'd into suppressNextClick by dragended so
      // the post-press click doesn't toggle the group highlight.
      let longPressFired = false;

      const resetLongPressRing = () => {
        if (!longPressActiveRing) return;
        const ringSel = d3.select(longPressActiveRing);
        ringSel.style('display', 'none')
          .style('transition', 'none')
          .attr('stroke-dasharray', null)
          .attr('stroke-dashoffset', null);
        longPressActiveRing = null;
      };

      const cancelLongPress = () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        resetLongPressRing();
        longPressActiveNode = null;
      };

      const onLongPressPointerMove = (event) => {
        if (!longPressTimer) return;
        const dx = event.clientX - longPressStartX;
        const dy = event.clientY - longPressStartY;
        if ((dx * dx + dy * dy) > (LONG_PRESS_MOVE_CANCEL_PX * LONG_PRESS_MOVE_CANCEL_PX)) {
          cancelLongPress();
        }
      };

      window.addEventListener('pointermove', onLongPressPointerMove, true);
      window.addEventListener('pointerup', cancelLongPress, true);
      window.addEventListener('pointercancel', cancelLongPress, true);
      window.addEventListener('blur', cancelLongPress);

      longPressTeardown = () => {
        cancelLongPress();
        window.removeEventListener('pointermove', onLongPressPointerMove, true);
        window.removeEventListener('pointerup', cancelLongPress, true);
        window.removeEventListener('pointercancel', cancelLongPress, true);
        window.removeEventListener('blur', cancelLongPress);
      };

      node.on('pointerdown', function (event, d) {
        // Mouse: only primary button; touch/pen: any.
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        cancelLongPress();
        longPressFired = false;
        longPressStartX = event.clientX;
        longPressStartY = event.clientY;
        longPressActiveNode = d;

        const ringSel = d3.select(this).select('.long-press-ring');
        const ringNode = ringSel.node();
        longPressActiveRing = ringNode;
        if (ringNode) {
          const r = NODE_RADIUS + 6;
          const C = 2 * Math.PI * r;
          ringSel
            .style('display', null)
            .style('transition', 'none')
            .attr('stroke-dasharray', C)
            .attr('stroke-dashoffset', C);
          // Force a reflow so the transition kicks in from the full-empty state.
          void ringNode.getBoundingClientRect();
          ringSel
            .style('transition', `stroke-dashoffset ${LONG_PRESS_MS}ms linear`)
            .attr('stroke-dashoffset', 0);
        }

        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          longPressFired = true;
          resetLongPressRing();
          const captured = longPressActiveNode;
          longPressActiveNode = null;
          // Release drag pin so the node isn't stuck where the press started.
          if (captured) {
            captured.fx = null;
            captured.fy = null;
          }
          // Prevent the upcoming click (after pointerup) from toggling highlight.
          suppressNextClick = true;
          const login = captured?.login;
          if (typeof login === 'string' && login.length > 0 && typeof onNodeCrawlRef.current === 'function') {
            try {
              onNodeCrawlRef.current(login);
            } catch (err) {
              console.error('onNodeCrawl failed:', err);
            }
          }
        }, LONG_PRESS_MS);
      });

      // ── Cluster interactivity (click-to-zoom) ───────────────────────────
      clusterGroupRecords.forEach(({ gi, sel }) => {
        const clusterSel = sel.style('pointer-events', 'auto');
        clusterSel.on('click', () => {
          const c = computeGroupCentroid(gi);
          const targetK = getZoomClusterThreshold() * 2.5;
          const target = d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(targetK)
            .translate(-c.x, -c.y);
          svg.transition()
            .duration(500)
            .call(zoom.transform, target);
        });
      });

      // Add node shapes
      node.each(function (d) {
        const nodeGroup = d3.select(this);
        const nodePathInfo = createNodePath(d);

        renderNodeVisual(nodeGroup, d, nodePathInfo, {
          colorMaps,
          colorBy,
          getNodeColor,
          simplified: false
        });

        // Hidden progress ring used to visualize long-press (hold-to-crawl).
        nodeGroup.append('circle')
          .attr('class', 'long-press-ring')
          .attr('r', NODE_RADIUS + 6)
          .attr('fill', 'none')
          .attr('pointer-events', 'none')
          .style('display', 'none');
      });

      // Keep node centers inside the draggable inner disk
      simulation.on('tick', () => {
        // In cluster mode, individual nodes/links are hidden and physics is
        // frozen, so skip all per-node DOM writes for performance.
        if (inClusterMode) {
          return;
        }

        clampNodesToDisk(data.nodes);

        fullLinks
          .filter(d => visibleGroups.has(d.__groupIndex))
          .attr('d', d => computeLinkPath(d));

        // Update node positions
        node
          .filter(d => visibleGroups.has(d.__groupIndex))
          .attr('transform', d => `translate(${d.x},${d.y})`);

        applyGroupCulling();
        updateUiSurfaceTheme();
      });

      updateUiSurfaceTheme();

      // Drag handlers
      let activeDragNode = null;
      /** True once pointer moved during drag; pure clicks never fire `dragged`. */
      let dragHadMovement = false;

      const releaseActiveDrag = () => {
        if (interactivePhysicsRef.current) {
          stopGroupMiniSimFully();
        }
        // Desktop should always release pinning after drag. On touch we preserve
        // the previous behavior (keep pinned) for direct-manipulation ergonomics.
        if (activeDragNode && !('ontouchstart' in window) && !navigator.maxTouchPoints) {
          activeDragNode.fx = null;
          activeDragNode.fy = null;
        }
        activeDragNode = null;
      };

      handleGlobalDragRelease = () => {
        if (!activeDragNode) return;
        releaseActiveDrag();
      };
      window.addEventListener('mouseup', handleGlobalDragRelease, true);
      window.addEventListener('blur', handleGlobalDragRelease);

      function dragstarted(event, d) {
        dragHadMovement = false;
        // Defensive: if a previous drag ended unexpectedly, clear stale pin.
        if (activeDragNode) {
          releaseActiveDrag();
        }

        activeDragNode = d;
        const gi = groupMap.get(d.id);
        const p = clampNodeToDisk(d.x, d.y);
        d.fx = p.x;
        d.fy = p.y;
        if (interactivePhysicsRef.current) {
          startGroupMiniSim(gi);
        } else {
          d.x = p.x;
          d.y = p.y;
          updateGroupMiniDom(gi);
        }
      }

      function dragged(event, d) {
        dragHadMovement = true;
        const c = clampNodeToDisk(event.x, event.y);
        d.fx = c.x;
        d.fy = c.y;
        if (!interactivePhysicsRef.current) {
          d.x = c.x;
          d.y = c.y;
          updateGroupMiniDom(groupMap.get(d.id));
        }
      }

      function dragended(event, d) {
        // Only swallow the following click when this was a real drag, OR when a
        // long-press just fired (so the crawl-trigger doesn't also toggle the
        // group highlight). Tap-to-select keeps both flags false.
        suppressNextClick = dragHadMovement || longPressFired;
        longPressFired = false;
        // Ensure we release whichever node is actively tracked even if d differs.
        activeDragNode = activeDragNode || d;
        releaseActiveDrag();
      }

    } catch (error) {
      console.error("Error rendering network visualization:", error);
    }

    return () => {
      if (nodeClickTimer != null) {
        clearTimeout(nodeClickTimer);
        nodeClickTimer = null;
      }
      if (handleGlobalDragRelease) {
        window.removeEventListener('mouseup', handleGlobalDragRelease, true);
        window.removeEventListener('blur', handleGlobalDragRelease);
      }
      if (longPressTeardown) {
        longPressTeardown();
        longPressTeardown = null;
      }
      teardownGroupMiniSimOnly();
      if (simulation) simulation.stop();
      if (zoomCleanupRef.current) {
        zoomCleanupRef.current();
        zoomCleanupRef.current = null;
      }
    };
    // Intentionally only `data`: full D3 scene graph is rebuilt when the dataset changes;
    // `colorBy` / `colorMaps` updates are handled by the recolor effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  }, [data]);


  // Lightweight recolor effect

  useEffect(() => {
    if (!svgRef.current || !colorMaps || !data?.nodes?.length) return;

    const groupMap = buildGroupsFromData(data.nodes, data.links ?? []);
    const vals = [...groupMap.values()];
    const groupCount = vals.length ? Math.max(...vals) + 1 : 0;
    const groupSizes = Array.from({ length: groupCount }, () => 0);
    data.nodes.forEach(n => { groupSizes[groupMap.get(n.id)] += 1; });

    const g = d3.select(svgRef.current).select('g');

    g.selectAll('.node').each(function (d) {
      const nodeGroup = d3.select(this);
      const nodePathInfo = createNodePath(d);

      nodeGroup.selectAll('path').remove();
      nodeGroup.selectAll('circle').remove();
      nodeGroup.selectAll('image').remove();
      nodeGroup.selectAll('defs').remove();

      renderNodeVisual(nodeGroup, d, nodePathInfo, {
        colorMaps,
        colorBy,
        getNodeColor,
        includeHub: false,
        includeDataAttrs: true
      });

      // Re-add the long-press progress ring (removed by the wipe above).
      nodeGroup.append('circle')
        .attr('class', 'long-press-ring')
        .attr('r', NODE_RADIUS + 6)
        .attr('fill', 'none')
        .attr('pointer-events', 'none')
        .style('display', 'none');
    });

    // Rebuild cluster contents so the cloud blob's color mix reflects the
    // newly-selected colorBy. Cluster <g>s were created lazily by the main
    // effect for groups with size >= CLUSTER_GROUP_MIN_NODES.
    g.selectAll('.cluster').each(function () {
      const clusterSel = d3.select(this);
      const gi = Number(clusterSel.attr('data-gi'));
      if (!Number.isFinite(gi)) return;
      const groupNodes = data.nodes.filter(n => groupMap.get(n.id) === gi);
      if (!groupNodes.length) return;

      const center = {
        x: groupNodes.reduce((sum, n) => sum + n.x, 0) / groupNodes.length,
        y: groupNodes.reduce((sum, n) => sum + n.y, 0) / groupNodes.length
      };
      const circles = buildColorClusterCircles(groupNodes, getNodeColor, center);
      renderClusterContentsFromModule(clusterSel, circles);
    });
  }, [colorBy, colorMaps, getNodeColor, createNodePath, data]);

  const desktopSafariClass = isDesktopSafariBrowser() ? ' desktop-safari' : '';

  return (
    <div className={`network-container${desktopSafariClass}`}>
      <div ref={visualizationAreaRef} className="visualization-area">
        <svg ref={svgRef} className="network-graph"
          aria-label="Network graph visualization - draggable view"></svg>

        <div
          ref={hoverStatusRef}
          className="graph-hover-status"
          role="status"
          aria-live="polite"
          style={{ display: 'none' }}
        />

        <div ref={controlsRef} className="controls-legend-container">
          <ControlPanel
            colorBy={colorBy}
            setColorBy={setColorBy}
            nodes={data.nodes}
            darkSurface={darkSurface}
          />
          <Legend colorBy={colorBy} data={data} darkSurface={darkSurface} />
        </div>
      </div>
    </div>
  );
};

export default NetworkGraph;