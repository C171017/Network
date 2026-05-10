/**
 * ESM shim so Skia’s Reconciler.js “import ReactReconciler from 'react-reconciler'” works.
 * CJS uses module.exports; namespace import + default interop works in dev and production builds.
 */
import * as devNs from 'react-reconciler/cjs/react-reconciler.development.js'
import * as prodNs from 'react-reconciler/cjs/react-reconciler.production.min.js'
const pickDefault = (ns) => (ns.default !== undefined ? ns.default : ns)
export default import.meta.env.DEV ? pickDefault(devNs) : pickDefault(prodNs)
