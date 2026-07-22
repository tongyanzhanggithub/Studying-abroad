'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button, Card } from '@/components/ui'
import { BrandLogo } from '@/components/BrandLogo'

/**
 * 全站错误兜底。
 *
 * ⚠️ 没有这个文件时,生产环境任何服务端异常都会显示 Next 的默认页:
 *    「Application error: a server-side exception has occurred. Digest: 1234567」
 *    —— 一个付了钱的用户看到这句话,既不知道发生了什么,也不知道该干什么。
 *
 * 这里不解释技术细节(用户不需要,也帮不上忙),只做三件事:
 * 说清楚「不是你操作错了」、给一个重试按钮、给一条回去的路。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // 生产环境里 digest 是定位这次错误的唯一线索,打到控制台便于用户截图给客服
    console.error('[compass] 页面出错', error.digest ?? '', error)
  }, [error])

  /**
   * 会话过期是最常见的一种「错误」,但它根本不是错误 ——
   * 是登录状态没了。混在通用报错里会让人一直点重试。
   */
  const isAuth = /UNAUTHORIZED|SUBSCRIPTION_REQUIRED/.test(error.message)

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <BrandLogo className="mb-6 text-lg" />
      <Card>
        {isAuth ? (
          <>
            <h1 className="text-xl font-semibold text-ink-900">登录状态过期了</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">
              为了保护你的资料,长时间没操作会自动退出。重新登录就能接着用,
              已填的内容都还在。
            </p>
            <Link href="/login" className="mt-5 block">
              <Button className="w-full" size="lg">
                重新登录
              </Button>
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-ink-900">这一页没能打开</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">
              是我们这边出了问题,不是你操作错了。你的数据没有丢 ——
              重试一次通常就好了。
            </p>
            <div className="mt-5 flex gap-2">
              <Button onClick={reset} className="flex-1" size="lg">
                重试
              </Button>
              <Link href="/app/dashboard" className="flex-1">
                <Button variant="secondary" className="w-full" size="lg">
                  回总览
                </Button>
              </Link>
            </div>
            {error.digest && (
              <p className="mt-4 text-xs text-ink-400">
                反复出现的话,把这个编号发给客服:
                <code className="ml-1 font-mono">{error.digest}</code>
              </p>
            )}
          </>
        )}
      </Card>
    </main>
  )
}
