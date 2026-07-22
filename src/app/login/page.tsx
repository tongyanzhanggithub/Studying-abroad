'use client'

import { Suspense, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button, Card, Field } from '@/components/ui'
import { BrandLogo } from '@/components/BrandLogo'
import { requestCode, loginWithCode } from './actions'

/**
 * ⚠️ useSearchParams() 必须包在 Suspense 里,否则 `next build` 会直接失败:
 *    "useSearchParams() should be wrapped in a suspense boundary"。
 *    这个错**只有生产构建会报**,`next dev` 一切正常 ——
 *    所以改完页面要跑 `npm run check`,光 typecheck 看不出来。
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') ?? '/app/dashboard'

  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const phoneRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  // 进页面直接聚焦手机号,少一次点击
  useEffect(() => {
    phoneRef.current?.focus()
  }, [])

  // 验证码发出后自动聚焦验证码框 —— 用户不用再手动去点那个框
  useEffect(() => {
    if (codeSent) codeRef.current?.focus()
  }, [codeSent])

  function handleSendCode() {
    setError(null)
    startTransition(async () => {
      const res = await requestCode(phone)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setCodeSent(true)
      setDevCode(res.devCode ?? null)
    })
  }

  function handleLogin() {
    setError(null)
    startTransition(async () => {
      const res = await loginWithCode({ phone, code, agreedTerms: agreed })
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.push(res.isNewUser ? '/app/onboarding' : next)
    })
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <BrandLogo className="mb-6 text-lg" />

      <Card>
        <h1 className="mb-1 text-xl font-semibold text-ink-900">登录 / 注册</h1>
        <p className="mb-5 text-sm text-ink-600">未注册的手机号将自动创建账号</p>

        {/* 两步指示 —— 让用户知道「填手机号 → 填验证码」是两步,不是缺了直接登录 */}
        <ol className="mb-5 flex items-center gap-2 text-xs">
          <li className={codeSent ? 'text-ink-400' : 'font-medium text-brand-600'}>
            <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-[10px] text-white">
              1
            </span>
            填手机号
          </li>
          <li className="text-ink-300">→</li>
          <li className={codeSent ? 'font-medium text-brand-600' : 'text-ink-400'}>
            <span
              className={`mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-white ${
                codeSent ? 'bg-brand-600' : 'bg-ink-300'
              }`}
            >
              2
            </span>
            填验证码登录
          </li>
        </ol>

        <div className="space-y-4">
          <Field label="手机号">
            <input
              ref={phoneRef}
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && phone.length === 11 && !codeSent) handleSendCode()
              }}
              placeholder="11 位手机号"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </Field>

          {codeSent && (
            <Field label="验证码">
              <input
                ref={codeRef}
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && code.length === 6) handleLogin()
                }}
                placeholder="6 位验证码"
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
              {devCode && (
                <button
                  type="button"
                  onClick={() => setCode(devCode)}
                  className="mt-2 w-full rounded-lg border border-dashed border-brand-300 bg-brand-50/50 px-3 py-2 text-left text-xs text-ink-600 hover:bg-brand-50"
                >
                  开发环境验证码 <span className="font-mono font-semibold text-brand-700">{devCode}</span>
                  <span className="text-ink-400">(短信未配置,点此一键填入)</span>
                </button>
              )}
            </Field>
          )}

          <label className="flex items-start gap-2 text-xs leading-relaxed text-ink-600">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              我已阅读并同意
              <Link href="/legal/terms" target="_blank" className="text-brand-600 hover:underline">
                《用户协议》
              </Link>
              和
              <Link href="/legal/privacy" target="_blank" className="text-brand-600 hover:underline">
                《隐私政策》
              </Link>
              。我们收集手机号仅用于账号登录与申请提醒,不会向第三方出售。
            </span>
          </label>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          {!codeSent ? (
            <Button
              onClick={handleSendCode}
              disabled={pending || phone.length !== 11}
              className="w-full"
              size="lg"
            >
              {pending ? '发送中…' : '获取验证码'}
            </Button>
          ) : (
            <div className="space-y-2">
              <Button
                onClick={handleLogin}
                disabled={pending || code.length !== 6}
                className="w-full"
                size="lg"
              >
                {pending ? '登录中…' : '登录'}
              </Button>
              <Button
                variant="ghost"
                onClick={handleSendCode}
                disabled={pending}
                className="w-full"
                size="sm"
              >
                重新发送验证码
              </Button>
            </div>
          )}
        </div>
      </Card>
    </main>
  )
}
