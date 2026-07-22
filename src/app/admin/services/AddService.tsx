'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Field } from '@/components/ui'
import { createServiceSku, type SkuInput } from '../pricing/actions'

const inputCls =
  'w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500'

const EMPTY: SkuInput & { code: string } = {
  code: '',
  name: '',
  description: '',
  priceYuan: '',
  delivererRole: '',
  deliveryForm: '',
  slaHours: '72',
  active: false,
  sort: '99',
}

export function AddService() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState(EMPTY)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) =>
    setF((p) => ({ ...p, [k]: v }))

  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ 新增服务</Button>
  }

  return (
    <Card>
      <h3 className="font-medium text-ink-900">新增服务</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">
        新建的服务默认<strong>不上架</strong>。文案和交付人确认好之后,再到下面把「在售」勾上。
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="服务名" hint="会显示在定价页和服务市场,写清楚交付物,如「文书人工深度终审(单篇)」">
            <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
          </Field>
        </div>

        <Field label="价格(元)" hint="填元不填分">
          <input
            value={f.priceYuan}
            onChange={(e) => set('priceYuan', e.target.value)}
            inputMode="decimal"
            placeholder="1200"
            className={`${inputCls} font-mono`}
          />
        </Field>

        <Field label="交付时限(小时)" hint="超时会在派单页标红">
          <input
            value={f.slaHours}
            onChange={(e) => set('slaHours', e.target.value)}
            inputMode="numeric"
            className={inputCls}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="卖点描述" hint="用户买不买主要看这一句。说清楚给什么、不给什么。">
            <textarea
              value={f.description}
              rows={2}
              onChange={(e) => set('description', e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="交付人角色" hint="如:签约顾问 / 文书编辑 / 在读学长学姐">
          <input
            value={f.delivererRole}
            onChange={(e) => set('delivererRole', e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="交付形式" hint="如:视频会议(腾讯会议)">
          <input
            value={f.deliveryForm}
            onChange={(e) => set('deliveryForm', e.target.value)}
            className={inputCls}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field
            label="标识 code(选填)"
            hint="给程序用的:推荐规则靠它关联服务、埋点靠它归因。留空会自动生成。只能用小写字母、数字和下划线。"
          >
            <input
              value={f.code}
              onChange={(e) => set('code', e.target.value)}
              placeholder="essay_review"
              className={`${inputCls} font-mono`}
            />
          </Field>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setMsg(null)
              const res = await createServiceSku(f)
              if (!res.ok) {
                setMsg({ kind: 'err', text: res.error })
                return
              }
              setMsg({
                kind: 'ok',
                text: `已创建(标识 ${res.code}),当前是停售状态。在下面确认无误后再上架。`,
              })
              setF(EMPTY)
              setOpen(false)
              router.refresh()
            })
          }
        >
          {pending ? '创建中…' : '创建'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          取消
        </Button>
      </div>

      {msg && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed ${
            msg.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </p>
      )}
    </Card>
  )
}
