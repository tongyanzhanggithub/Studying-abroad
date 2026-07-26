'use client'

import { useEffect } from 'react'

/**
 * 后台错误边界。
 *
 * ⚠️ 没有这个文件时,后台任一页出错会冒泡到根 error.tsx,而那一页的按钮是
 *    「回总览」→ /app/dashboard → 学生工作台布局发现没有**学生**会话 →
 *    弹到 /login → 运营看到的是学生登录页。他会以为自己被登出了。
 *
 * 后台用户就是能截图给你的人,所以这里直接把 digest 显示出来。
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[compass:admin] 后台页面出错', error.digest ?? '', error)
  }, [error])

  return (
    <div className="mx-auto max-w-lg py-16">
      <div className="rounded-xl border border-ink-200 bg-white p-6">
        <h1 className="text-lg font-semibold text-ink-900">这一页没能打开</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          是我们这边出了问题,不是你操作错了。可以先重试一次;还是打不开的话,
          把下面的编号发给技术同事,能直接定位到这次错误。
        </p>

        {error.digest && (
          <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
            错误编号 <code className="font-mono">{error.digest}</code>
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={reset}
            className="min-h-11 rounded-lg bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700"
          >
            重试
          </button>
          {/* 出口指向后台,不是学生端 */}
          <a
            href="/admin/programs"
            className="inline-flex min-h-11 items-center rounded-lg border border-ink-200 px-5 text-sm text-ink-700 hover:bg-ink-50"
          >
            回院校库
          </a>
        </div>
      </div>
    </div>
  )
}
