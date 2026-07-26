'use client'

import { useEffect } from 'react'

/**
 * 顾问端错误边界。
 *
 * 同 admin/error.tsx:没有它的话,顾问会被根 error boundary 的「回总览」
 * 送到学生工作台,再被弹到学生登录页。
 */
export default function AdvisorError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[compass:advisor] 顾问端页面出错', error.digest ?? '', error)
  }, [error])

  return (
    <div className="mx-auto max-w-lg py-16">
      <div className="rounded-xl border border-ink-200 bg-white p-6">
        <h1 className="text-lg font-semibold text-ink-900">这一页没能打开</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          是系统这边的问题。先重试一次;还是不行就把下面的编号发给运营。
          你的订单和交付记录都没有受影响。
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
          <a
            href="/advisor"
            className="inline-flex min-h-11 items-center rounded-lg border border-ink-200 px-5 text-sm text-ink-700 hover:bg-ink-50"
          >
            回我的订单
          </a>
        </div>
      </div>
    </div>
  )
}
