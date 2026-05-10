/**
 * ESM shim for react-reconciler/constants so that
 * import { DefaultEventPriority } from "react-reconciler/constants" works in Vite.
 */
import * as devNs from 'react-reconciler/cjs/react-reconciler-constants.development.js'
import * as prodNs from 'react-reconciler/cjs/react-reconciler-constants.production.min.js'
const cjs = import.meta.env.DEV ? devNs : prodNs

export const DefaultEventPriority = cjs.DefaultEventPriority
export const ConcurrentRoot = cjs.ConcurrentRoot
export const ContinuousEventPriority = cjs.ContinuousEventPriority
export const DiscreteEventPriority = cjs.DiscreteEventPriority
export const IdleEventPriority = cjs.IdleEventPriority
export const LegacyRoot = cjs.LegacyRoot
