/**
 * Lazy Skia wrapper: initialize JsiSkApi(global.CanvasKit) only on first use.
 */
import { JsiSkApi } from '@shopify/react-native-skia/lib/module/skia/web'

let instance = null

function getSkia() {
  if (instance == null) {
    if (typeof global !== 'undefined' && global.CanvasKit != null) {
      instance = JsiSkApi(global.CanvasKit)
    } else {
      throw new Error('CanvasKit not loaded. Ensure WithSkiaWeb has loaded before using Skia.')
    }
  }
  return instance
}

export const Skia = new Proxy(
  {},
  {
    get(_, prop) {
      return getSkia()[prop]
    },
  }
)
