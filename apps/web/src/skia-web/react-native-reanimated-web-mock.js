/**
 * Web mock for react-native-reanimated so Skia's ReanimatedProxy doesn't throw.
 */

export default {
  createWorkletRuntime() {
    return {}
  },
  runOnJS(fn) {
    return (...args) => fn(...args)
  },
  runOnRuntime(_runtime, fn) {
    return (arg) => fn(arg)
  },
  useSharedValue(init) {
    return { value: init }
  },
  useAnimatedReaction() {},
  useFrameCallback() {},
  runOnUI(fn) {
    return fn()
  },
  startMapper() {
    return 0
  },
  stopMapper() {},
  isSharedValue(x) {
    return x != null && typeof x === 'object' && 'value' in x
  },
  makeMutable(init) {
    return { value: init }
  },
  useDerivedValue(fn) {
    return { value: typeof fn === 'function' ? fn() : undefined }
  },
}
