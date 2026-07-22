'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button, Card } from '@/components/ui'

/**
 * 工作台内的错误兜底。
 *
 * 放在 /app 这一层是为了**保住导航栏** —— 出错的只是某一页,
 * 用户应该还能直接切去别的页面,而不是被丢到一个没有出口的错误页。
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[compass/app] 页面出错', error.digest ?? '', error)
  }, [error])

  return (
    <Card className="mx-auto max-w-lg">
      <h1 className="text-lg font-semibold text-ink-900">这一页没能打开</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-600">
        是我们这边出了问题,不是你操作错了。你填过的内容都还在 ——
        重试一次通常就好了,上面的导航也还能用。
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={reset}>重试</Button>
        <Link href="/app/dashboard">
          <Button variant="secondary">回总览</Button>
        </Link>
      </div>
      {error.digest && (
        <p className="mt-4 text-xs text-ink-400">
          反复出现的话,把这个编号发给客服:
          <code className="ml-1 font-mono">{error.digest}</code>
        </p>
      )}
    </Card>
  )
}
