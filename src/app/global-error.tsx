'use client'

export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '0 1.5rem',
          textAlign: 'center',
          background: '#08090c',
          color: '#f4f5f7',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ marginTop: '0.25rem', fontSize: '0.875rem', color: '#9aa1ac' }}>
            A critical error occurred. You can try again.
          </p>
        </div>
        <button
          type="button"
          onClick={() => unstable_retry()}
          style={{
            marginTop: '0.5rem',
            height: '2.25rem',
            padding: '0 1rem',
            borderRadius: '0.5rem',
            border: 'none',
            background: '#10b981',
            color: '#000',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}
