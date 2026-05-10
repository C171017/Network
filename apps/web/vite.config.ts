import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const skiaWebDir = path.join(__dirname, 'src/skia-web')
const skiaPkgDir = path.dirname(require.resolve('@shopify/react-native-skia/package.json'))
const skiaLib = path.join(skiaPkgDir, 'lib/module')
const reactReconcilerCjs = path.join(
  path.dirname(require.resolve('react-reconciler/package.json')),
  'cjs'
)
const skiaSpecs = path.join(skiaLib, 'specs')
const skiaPlatform = path.join(skiaLib, 'Platform')
const skiaPictureViewWeb = path.join(skiaSpecs, 'SkiaPictureViewNativeComponent.web.js')
const nativeSkiaModuleWeb = path.join(skiaSpecs, 'NativeSkiaModule.web.js')
const platformWeb = path.join(skiaPlatform, 'Platform.web.js')
const shimReconcilerConstants = path.join(skiaWebDir, 'shim-react-reconciler-constants.js')
const skiaWebLazy = path.join(skiaWebDir, 'skia-web-lazy.js')
const skiaTypesNativeBufferStub = path.join(skiaWebDir, 'skia-types-native-buffer-stub.js')
const reanimatedMockPkg = path.join(skiaWebDir, 'reanimated-mock-pkg')
const reanimatedWebMock = path.join(skiaWebDir, 'react-native-reanimated-web-mock.js')
const VIRTUAL_REANIMATED_MOCK = 'virtual:reanimated-web-mock'

function skiaWebPlugin() {
  return {
    name: 'skia-web',
    enforce: 'pre' as const,
    resolveId(id: string, importer?: string) {
      const n = id.replace(/\\/g, '/')
      if (id === VIRTUAL_REANIMATED_MOCK) {
        return reanimatedWebMock
      }
      const imp = importer ? importer.replace(/\\/g, '/') : ''
      if (n === 'react-reconciler/constants' || n === 'react-reconciler/constants.js') {
        return shimReconcilerConstants
      }
      if (
        (n === '../types' || n === '../types.js') &&
        imp.includes('@shopify/react-native-skia') &&
        (imp.includes('CanvasKitWebGLBufferImpl') || imp.includes('JsiSkImageFactory'))
      ) {
        return skiaTypesNativeBufferStub
      }
      const isSkiaRequest =
        n === './Skia' || n === './Skia.js' || n === '../Skia' || n === '../Skia.js' || n === 'Skia'
      if (isSkiaRequest) {
        return skiaWebLazy
      }
      if (n.includes('SkiaPictureViewNativeComponent') && !n.includes('.web')) {
        return skiaPictureViewWeb
      }
      if (n.includes('NativeSkiaModule') && !n.includes('.web')) {
        return nativeSkiaModuleWeb
      }
      if (n.includes('Platform/Platform') && !n.includes('.web')) {
        return platformWeb
      }
      return null
    },
    transform(code: string, id: string) {
      if (!id.includes('ReanimatedProxy') || !id.includes('react-native-skia')) return null
      const needRequire = /return\s+require\s*\(\s*["']react-native-reanimated["']\s*\)/.test(code)
      if (!needRequire) return null
      const importLine = `import __reanimated_web_mock__ from "${VIRTUAL_REANIMATED_MOCK}";\n`
      const newCode = code.replace(
        /return\s+require\s*\(\s*["']react-native-reanimated["']\s*\)\s*;?/g,
        'return __reanimated_web_mock__;'
      )
      return importLine + newCode
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [skiaWebPlugin(), react()],
  server: {
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['@shopify/react-native-skia'],
    include: [
      'canvaskit-wasm/bin/full/canvaskit',
      'react-reconciler/cjs/react-reconciler.development.js',
      'react-reconciler/cjs/react-reconciler.production.min.js',
      'react-reconciler/cjs/react-reconciler-constants.development.js',
      'react-reconciler/cjs/react-reconciler-constants.production.min.js',
    ],
  },
  resolve: {
    alias: [
      {
        find: 'react-reconciler/cjs/react-reconciler.development.js',
        replacement: path.join(reactReconcilerCjs, 'react-reconciler.development.js'),
      },
      {
        find: 'react-reconciler/cjs/react-reconciler.production.min.js',
        replacement: path.join(reactReconcilerCjs, 'react-reconciler.production.min.js'),
      },
      {
        find: 'react-reconciler/cjs/react-reconciler-constants.development.js',
        replacement: path.join(reactReconcilerCjs, 'react-reconciler-constants.development.js'),
      },
      {
        find: 'react-reconciler/cjs/react-reconciler-constants.production.min.js',
        replacement: path.join(reactReconcilerCjs, 'react-reconciler-constants.production.min.js'),
      },
      { find: 'react-native', replacement: 'react-native-web' },
      { find: 'react-native-reanimated', replacement: reanimatedMockPkg },
      { find: /^react-reconciler$/, replacement: path.join(skiaWebDir, 'shim-react-reconciler.js') },
      {
        find: 'react-reconciler/constants',
        replacement: path.join(skiaWebDir, 'shim-react-reconciler-constants.js'),
      },
      { find: path.join(skiaLib, 'skia', 'Skia.js'), replacement: skiaWebLazy },
      { find: /SkiaPictureViewNativeComponent\.js$/, replacement: skiaPictureViewWeb },
      { find: /NativeSkiaModule\.js$/, replacement: nativeSkiaModuleWeb },
      { find: /Platform\/Platform\.js$/, replacement: platformWeb },
    ],
  },
})
