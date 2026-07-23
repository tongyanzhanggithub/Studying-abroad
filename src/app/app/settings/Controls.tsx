'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field, RadioGroup } from '@/components/ui'
import { updateProfile, exportMyData, deleteAccount } from './actions'
import { setMyPassword } from '@/app/login/actions'
import { UNDERGRAD_MAJOR_OPTIONS } from '@/lib/programs/types'
import type { LanguageType, UndergradTier } from '@prisma/client'

const TIER_OPTIONS = [
  { value: 'c985_211' as const, label: '985 / 211' },
  { value: 'double_non_first' as const, label: '双非一本' },
  { value: 'tier_two_other' as const, label: '二本及其他' },
  { value: 'overseas' as const, label: '海外本科' },
]

const LANG_OPTIONS = [
  { value: 'ielts' as const, label: '雅思' },
  { value: 'toefl' as const, label: '托福' },
  { value: 'none' as const, label: '还没考' },
]

export function ProfileForm({
  initial,
}: {
  initial: {
    undergradTier: UndergradTier | null
    undergradMajor: string | null
    gpa: number | null
    gpaScale: string
    languageType: LanguageType | null
    languageScore: number | null
    languageMinBand: number | null
    isMajorSwitch: boolean
  }
}) {
  const router = useRouter()
  const [f, setF] = useState(initial)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <div className="space-y-4">
      <Field label="本科院校层级">
        <RadioGroup
          options={TIER_OPTIONS}
          value={f.undergradTier}
          onChange={(v) => setF({ ...f, undergradTier: v })}
        />
      </Field>

      <Field label="本科学科门类">
        <select
          value={f.undergradMajor ?? ''}
          onChange={(e) => setF({ ...f, undergradMajor: e.target.value || null })}
          className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          <option value="">请选择</option>
          {UNDERGRAD_MAJOR_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.description} · {m.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-400">
          决定方向推荐里哪些算「顺延」、哪些算「转向」。
        </p>
      </Field>

      <Field label={`GPA(${f.gpaScale === '100' ? '百分制' : '4 分制'})`}>
        <div className="flex gap-2">
          <input
            type="number"
            step="0.01"
            value={f.gpa ?? ''}
            onChange={(e) => setF({ ...f, gpa: e.target.value ? Number(e.target.value) : null })}
            className="flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <select
            value={f.gpaScale}
            onChange={(e) => setF({ ...f, gpaScale: e.target.value })}
            className="rounded-lg border border-ink-200 px-2 text-sm"
          >
            <option value="100">百分制</option>
            <option value="4.0">4 分制</option>
          </select>
        </div>
      </Field>

      <Field label="语言成绩">
        <RadioGroup
          options={LANG_OPTIONS}
          value={f.languageType}
          onChange={(v) => setF({ ...f, languageType: v })}
        />
        {f.languageType && f.languageType !== 'none' && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-ink-500">总分</label>
              <input
                type="number"
                step="0.5"
                value={f.languageScore ?? ''}
                onChange={(e) =>
                  setF({ ...f, languageScore: e.target.value ? Number(e.target.value) : null })
                }
                placeholder={f.languageType === 'ielts' ? '如 6.5' : '如 95'}
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-500">
                最低单项 <span className="text-ink-400">(建议填)</span>
              </label>
              <input
                type="number"
                step="0.5"
                value={f.languageMinBand ?? ''}
                onChange={(e) =>
                  setF({ ...f, languageMinBand: e.target.value ? Number(e.target.value) : null })
                }
                placeholder={f.languageType === 'ielts' ? '如 6.0' : '如 20'}
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </div>
          </div>
        )}
        {f.languageType === 'ielts' && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            很多学校写的是「总分 6.5,<strong>单项不低于 6.0</strong>」。
            总分够但有一项差 0.5 也会被拒 —— 填上你四项里最低的那个分数,
            我们才能把这类项目如实标出来,而不是笼统告诉你「达标」。
          </p>
        )}
      </Field>

      <label className="flex items-center gap-2 text-sm text-ink-600">
        <input
          type="checkbox"
          checked={f.isMajorSwitch}
          onChange={(e) => setF({ ...f, isMajorSwitch: e.target.checked })}
        />
        我是转专业申请
      </label>

      <div className="flex items-center gap-3">
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await updateProfile(f)
              setSaved(true)
              router.refresh()
            })
          }
        >
          {pending ? '保存中…' : '保存'}
        </Button>
        {saved && !pending && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m20 6-11 11-5-5" />
            </svg>
            已保存
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * 设置 / 修改登录密码。
 *
 * 学生端主路径是手机号 + 验证码,密码是可选的便捷入口 ——
 * 换手机、收不到短信、或部署环境没接短信时,它是唯一能进来的路。
 */
export function PasswordControls({ hasPassword }: { hasPassword: boolean }) {
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-ink-600">
        {hasPassword
          ? '你已设置过登录密码,可以在下面修改。'
          : '设置密码后,除了验证码,也可以直接用「手机号 + 密码」登录。'}
      </p>
      <input
        type="password"
        value={pwd}
        onChange={(e) => setPwd(e.target.value)}
        placeholder={hasPassword ? '新密码' : '设置密码'}
        className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
      />
      <input
        type="password"
        value={pwd2}
        onChange={(e) => setPwd2(e.target.value)}
        placeholder="再输一次"
        className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
      />
      {msg && (
        <p className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</p>
      )}
      <Button
        disabled={pending || !pwd || !pwd2}
        onClick={() =>
          startTransition(async () => {
            if (pwd !== pwd2) {
              setMsg({ ok: false, text: '两次输入的密码不一致' })
              return
            }
            const res = await setMyPassword(pwd)
            if (!res.ok) {
              setMsg({ ok: false, text: res.error })
              return
            }
            setPwd('')
            setPwd2('')
            setMsg({ ok: true, text: '密码已保存,下次可以用手机号 + 密码登录' })
          })
        }
      >
        {pending ? '保存中…' : hasPassword ? '修改密码' : '设置密码'}
      </Button>
    </div>
  )
}

export function DataControls() {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="space-y-4">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await exportMyData()
            if (!res.ok) return
            const blob = new Blob([JSON.stringify(res.data, null, 2)], {
              type: 'application/json',
            })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `compass-我的数据-${new Date().toISOString().slice(0, 10)}.json`
            a.click()
            URL.revokeObjectURL(url)
          })
        }
      >
        {pending ? '导出中…' : '导出我的全部数据'}
      </Button>

      <div className="border-t border-ink-200 pt-4">
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="text-sm text-ink-400 hover:text-red-700 hover:underline"
          >
            注销账号并清除全部数据
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-red-700">
              注销账号会同时<strong>清除账号内全部数据</strong>,包括选校单、材料、文书全部版本和个人资料,
              且不可恢复。建议先导出数据。
            </p>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="输入你的手机号以确认注销"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-red-400"
            />
            {error && <p className="text-xs text-red-700">{error}</p>}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
                取消
              </Button>
              <button
                disabled={pending || !phone}
                onClick={() =>
                  startTransition(async () => {
                    const res = await deleteAccount(phone)
                    if (!res.ok) setError(res.error)
                    else router.push('/')
                  })
                }
                className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {pending ? '处理中…' : '确认注销并清除数据'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
