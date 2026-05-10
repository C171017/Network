export default function SkiaFallback() {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a0b',
        color: '#fafbfc',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      Loading graph engine…
    </div>
  )
}
