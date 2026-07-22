'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Field } from '@/components/ui'
import { adminLogin } from './actions'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5">
      <Card>
        <h1 className="mb-1 text-lg font-semibold text-ink-900">员工登录</h1>
        <p className="mb-5 text-xs text-ink-500">运营与交付顾问共用这个入口,登录后自动进各自的工作台。</p>
        <div className="space-y-4">
          <Field label="邮箱">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </Field>
          <Field label="密码">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </Field>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <Button
            className="w-full"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await adminLogin(email, password)
                // 落点由服务端按角色决定 —— 顾问进 /advisor,运营进后台
                if (!res.ok) setError(res.error)
                else router.push(res.redirectTo === '/advisor' ? '/advisor' : '/admin/programs')
              })
            }
          >
            {pending ? '登录中…' : '登录'}
          </Button>
        </div>
      </Card>
    </main>
  )
}
