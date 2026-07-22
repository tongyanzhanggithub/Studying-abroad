'use client'

/**
 * 根 layout 自身崩掉时的最后一道兜底。
 *
 * ⚠️ 这一层跑在根 layout 之外,所以拿不到全局 CSS、字体、任何组件 ——
 *    必须自带 html/body 标签和内联样式。样式简陋是刻意的,
 *    因为能走到这里说明连样式表都可能加载不出来。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily:
            'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
          background: '#fafafa',
          color: '#1a1a1a',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 20, margin: '0 0 12px' }}>页面加载失败</h1>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#555', margin: '0 0 20px' }}>
            是我们这边出了问题,不是你操作错了。你的数据没有丢。
          </p>
          <button
            onClick={reset}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              borderRadius: 8,
              border: 'none',
              background: '#e1306c',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            重试
          </button>
          {error.digest && (
            <p style={{ fontSize: 12, color: '#999', marginTop: 16 }}>
              编号 {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  )
}
