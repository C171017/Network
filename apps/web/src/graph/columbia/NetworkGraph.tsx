// Columbia D3 graph port — strict typing deferred (large d3/simulation surface).
// Dummy comment for push test.
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

function summarizeTopology(nodes, links) {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const linkKeys = new Set(
    (links ?? []).map((l) => {
      const s = typeof l.source === 'object' && l.source !== null ? l.source.id : l.source;
      const t = typeof l.target === 'object' && l.target !== null ? l.target.id : l.target;
      return `${s}->${t}`;
    }),
  );
  return { nodeIds, linkKeys };
}

function canIncrementalExpand(prevTopo, nextTopo) {
  if (!prevTopo) return false;
  if (nextTopo.linkKeys.size < prevTopo.linkKeys.size) return false;
  if (nextTopo.nodeIds.size < prevTopo.nodeIds.size) return false;
  for (const id of prevTopo.nodeIds) {
    if (!nextTopo.nodeIds.has(id)) return false;
  }
  for (const lk of prevTopo.linkKeys) {
    if (!nextTopo.linkKeys.has(lk)) return false;
  }
  return true;
}

function maxGroupPopulation(nodes, links) {
  if (!nodes?.length) return 0;
  const gm = buildGroupsFromData(nodes, links ?? []);
  const counts = [];
  gm.forEach((gi) => {
    counts[gi] = (counts[gi] ?? 0) + 1;
  });
  let max = 0;
  for (let i = 0; i < counts.length; i += 1) {
    if (counts[i] > max) max = counts[i];
  }
  return max;
}

function connectedComponentGroupCount(nodes, links) {
  if (!nodes?.length) return 0;
  const gm = buildGroupsFromData(nodes, links ?? []);
  const vals = [...gm.values()];
  return vals.length ? Math.max(...vals) + 1 : 0;
}

function topologySignature(nodes, links) {
  const { nodeIds, linkKeys } = summarizeTopology(nodes, links ?? []);
  return `${[...nodeIds].sort((a, b) => a - b).join(',')}|${[...linkKeys].sort().join(',')}`;
}

function mergeNodeAttributesPreservingSimulation(prevDatum, incoming) {
  Object.keys(incoming).forEach((k) => {
    if (['x', 'y', 'vx', 'vy', 'fx', 'fy', 'index'].includes(k)) return;
    if (k.startsWith('__')) return;
    prevDatum[k] = incoming[k];
  });
}

/** Never surfaced in hover (still used elsewhere, e.g. dbl‑click opens profile). */
const HOVER_HIDDEN_PROFILE_KEYS = new Set(['login', 'public_repos', 'public_gists', 'html_url', 'type']);

/** Prefer this order when reading from `profile` for extra rows. */
const PROFILE_HOVER_PRIORITY = [
  'name',
  'bio',
  'company',
  'location',
  'blog',
  'email',
  'twitter_username',
  'organizations',
  'hireable',
  'followers',
  'following',
  'created_at',
  'updated_at'
];

/** Shown outside the DL (chips / title / omitted JSON). */
const HOVER_KEYS_RENDERED_ABOVE = new Set([
  'name',
  'bio',
  'company',
  'location',
  'blog',
  'email',
  'twitter_username',
  'social_accounts',
  'organizations'
]);

function hoverNormalizeHrefKey(href) {
  try {
    const u = new URL(String(href).trim());
    u.hash = '';
    let path = u.pathname.replace(/\/+$/, '');
    if (path.toLowerCase() === '') path = '';
    let host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (host === 'x.com') host = 'twitter.com';
    if (host === 'twitter.com') {
      path = path.toLowerCase();
    } else if (host === 'github.com') {
      path = path.toLowerCase();
    }
    return `${host}${path}`;
  } catch {
    return String(href).trim().toLowerCase().replace(/\/+$/, '');
  }
}

function hoverSocialChipLabel(providerRaw) {
  const p = String(providerRaw ?? '').trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  if (!p) return 'Link';
  if (p === 'twitter' || p === 'x') return 'X / Twitter';
  if (p === 'bluesky') return 'Bluesky';
  if (p === 'linkedin') return 'LinkedIn';
  if (p === 'mastodon') return 'Mastodon';
  if (p === 'youtube') return 'YouTube';
  if (p === 'facebook') return 'Facebook';
  return humanizeHoverKey(p);
}

/** GitHub `/users/{login}/orgs`-style payloads: `{ login }` entries or bare login strings. */
function hoverExtractOrgLogin(entry) {
  if (typeof entry === 'string') return hoverTrim(entry);
  if (entry != null && typeof entry === 'object' && hoverTrim(entry.login)) return hoverTrim(entry.login);
  return '';
}

function hoverTrim(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
}

function humanizeHoverKey(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Blog / legacy website field → navigable URL, or null. */
function hoverBlogHref(raw) {
  const s = hoverTrim(raw);
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^www\./i.test(s)) return `https://${s}`;
  return null;
}

/** True when we should render a scalar row (excludes null, '', whitespace; keeps numeric 0). */
function hoverScalarIsPresent(val) {
  if (val == null) return false;
  if (typeof val === 'number') return Number.isFinite(val);
  if (typeof val === 'boolean') return true;
  if (typeof val === 'string') return hoverTrim(val) !== '';
  return false;
}

function formatHoverScalar(key, val) {
  if (typeof val === 'boolean') return val ? 'Yes' : '';
  if (key.endsWith('_at') || key === 'updated_at' || key === 'created_at') {
    const parsed = new Date(val);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  const s = String(val);
  return hoverTrim(s);
}

function hoverAppendDlRow(dl, dtText, ddText) {
  const dt = document.createElement('dt');
  dt.className = 'graph-hover-dt';
  dt.textContent = dtText;
  const dd = document.createElement('dd');
  dd.className = 'graph-hover-dd';
  dd.textContent = ddText;
  dl.appendChild(dt);
  dl.appendChild(dd);
}

/**
 * Builds structured hover markup (glass card + semantic sections + real links).
 * Omits login as title when it matches display name; no raw JSON for social / orgs.
 */
function renderNodeHoverPanel(el, d) {
  while (el.firstChild) el.removeChild(el.firstChild);

  const panel = document.createElement('div');
  panel.className = 'graph-hover-panel';

  const p = d.profile && typeof d.profile === 'object' && !Array.isArray(d.profile) ? d.profile : null;

  const loginCanon = hoverTrim(String(d.login ?? '')).toLowerCase();
  const rawProfileName = hoverTrim(d.name) || hoverTrim(p?.name) || '';
  const displayName =
    rawProfileName && rawProfileName.toLowerCase() !== loginCanon ? rawProfileName : '';

  const bio = hoverTrim(d.bio) || hoverTrim(p?.bio) || '';
  const company = hoverTrim(d.company) || hoverTrim(p?.company) || '';
  const location = hoverTrim(d.location) || hoverTrim(p?.location) || '';
  const metaLine = [company, location].filter(Boolean).join(' · ');

  const blogHref =
    hoverBlogHref(p?.blog) ||
    hoverBlogHref(d.websiteUrl) ||
    null;
  const emailRaw = hoverTrim(p?.email);
  const twitterRaw = hoverTrim(p?.twitter_username);

  const head = document.createElement('div');
  head.className = 'graph-hover-head';

  const titleEl = document.createElement('div');
  titleEl.className = 'graph-hover-title';
  if (displayName) {
    titleEl.textContent = displayName;
  } else if (metaLine) {
    titleEl.textContent = metaLine;
  } else {
    titleEl.classList.add('graph-hover-title-muted');
    titleEl.textContent = 'Profile';
  }
  head.appendChild(titleEl);

  if (displayName && metaLine) {
    const meta = document.createElement('div');
    meta.className = 'graph-hover-meta';
    meta.textContent = metaLine;
    head.appendChild(meta);
  }

  panel.appendChild(head);

  if (bio) {
    const bioEl = document.createElement('p');
    bioEl.className = 'graph-hover-bio';
    bioEl.textContent = bio;
    panel.appendChild(bioEl);
  }

  const hrefDedupe = new Set();
  function hoverAddChip(linksRow, href, label) {
    const h = hoverTrim(href);
    if (!h) return;
    let dedupeKey;
    if (/^mailto:/i.test(h)) {
      dedupeKey = h.replace(/\s/g, '').toLowerCase();
    } else if (/^https?:\/\//i.test(h)) {
      dedupeKey = hoverNormalizeHrefKey(h);
    } else {
      dedupeKey = h.toLowerCase();
    }
    if (hrefDedupe.has(dedupeKey)) return;
    hrefDedupe.add(dedupeKey);

    const a = document.createElement('a');
    a.className = 'graph-hover-chip';
    a.href = h;
    if (!/^mailto:/i.test(h)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    a.textContent = label;
    linksRow.appendChild(a);
  }

  const linksRow = document.createElement('div');
  linksRow.className = 'graph-hover-links';

  if (blogHref) {
    hoverAddChip(linksRow, blogHref, 'Website');
  }
  if (emailRaw) {
    hoverAddChip(linksRow, `mailto:${emailRaw}`, 'Email');
  }
  if (twitterRaw) {
    const handle = twitterRaw.replace(/^@/, '');
    hoverAddChip(linksRow, `https://twitter.com/${encodeURIComponent(handle)}`, 'X / Twitter');
  }

  const socialAccounts = p && Array.isArray(p.social_accounts) ? p.social_accounts : [];
  for (let i = 0; i < socialAccounts.length; i++) {
    const acct = socialAccounts[i];
    const url = acct != null && typeof acct === 'object' ? hoverTrim(acct.url) : '';
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const label = hoverSocialChipLabel(acct.provider);
    hoverAddChip(linksRow, url, label);
  }

  const orgSrc = p && Array.isArray(p.organizations) ? p.organizations : [];
  const orgLogins = [];
  const seenOrg = new Set();
  for (let i = 0; i < orgSrc.length; i++) {
    const login = hoverExtractOrgLogin(orgSrc[i]);
    if (!login || seenOrg.has(login.toLowerCase())) continue;
    seenOrg.add(login.toLowerCase());
    orgLogins.push(login);
  }
  for (let i = 0; i < orgLogins.length; i++) {
    const lg = orgLogins[i];
    hoverAddChip(
      linksRow,
      `https://github.com/${encodeURIComponent(lg)}`,
      `@${lg}`,
    );
  }

  if (linksRow.childNodes.length > 0) {
    panel.appendChild(linksRow);
  }

  const dl = document.createElement('dl');
  dl.className = 'graph-hover-dl';
  let dlHasRows = false;

  function considerProfileKey(k, val) {
    if (HOVER_HIDDEN_PROFILE_KEYS.has(k)) return;
    if (HOVER_KEYS_RENDERED_ABOVE.has(k)) return;
    if (k === 'hireable' && val !== true) return;
    if (typeof val === 'object' && val !== null) {
      return;
    }
    if (!hoverScalarIsPresent(val)) return;
    const formatted = formatHoverScalar(k, val);
    if (!hoverTrim(formatted)) return;
    hoverAppendDlRow(dl, humanizeHoverKey(k), formatted);
    dlHasRows = true;
  }

  if (p) {
    for (const k of PROFILE_HOVER_PRIORITY) {
      if (!Object.prototype.hasOwnProperty.call(p, k)) continue;
      considerProfileKey(k, p[k]);
    }
  }

  if (dlHasRows) panel.appendChild(dl);

  el.appendChild(panel);
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

  // Static outer accent ring for stronger node readability without animation cost.
  nodeGroup
    .append('circle')
    .attr('class', 'node-accent-ring')
    .attr('r', NODE_RADIUS + 2.2)
    .attr('fill', 'none')
    .attr('pointer-events', 'none');
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
const INITIAL_ZOOM_MULTIPLIER_DESKTOP = 1.1;
const INITIAL_ZOOM_MULTIPLIER_MOBILE = 1.0;
const PAN_MARGIN_X = 30000;
const PAN_MARGIN_Y = 1200;

// Cluster mode: when zoomed below the viewport-specific threshold, large groups collapse
// into a single organic "cloud" shape and smaller groups disappear entirely.
// This avoids per-node DOM/physics work when the user can't visually distinguish
// individual nodes anyway.
const ZOOM_CLUSTER_THRESHOLD_DESKTOP = 0.08;
const ZOOM_CLUSTER_THRESHOLD_MOBILE = 0.08;
const CLUSTER_GROUP_MIN_NODES = 8;
const CLUSTER_EXIT_HYSTERESIS = 0.02;
const CLUSTER_EXCLUDED_COLORS = new Set(['#9e9e9e', '#999999', '#808080', 'gray', 'grey']);
// Keep all groups visually present in normal mode so expands feel additive.
// Cluster mode still handles far-zoom performance reduction.
const ENABLE_VIEWPORT_GROUP_CULLING = false;

const MOBILE_BREAKPOINT_PX = 768;
function isMobileViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches;
}

function supportsHoverInfo() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return !isMobileViewport();
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
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

// Decorative background image (rendered inside the zoom group so it pans/zooms
// with the graph). Tune these three numbers to align the artwork with the disk.
const BACKGROUND_IMAGE_URL = '/background.png';
/** Image width in world units. Larger = bigger image. ~4.68× the canvas diameter
 *  by default so the artwork extends comfortably past the visible viewport. */
const BACKGROUND_IMAGE_SIZE = CIRCLE_DIAMETER * 4.5;
/** Center offsets in world units; (0, 0) centers the image on the canvas.
 *  Negative Y nudges the artwork upward (SVG Y axis points down). */
const BACKGROUND_IMAGE_OFFSET_X = 0;
const BACKGROUND_IMAGE_OFFSET_Y = -CIRCLE_DIAMETER * 0.063;

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
  authenticatedSession = false,
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

  /** Full rebuild counter when incremental patching cannot safely update the simulation/DOM graph. */
  const [graphRebuildKey, setGraphRebuildKey] = useState(0);
  /** Latest dataset from React props (streaming expand updates land here each render). */
  const latestGraphDataRef = useRef(data);
  latestGraphDataRef.current = data;
  /** Explicit snapshot consumed by the rebuild effect after a fallback from incremental failure. */
  const graphSnapForRebuildRef = useRef(null);
  /** When falling back to a full rebuild, re-apply this camera so the viewport does not snap. */
  const persistedZoomTransformRef = useRef(null);
  /** Live bridge for monotonic expands (preserve zoom + reuse simulation/DOM joins). */
  const graphLiveApiRef = useRef(null);
  /** Last props topology signature applied by incremental patch / rebuild — avoids pointless work each render. */
  const renderedTopologySigRef = useRef('');

  useEffect(() => {
    const hoverEl = hoverStatusRef.current;
    if (!hoverEl) return;
    const hide = () => {
      hoverEl.style.display = 'none';
    };
    hoverEl.addEventListener('mouseleave', hide);
    return () => hoverEl.removeEventListener('mouseleave', hide);
  }, []);

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
  const setupZoom = (
    svg,
    g,
    containerWidth,
    containerHeight,
    onTransformChange,
    persistedZoomTransform,
  ) => {
    const node = svg.node();

    const mobile = isMobileViewport();
    const ZOOM_MIN = mobile ? ZOOM_MIN_MOBILE : ZOOM_MIN_DESKTOP;
    const ZOOM_MAX = mobile ? ZOOM_MAX_MOBILE : ZOOM_MAX_DESKTOP;

    const zoom = d3.zoom()
      .scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .translateExtent([
        [CIRCLE_CX - CANVAS_BACKDROP_RADIUS - PAN_MARGIN_X, CIRCLE_CY - CANVAS_BACKDROP_RADIUS - PAN_MARGIN_Y],
        [CIRCLE_CX + CANVAS_BACKDROP_RADIUS + PAN_MARGIN_X, CIRCLE_CY + CANVAS_BACKDROP_RADIUS + PAN_MARGIN_Y]
      ])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        onTransformChange?.(event.transform);
      })
      .filter((event) => {
        if (event.type === 'dblclick') return false;
        // Wheel is routed manually to support hybrid pan/zoom semantics.
        if (event.type === 'wheel') return false;
        const tgt = event.target;
        const fromNode = Boolean(tgt && typeof tgt.closest === 'function' && tgt.closest('.node'));
        // Primary button pans the view unless the gesture begins on a node (d3-drag must own it).
        if (event.type === 'mousedown') return event.button === 0 && !fromNode;
        // Single-finger pans from the background only; pinch (2+ touches) still zooms.
        if (event.type === 'touchstart' && event.touches?.length === 1 && fromNode) return false;
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

    const appliedTransform =
      persistedZoomTransform != null
      && typeof persistedZoomTransform.k === 'number'
      && Number.isFinite(persistedZoomTransform.k)
        ? persistedZoomTransform
        : initialTransform;

    svg.call(zoom)
      .call(zoom.transform, appliedTransform)
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

  // Full graph lifecycle: rebuild on auth/session/layoutToken; streaming data updates handled separately.
  useEffect(() => {
    graphLiveApiRef.current = null;

    const dataset = graphSnapForRebuildRef.current ?? latestGraphDataRef.current;
    graphSnapForRebuildRef.current = null;

    const persistedZoomForBuild = persistedZoomTransformRef.current;
    persistedZoomTransformRef.current = null;

    if (!svgRef.current || !dataset?.nodes?.length) return undefined;
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

      const live = { nodes: dataset.nodes, links: dataset.links ?? [] };

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

      // Decorative background image. Lives inside the zoom group `g` so panning
      // and zooming the graph keep the artwork locked to the canvas.
      // Sits behind the canvas-backdrop gradient and the network world.
      g.append('image')
        .attr('class', 'canvas-background-image')
        .attr('href', BACKGROUND_IMAGE_URL)
        .attr('xlink:href', BACKGROUND_IMAGE_URL)
        .attr('x', CIRCLE_CX - BACKGROUND_IMAGE_SIZE / 2 + BACKGROUND_IMAGE_OFFSET_X)
        .attr('y', CIRCLE_CY - BACKGROUND_IMAGE_SIZE / 2 + BACKGROUND_IMAGE_OFFSET_Y)
        .attr('width', BACKGROUND_IMAGE_SIZE)
        .attr('height', BACKGROUND_IMAGE_SIZE)
        .attr('preserveAspectRatio', 'xMidYMid slice')
        .attr('pointer-events', 'none');

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
      let groupMap = buildGroupsFromData(live.nodes, live.links);
      let groupCount = Math.max(...groupMap.values()) + 1;

      const groupSizes = Array.from({ length: groupCount }, () => 0);
      live.nodes.forEach(n => { groupSizes[groupMap.get(n.id)] += 1; });

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
      live.nodes.forEach((n) => {
        nodesByGroupSeed[groupMap.get(n.id)].push(n);
      });

      const totalNodesForLayout = live.nodes.length;
      const sqrtTotalNodes = Math.sqrt(Math.max(1, totalNodesForLayout));

      // Seed nodes with Poisson-like rejection inside each group's disk so they
      // start dispersed instead of piled near the center.
      for (let gi = 0; gi < groupCount; gi++) {
        const c = centres[gi] || { x: CIRCLE_CX, y: CIRCLE_CY };
        const groupNodes = nodesByGroupSeed[gi];
        const seeded = [];
        const gN = groupNodes.length;
        const sqrtG = Math.sqrt(Math.max(1, gN));

        // `groupR` is tuned for clearing between group *centres*; using it as the
        // within-group seed radius caps large (often single-component) graphs to a
        // tiny ball while the movable disk is enormous. Scale with node count and
        // how much annulus is actually reachable from this group's centre.
        const centreDist = Math.hypot(c.x - CIRCLE_CX, c.y - CIRCLE_CY);
        const diskBudget = Math.max(
          NODE_RADIUS + 20,
          movableLimit - centreDist - NODE_RADIUS - 28
        );
        const canvasUtil = Math.min(
          0.94,
          0.14 + 0.84 * (1 - Math.exp(-totalNodesForLayout / 115))
        );
        const sessionUtil = authenticatedSession
          ? Math.min(0.97, canvasUtil + 0.07)
          : canvasUtil;
        const sizeDrivenRadius =
          95 + NODE_RADIUS * sqrtG * (2.05 + 0.72 * sqrtTotalNodes);
        const legacyRadialFloor = Math.max(groupR[gi] - 36, 28);
        const radialLimit = Math.max(
          legacyRadialFloor,
          Math.min(diskBudget * sessionUtil, sizeDrivenRadius)
        );

        const minSepBase = Math.min(
          118,
          Math.max(40, NODE_RADIUS * (1.65 + 0.038 * sqrtTotalNodes))
        );

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

      const linkForce = d3.forceLink(live.links)
        .id(d => d.id)
        .distance(LINK_FORCE_DISTANCE)
        .strength(LINK_FORCE_STRENGTH);

      simulation = d3.forceSimulation(live.nodes)
        .force('link', linkForce)
        .force('collision', d3.forceCollide().radius(84))
        .alphaDecay(0.1) // controls cooldown speed
        .on('end', () => {
          simulation.stop(); // freeze after global layout settles
        });

      live.nodes.forEach((n) => {
        n.__groupIndex = groupMap.get(n.id);
      });
      live.links.forEach((l) => {
        l.__groupIndex = groupMap.get(l.source.id ?? l.source);
      });

      // Mutual / reciprocal edge detection. The data model is purely directed
      // (one row per "A follows B"), so a mutual relationship appears as two
      // separate links. We tag both members with __isMutual so the wedge
      // geometry can offset them perpendicularly into a "two-lane" layout.
      {
        const directed = new Set();
        for (const l of live.links) {
          const sId = l.source.id ?? l.source;
          const tId = l.target.id ?? l.target;
          directed.add(`${sId}\u0001${tId}`);
        }
        for (const l of live.links) {
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
      let fullLinks = activeLinkLayer.selectAll('.link-full')
        .data(live.links)
        .enter()
        .append('path')
        .attr('class', 'link-full')
        .attr('fill', '#e5e7eb')
        .attr('stroke', 'none');

      // Create nodes
      let node = activeNodeLayer
        .selectAll('.node')
        .data(live.nodes)
        .enter()
        .append('g')
        .attr('class', 'node')
        .call(d3.drag()
          .on('start', dragstarted)
          .on('drag', dragged)
          .on('end', dragended));

      const clusterModeEnabled = authenticatedSession;

      // ── Cluster layer (zoom-out cloud blobs) ─────────────────────────────
      // One <g class="cluster"> per qualifying group. They start parked, then
      // get attached into activeClusterLayer in cluster mode.
      const clusterLayer = parkedClusterLayer;

      const computeGroupCentroid = (gi) => {
        let sx = 0;
        let sy = 0;
        let count = 0;
        for (const n of live.nodes) {
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
        for (const n of live.nodes) {
          if (n.__groupIndex === gi) groupNodes.push(n);
        }
        if (!groupNodes.length) return [];
        const center = computeGroupCentroid(gi);
        return buildColorClusterCircles(groupNodes, getNodeColor, center);
      };

      // Build one cluster <g> per qualifying group (hidden by default).
      const clusterGroupRecords = [];
      for (let gi = 0; gi < groupCount; gi++) {
        if (!clusterModeEnabled) continue;
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

      let fullLinksByGroup = Array.from({ length: groupCount }, () => []);
      fullLinks.each(function (d) {
        fullLinksByGroup[d.__groupIndex].push(this);
      });
      let nodesByGroup = Array.from({ length: groupCount }, () => []);
      node.each(function (d) {
        nodesByGroup[d.__groupIndex].push(this);
      });

      let currentHighlight = null;

      /** Apply highlight/dim to every group's DOM (including viewport-culled layers). Skipping parked
       * groups left stale classes on <g.node> / links, which surfaced as “everything selected” once
       * those elements were shown again or after physics drags near cull boundaries. */
      const applyViewportHighlightClasses = () => {
        if (inClusterMode || groupCount === 0) return;

        for (let gi = 0; gi < groupCount; gi++) {
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

        const groupNodes = live.nodes.filter((n) => n.__groupIndex === gi);
        const groupLinks = live.links.filter((l) => {
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

        // Upper-left app logo (`App.css` `.app-logo-slot` + ~half rendered size).
        const logoInset = 24;
        const logoSx = logoInset + 61;
        const logoSy = logoInset + 29;
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
        live.nodes.forEach((n) => {
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
        live.nodes.forEach((n) => {
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
        if (!clusterModeEnabled) return false;
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
        const nextVisibleGroups = new Set();
        if (ENABLE_VIEWPORT_GROUP_CULLING) {
          const margin = NODE_RADIUS + 20;
          const minX = (-t.x) / t.k - margin;
          const maxX = (width - t.x) / t.k + margin;
          const minY = (-t.y) / t.k - margin;
          const maxY = (height - t.y) / t.k + margin;

          const seen = Array.from({ length: groupCount }, () => false);
          let seenCount = 0;
          for (const n of live.nodes) {
            const gi = n.__groupIndex;
            if (seen[gi]) continue;
            if (n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY) {
              seen[gi] = true;
              seenCount += 1;
              if (seenCount === groupCount) break;
            }
          }
          seen.forEach((v, i) => { if (v) nextVisibleGroups.add(i); });
          if (nextVisibleGroups.size === 0 && groupCount > 0) {
            nextVisibleGroups.add(0);
          }
        } else {
          for (let gi = 0; gi < groupCount; gi += 1) nextVisibleGroups.add(gi);
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
        live.nodes.forEach((n) => {
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
        },
        persistedZoomForBuild,
      );
      zoomRef.current = zoom;
      zoomCleanupRef.current = cleanupZoom;

      let suppressNextClick = false;

      const singleClickFocusEnabled = () => !authenticatedSession && interactivePhysicsRef.current;

      node.on('click', (event, d) => {
        if (suppressNextClick) {
          suppressNextClick = false;
          return;
        }
        if (!singleClickFocusEnabled()) return;
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
        if (interactivePhysicsRef.current) return;
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
        if (!el) return;
        const pad = 8;
        const gap = 14;
        const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 0;

        el.style.display = 'block';
        const ew = el.offsetWidth;
        const eh = el.offsetHeight;

        let left = event.clientX + gap;
        let top = event.clientY + gap;

        if (left + ew > vw - pad) {
          left = event.clientX - gap - ew;
        }
        if (top + eh > vh - pad) {
          top = event.clientY - gap - eh;
        }

        left = Math.max(pad, Math.min(left, vw - Math.max(ew, 40) - pad));
        top = Math.max(pad, Math.min(top, vh - Math.max(eh, 24) - pad));

        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
      };

      const hoverInfoEnabled = supportsHoverInfo();
      if (hoverInfoEnabled) {
        node
          .on('mouseover', (event, d) => {
            const el = hoverStatusRef.current;
            if (!el) return;
            renderNodeHoverPanel(el, d);
            el.style.display = 'block';
            placeHoverNearPointer(event);
          })
          .on('mousemove', (event) => {
            const el = hoverStatusRef.current;
            if (!el || el.style.display === 'none') return;
            placeHoverNearPointer(event);
          })
          .on('mouseout', (event) => {
            const el = hoverStatusRef.current;
            if (!el) return;
            const next = event.relatedTarget;
            if (next instanceof Node && el.contains(next)) return;
            el.style.display = 'none';
          });
      } else {
        node.on('mouseover', null).on('mousemove', null).on('mouseout', null);
        const el = hoverStatusRef.current;
        if (el) el.style.display = 'none';
      }

      // ── Long-press a node to crawl from it (hold-to-crawl) ───────────────
      // Disabled while interactivePhysics is on (avoid expand while arranging).
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
        if (interactivePhysicsRef.current) return;

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
          if (interactivePhysicsRef.current) {
            resetLongPressRing();
            longPressActiveNode = null;
            return;
          }
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

        clampNodesToDisk(live.nodes);

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
        svg.classed('network-graph--node-dragging', false);
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
        svg.classed('network-graph--node-dragging', true);
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

      const svgNodeEl = svg.node();
      renderedTopologySigRef.current = topologySignature(live.nodes, live.links ?? []);

      graphLiveApiRef.current = {
        session: authenticatedSession,
        getPersistableZoom: () => d3.zoomTransform(svgNodeEl),
        tryIncrementalUpdate: (nextDataset) => {
          const nextLinksList = nextDataset.links ?? [];

          const incomingSig = topologySignature(nextDataset.nodes, nextLinksList);
          if (incomingSig === renderedTopologySigRef.current) return true;

          const prevTopo = summarizeTopology(live.nodes, live.links);
          const nextTopo = summarizeTopology(nextDataset.nodes, nextLinksList);
          if (!canIncrementalExpand(prevTopo, nextTopo)) return false;

          const prevMaxPop = maxGroupPopulation(live.nodes, live.links);
          const nextMaxPop = maxGroupPopulation(nextDataset.nodes, nextLinksList);
          if (
            clusterModeEnabled
            && prevMaxPop < CLUSTER_GROUP_MIN_NODES
            && nextMaxPop >= CLUSTER_GROUP_MIN_NODES
          ) {
            return false;
          }

          const oldById = new Map(live.nodes.map((n) => [n.id, n]));
          const mergedById = new Map();
          const merged = [];

          for (const inc of nextDataset.nodes) {
            const existing = oldById.get(inc.id);
            if (existing) {
              mergeNodeAttributesPreservingSimulation(existing, inc);
              merged.push(existing);
              mergedById.set(existing.id, existing);
            } else {
              const neu = { ...inc };
              merged.push(neu);
              mergedById.set(neu.id, neu);
            }
          }

          function pickXYForNewNode(nodeId) {
            const anchors = [];
            for (let li = 0; li < nextLinksList.length; li += 1) {
              const l = nextLinksList[li];
              const sId = typeof l.source === 'object' && l.source !== null ? l.source.id : l.source;
              const tId = typeof l.target === 'object' && l.target !== null ? l.target.id : l.target;
              let other = null;
              if (sId === nodeId) other = tId;
              else if (tId === nodeId) other = sId;
              else continue;
              const p = mergedById.get(other);
              if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) anchors.push(p);
            }
            if (!anchors.length) {
              const j = movableLimit > 90 ? movableLimit * 0.06 : 42;
              return clampToMovableDisk(
                CIRCLE_CX + (Math.random() - 0.5) * j,
                CIRCLE_CY + (Math.random() - 0.5) * j,
              );
            }
            let sx = 0;
            let sy = 0;
            for (let i = 0; i < anchors.length; i += 1) {
              sx += anchors[i].x;
              sy += anchors[i].y;
            }
            const cx = sx / anchors.length;
            const cy = sy / anchors.length;
            const j = movableLimit > 140 ? movableLimit * 0.035 : 32;
            return clampToMovableDisk(
              cx + (Math.random() - 0.5) * j,
              cy + (Math.random() - 0.5) * j,
            );
          }

          let needsXY = false;
          for (let i = 0; i < merged.length; i += 1) {
            const nn = merged[i];
            if (!Number.isFinite(nn.x) || !Number.isFinite(nn.y)) {
              needsXY = true;
              break;
            }
          }
          if (needsXY) {
            merged.forEach((nn, idx) => {
              if (Number.isFinite(nn.x) && Number.isFinite(nn.y)) return;
              const p =
                idx === 0 && merged.length === 1
                  ? clampToMovableDisk(CIRCLE_CX, CIRCLE_CY)
                  : pickXYForNewNode(nn.id);
              nn.x = p.x;
              nn.y = p.y;
              if (!Number.isFinite(nn.vx)) nn.vx = 0;
              if (!Number.isFinite(nn.vy)) nn.vy = 0;
            });
          }

          const resolved = [];
          for (let li = 0; li < nextLinksList.length; li += 1) {
            const rl = nextLinksList[li];
            const sid = rl.source?.id ?? rl.source;
            const tid = rl.target?.id ?? rl.target;
            const sn = mergedById.get(sid);
            const tn = mergedById.get(tid);
            if (!sn || !tn) continue;
            resolved.push({ source: sn, target: tn });
          }

          const directed = new Set();
          resolved.forEach((l) => directed.add(`${l.source.id}\u0001${l.target.id}`));
          resolved.forEach((l) => {
            l.__isMutual = directed.has(`${l.target.id}\u0001${l.source.id}`);
          });

          groupMap = buildGroupsFromData(merged, resolved);
          const nextGroupCount = Math.max(...groupMap.values()) + 1;
          if (nextGroupCount !== groupCount || groupSizes.length !== nextGroupCount) return false;

          groupSizes.fill(0);
          merged.forEach((nn) => {
            const gi = groupMap.get(nn.id);
            nn.__groupIndex = gi;
            groupSizes[gi] += 1;
          });
          resolved.forEach((l) => {
            l.__groupIndex = groupMap.get(l.source.id);
          });

          live.nodes = merged;
          live.links = resolved;

          const linkDatumKey = (d) => `${d.source.id}->${d.target.id}`;

          const linkSel = activeLinkLayer.selectAll('.link-full').data(resolved, linkDatumKey);
          linkSel.exit().remove();
          const linkEnter = linkSel
            .enter()
            .append('path')
            .attr('class', 'link-full')
            .attr('fill', '#e5e7eb')
            .attr('stroke', 'none');
          fullLinks = linkEnter.merge(linkSel);

          const nd = activeNodeLayer.selectAll('.node').data(merged, (d) => d.id);
          nd.exit().remove();

          const ndEnter = nd
            .enter()
            .append('g')
            .attr('class', 'node')
            .call(
              d3
                .drag()
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended),
            );

          ndEnter.each(function paintNew(datum) {
            const nodeGroup = d3.select(this);
            const nodePathInfo = createNodePath(datum);
            renderNodeVisual(nodeGroup, datum, nodePathInfo, {
              colorMaps,
              colorBy,
              getNodeColor,
              simplified: false,
            });
            nodeGroup
              .append('circle')
              .attr('class', 'long-press-ring')
              .attr('r', NODE_RADIUS + 6)
              .attr('fill', 'none')
              .attr('pointer-events', 'none')
              .style('display', 'none');
          });

          ndEnter
            .on('click', (event, d) => {
              if (suppressNextClick) {
                suppressNextClick = false;
                return;
              }
              if (!singleClickFocusEnabled()) return;
              if (nodeClickTimer) clearTimeout(nodeClickTimer);
              nodeClickTimer = setTimeout(() => {
                nodeClickTimer = null;
                const grp = groupMap.get(d.id);
                currentHighlight = currentHighlight === grp ? null : grp;
                applyViewportHighlightClasses();
                if (interactivePhysicsRef.current && currentHighlight == null) {
                  stopGroupMiniSimFully();
                }
              }, 280);
            })
            .on('dblclick', (event, d) => {
              event.preventDefault();
              event.stopPropagation();
              if (interactivePhysicsRef.current) return;
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
            })
            .on('pointerdown', function onIncrementalPtr(event, dn) {
              if (event.pointerType === 'mouse' && event.button !== 0) return;
              cancelLongPress();
              longPressFired = false;
              if (interactivePhysicsRef.current) return;

              longPressStartX = event.clientX;
              longPressStartY = event.clientY;
              longPressActiveNode = dn;

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
                void ringNode.getBoundingClientRect();
                ringSel
                  .style('transition', `stroke-dashoffset ${LONG_PRESS_MS}ms linear`)
                  .attr('stroke-dashoffset', 0);
              }

              longPressTimer = setTimeout(() => {
                longPressTimer = null;
                if (interactivePhysicsRef.current) {
                  resetLongPressRing();
                  longPressActiveNode = null;
                  return;
                }
                longPressFired = true;
                resetLongPressRing();
                const captured = longPressActiveNode;
                longPressActiveNode = null;
                if (captured) {
                  captured.fx = null;
                  captured.fy = null;
                }
                suppressNextClick = true;
                const login = captured?.login;
                if (
                  typeof login === 'string'
                  && login.length > 0
                  && typeof onNodeCrawlRef.current === 'function'
                ) {
                  try {
                    onNodeCrawlRef.current(login);
                  } catch (err) {
                    console.error('onNodeCrawl failed:', err);
                  }
                }
              }, LONG_PRESS_MS);
            });

          if (hoverInfoEnabled) {
            ndEnter
              .on('mouseover', (event, d) => {
                const el = hoverStatusRef.current;
                if (!el) return;
                renderNodeHoverPanel(el, d);
                el.style.display = 'block';
                placeHoverNearPointer(event);
              })
              .on('mousemove', (event) => {
                const el = hoverStatusRef.current;
                if (!el || el.style.display === 'none') return;
                placeHoverNearPointer(event);
              })
              .on('mouseout', (event) => {
                const el = hoverStatusRef.current;
                if (!el) return;
                const next = event.relatedTarget;
                if (next instanceof Node && el.contains(next)) return;
                el.style.display = 'none';
              });
          }

          node = ndEnter.merge(nd);

          for (let gi = 0; gi < groupCount; gi += 1) {
            fullLinksByGroup[gi].length = 0;
            nodesByGroup[gi].length = 0;
          }

          fullLinks.each(function refillLinkBuckets(datum) {
            fullLinksByGroup[datum.__groupIndex].push(this);
          });
          node.each(function refillNodeBuckets(datum) {
            nodesByGroup[datum.__groupIndex].push(this);
          });

          linkForce.links(resolved);
          simulation.nodes(merged);
          simulation.alpha(0.32).restart();

          visibleGroups = new Set();
          renderedTopologySigRef.current = topologySignature(live.nodes, live.links ?? []);
          return true;
        },
      };

    } catch (error) {
      console.error("Error rendering network visualization:", error);
    }

    return () => {
      svgRef.current?.classList.remove('network-graph--node-dragging');
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
    // Rebuild from scratch when auth changes, layout token bumps, or session-specific defaults shift.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- graphLiveApiRef carries streaming updates
  }, [authenticatedSession, graphRebuildKey]);

  // Monotonic dataset growth (streaming expand): update simulation/DOM without resetting zoom.
  useEffect(() => {
    const api = graphLiveApiRef.current;
    if (!api || api.session !== authenticatedSession) return undefined;

    const nextLinksRaw = latestGraphDataRef.current.links ?? [];
    const nextSig = topologySignature(latestGraphDataRef.current.nodes, nextLinksRaw);
    if (nextSig === renderedTopologySigRef.current) return undefined;

    const ok = api.tryIncrementalUpdate(latestGraphDataRef.current);

    if (!ok) {
      const svgEl = svgRef.current;
      if (svgEl) {
        const z = api.getPersistableZoom();
        persistedZoomTransformRef.current = z;
      }
      graphSnapForRebuildRef.current = latestGraphDataRef.current;
      setGraphRebuildKey((k) => k + 1);
    }

    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- streaming `data` should not rerun full lifecycle
  }, [data, authenticatedSession]);


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
  const showControlsAndLegend = authenticatedSession;

  return (
    <div className={`network-container${desktopSafariClass}`}>
      <div ref={visualizationAreaRef} className="visualization-area">
        <svg ref={svgRef} className="network-graph"
          aria-label="Network graph visualization - draggable view"></svg>

        <div
          ref={hoverStatusRef}
          className={`graph-hover-status${darkSurface ? ' graph-hover-status--dark' : ' graph-hover-status--light'}`}
          role="status"
          aria-live="polite"
          style={{ display: 'none' }}
        />

        {showControlsAndLegend ? (
          <div ref={controlsRef} className="controls-legend-container">
            <ControlPanel
              colorBy={colorBy}
              setColorBy={setColorBy}
              nodes={data.nodes}
              darkSurface={darkSurface}
              hideDegreeOption={false}
            />
            <Legend colorBy={colorBy} colorMaps={colorMaps} darkSurface={darkSurface} />
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default NetworkGraph;