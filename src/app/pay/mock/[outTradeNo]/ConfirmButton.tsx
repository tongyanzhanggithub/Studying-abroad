'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'

export function ConfirmButton({
  outTradeNo,
  action,
}: {
  outTradeNo: string
  action: (n: string) => Promise<{ ok: boolean; redirectTo?: string; error?: string }>
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div>
      <Button
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await action(outTradeNo)
            if (!res.ok) {
              setError(res.error ?? '支付失败')
              return
            }
            router.push(res.redirectTo ?? '/app/dashboard')
          })
        }
      >
        {pending ? '处理中…' : '模拟支付成功'}
      </Button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  )
}
