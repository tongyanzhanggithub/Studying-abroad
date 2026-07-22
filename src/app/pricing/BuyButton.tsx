'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { checkoutPlan, checkoutService } from './actions'

export function BuyButton({
  kind,
  id,
  label,
  loggedIn,
  fromRuleId,
  variant = 'primary',
  size = 'md',
}: {
  kind: 'plan' | 'service'
  id: string
  label: string
  loggedIn: boolean
  fromRuleId?: string
  variant?: 'primary' | 'secondary'
  size?: 'sm' | 'md' | 'lg'
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleClick() {
    if (!loggedIn) {
      router.push(`/login?next=${encodeURIComponent('/pricing')}`)
      return
    }
    setError(null)
    startTransition(async () => {
      const res =
        kind === 'plan' ? await checkoutPlan(id) : await checkoutService(id, fromRuleId)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.push(res.payUrl)
    })
  }

  return (
    <div>
      <Button onClick={handleClick} disabled={pending} variant={variant} size={size} className="w-full">
        {pending ? '处理中…' : label}
      </Button>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  )
}
