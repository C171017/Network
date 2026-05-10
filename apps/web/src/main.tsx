import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WithSkiaWeb } from '@shopify/react-native-skia/lib/module/web'
import SkiaFallback from './SkiaFallback'

const g = globalThis as unknown as { global?: typeof globalThis }
if (g.global === undefined) {
  g.global = globalThis
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WithSkiaWeb
      getComponent={() => import('./App.tsx')}
      opts={{
        locateFile: (file: string) => `/${file}`,
      }}
      fallback={<SkiaFallback />}
    />
  </StrictMode>
)
