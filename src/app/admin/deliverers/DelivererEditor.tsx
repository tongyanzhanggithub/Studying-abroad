'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Field } from '@/components/ui'
import { saveDeliverer, setDelivererActive, type DelivererInput } from '../dispatch/actions'

const inputCls =
  'w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500'

const EMPTY: DelivererInput = {
  name: '',
  role: '',
  wxContact: '',
  phone: '',
  splitPercent: '60',
  note: '',
  active: true,
}

const ROLE_PRESETS = ['签约顾问', '资深顾问', '文书编辑', '在读学长学姐', '主顾问']

function Form({
  id,
  initial,
  onDone,
  onCancel,
}: {
  id: string | null
  initial: DelivererInput
  onDone: () => void
  onCancel?: () => void
}) {
  const router = useRouter()
  const [f, setF] = useState(initial)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const set = <K extends keyof DelivererInput>(k: K, v: DelivererInput[K]) =>
    setF((p) => ({ ...p, [k]: v }))

  const pct = Number(f.splitPercent)
  const platformPct = Number.isFinite(pct) ? 100 - pct : null

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="姓名">
          <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="角色" hint="会显示在定价页的服务卡片上">
          <input
            value={f.role}
            onChange={(e) => set('role', e.target.value)}
            list="role-presets"
            className={inputCls}
          />
          <datalist id="role-presets">
            {ROLE_PRESETS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Field>
        <Field label="企业微信 / 微信号" hint="派单后你要靠它把人拉进群">
          <input
            value={f.wxContact}
            onChange={(e) => set('wxContact', e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="手机号">
          <input value={f.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} />
        </Field>
        <Field
          label="分成比例(%)"
          hint={
            platformPct === null
              ? '填 0-100 的数字'
              : `交付人拿 ${pct}%,平台留 ${platformPct}%`
          }
        >
          <input
            value={f.splitPercent}
            onChange={(e) => set('splitPercent', e.target.value)}
            inputMode="numeric"
            className={`${inputCls} font-mono`}
          />
        </Field>
        <label className="flex items-start gap-2 pt-7">
          <input
            type="checkbox"
            checked={f.active}
            onChange={(e) => set('active', e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm text-ink-700">在岗(可接单)</span>
        </label>
        <div className="sm:col-span-2">
          <Field label="备注" hint="擅长地区 / 专业方向 / 不接什么单,派单时的参考">
            <textarea
              value={f.note}
              rows={2}
              onChange={(e) => set('note', e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
      </div>

      <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
        改分成比例<strong>只影响之后派的单</strong>。已派出的订单在派单那一刻就把比例
        快照下来了,不会被改写 —— 否则调一次比例会把历史账全改了。
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setErr(null)
              const res = await saveDeliverer(id, f)
              if (!res.ok) {
                setErr(res.error)
                return
              }
              onDone()
              router.refresh()
            })
          }
        >
          {pending ? '保存中…' : '保存'}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
        )}
      </div>

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
    </div>
  )
}

export function AddDeliverer() {
  const [open, setOpen] = useState(false)
  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ 新增交付人</Button>
  }
  return (
    <Card>
      <h3 className="mb-4 font-medium text-ink-900">新增交付人</h3>
      <Form id={null} initial={EMPTY} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
    </Card>
  )
}

export function DelivererRow({
  d,
  stats,
}: {
  d: {
    id: string
    name: string
    role: string
    wxContact: string | null
    phone: string | null
    splitRatio: number
    note: string | null
    active: boolean
  }
  stats: { open: number; done: number }
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <Card className={d.active ? '' : 'bg-ink-50'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink-900">{d.name}</span>
            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">{d.role}</span>
            {!d.active && (
              <span className="rounded bg-ink-200 px-1.5 py-0.5 text-xs text-ink-600">已停用</span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-600">
            分成 {Math.round(d.splitRatio * 100)}% · 手上 {stats.open} 单 · 累计完成 {stats.done} 单
          </p>
          <p className="text-xs text-ink-400">
            {d.wxContact ? `微信 ${d.wxContact}` : '未填微信'}
            {d.phone ? ` · ${d.phone}` : ''}
          </p>
          {d.note && <p className="mt-1 text-xs leading-relaxed text-ink-500">{d.note}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <button
            onClick={() => setEditing(!editing)}
            className="text-xs text-brand-600 hover:underline"
          >
            {editing ? '收起' : '编辑'}
          </button>
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setErr(null)
                const res = await setDelivererActive(d.id, !d.active)
                if (!res.ok) setErr(res.error)
                else router.refresh()
              })
            }
            className="text-xs text-ink-400 hover:text-ink-700"
          >
            {d.active ? '停用' : '恢复'}
          </button>
        </div>
      </div>

      {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

      {editing && (
        <div className="mt-4 border-t border-ink-100 pt-4">
          <Form
            id={d.id}
            initial={{
              name: d.name,
              role: d.role,
              wxContact: d.wxContact ?? '',
              phone: d.phone ?? '',
              splitPercent: String(Math.round(d.splitRatio * 100)),
              note: d.note ?? '',
              active: d.active,
            }}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
    </Card>
  )
}
