'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Field } from '@/components/ui'
import {
  saveServiceSku,
  savePlan,
  deleteServiceSku,
  deletePlan,
  type SkuInput,
  type PlanInput,
} from './actions'

const inputCls =
  'w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500'

function yuan(cents: number): string {
  return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 0 })
}

/** 改价幅度大到该停一下确认的阈值 */
const BIG_CHANGE = 0.3

function Result({ msg }: { msg: { kind: 'ok' | 'err'; text: string } | null }) {
  if (!msg) return null
  return (
    <p
      className={`mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed ${
        msg.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
      }`}
    >
      {msg.text}
    </p>
  )
}

export function SkuEditor({
  sku,
  pendingOrders,
  usage,
  allowDelete = false,
}: {
  sku: {
    id: string
    code: string
    name: string
    description: string | null
    priceCents: number
    delivererRole: string
    deliveryForm: string
    slaHours: number
    active: boolean
    sort: number
  }
  /** 已下单但还没付款的数量 —— 这些人付的仍是旧价 */
  pendingOrders: number
  /** 影响面:总订单数、被多少条推荐规则引用 */
  usage?: { orders: number; rules: number }
  allowDelete?: boolean
}) {
  const router = useRouter()
  const [f, setF] = useState<SkuInput>({
    name: sku.name,
    description: sku.description ?? '',
    priceYuan: String(sku.priceCents / 100),
    delivererRole: sku.delivererRole,
    deliveryForm: sku.deliveryForm,
    slaHours: String(sku.slaHours),
    active: sku.active,
    sort: String(sku.sort),
  })
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, startTransition] = useTransition()

  const set = <K extends keyof SkuInput>(k: K, v: SkuInput[K]) =>
    setF((p) => ({ ...p, [k]: v }))

  const newCents = Math.round(Number(f.priceYuan.replace(/[,,¥￥\s]/g, '')) * 100)
  const priceChanged = Number.isFinite(newCents) && newCents !== sku.priceCents
  const bigChange =
    priceChanged && Math.abs(newCents - sku.priceCents) / sku.priceCents > BIG_CHANGE

  const doSave = () =>
    startTransition(async () => {
      setMsg(null)
      const res = await saveServiceSku(sku.id, f)
      setConfirming(false)
      if (!res.ok) {
        setMsg({ kind: 'err', text: res.error })
        return
      }
      setMsg({
        kind: 'ok',
        text: res.changedPrice
          ? `已保存。价格 ¥${yuan(res.fromCents)} → ¥${yuan(res.toCents)},即刻对新订单生效。`
          : '已保存。',
      })
      router.refresh()
    })

  return (
    <Card className={sku.active ? '' : 'bg-ink-50'}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium text-ink-900">{sku.name}</h3>
        <span className="font-mono text-xs text-ink-400">{sku.code}</span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="服务名">
            <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
          </Field>
        </div>

        <Field label="价格(元)" hint={`当前 ¥${yuan(sku.priceCents)}。填元不填分,如 1200`}>
          <input
            value={f.priceYuan}
            onChange={(e) => set('priceYuan', e.target.value)}
            inputMode="decimal"
            className={`${inputCls} font-mono`}
          />
        </Field>

        <Field label="交付时限(小时)">
          <input
            value={f.slaHours}
            onChange={(e) => set('slaHours', e.target.value)}
            inputMode="numeric"
            className={inputCls}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="卖点描述" hint="展示在定价页和服务市场,直接影响转化。">
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

        <Field label="排序" hint="数字小的排前面">
          <input
            value={f.sort}
            onChange={(e) => set('sort', e.target.value)}
            inputMode="numeric"
            className={inputCls}
          />
        </Field>

        <label className="flex items-start gap-2 pt-7">
          <input
            type="checkbox"
            checked={f.active}
            onChange={(e) => set('active', e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm text-ink-700">
            在售
            <span className="mt-0.5 block text-xs text-ink-400">
              取消勾选即下架,前台不再出现。已有订单不受影响。
            </span>
          </span>
        </label>
      </div>

      {priceChanged && (
        <div
          className={`mt-4 rounded-lg px-3 py-2 text-xs leading-relaxed ${
            bigChange ? 'bg-amber-50 text-amber-900' : 'bg-ink-50 text-ink-600'
          }`}
        >
          ¥{yuan(sku.priceCents)} → ¥{Number.isFinite(newCents) ? yuan(newCents) : '?'}
          {bigChange && <strong>(改动超过 30%,确认一下没多打或少打零)</strong>}
          {pendingOrders > 0 && (
            <>
              <br />
              有 <strong>{pendingOrders}</strong> 笔待付款订单是按旧价生成的,
              他们付的仍是旧价 —— 页面上标什么价就收什么价,不能在付款途中变价。
            </>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {bigChange && !confirming ? (
          <Button variant="secondary" disabled={pending} onClick={() => setConfirming(true)}>
            保存(改幅较大)
          </Button>
        ) : (
          <Button disabled={pending} onClick={doSave}>
            {pending ? '保存中…' : '保存'}
          </Button>
        )}
        {confirming && (
          <>
            <span className="text-xs text-amber-800">
              确认把价格改成 ¥{Number.isFinite(newCents) ? yuan(newCents) : '?'}?
            </span>
            <Button size="sm" disabled={pending} onClick={doSave}>
              确认
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              取消
            </Button>
          </>
        )}

        {allowDelete && !confirmDelete && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="ml-auto text-xs text-ink-400 underline hover:text-red-600"
          >
            删除
          </button>
        )}
      </div>

      {confirmDelete && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2.5">
          {usage && usage.orders > 0 ? (
            <p className="text-xs leading-relaxed text-red-800">
              这个服务已经有 <strong>{usage.orders}</strong> 笔订单,不能删除 ——
              删了之后历史订单查不到买的是什么,月结对账和退款争议都没法处理。
              需要下架的话,把上面的「在售」取消勾选即可,前台不再出现,老订单照常。
            </p>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-red-800">
                删除后不可恢复。
                {usage && usage.rules > 0 && (
                  <>
                    {' '}
                    <strong>
                      还会连带删掉引用它的 {usage.rules} 条推荐规则
                    </strong>
                    (数据库是级联删除)—— 那些规则是调过的,删了要重配。
                  </>
                )}
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await deleteServiceSku(sku.id)
                      if (!res.ok) {
                        setMsg({ kind: 'err', text: res.error })
                        setConfirmDelete(false)
                        return
                      }
                      router.refresh()
                    })
                  }
                >
                  确认删除
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  取消
                </Button>
              </div>
            </>
          )}
          {usage && usage.orders > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              onClick={() => setConfirmDelete(false)}
            >
              知道了
            </Button>
          )}
        </div>
      )}

      <Result msg={msg} />
    </Card>
  )
}

export function PlanEditor({
  plan,
  usage,
  allowDelete = false,
}: {
  plan: {
    id: string
    code: string
    name: string
    priceCents: number
    aiDailyQuota: number
    active: boolean
  }
  /** 影响面:被多少个订阅引用 —— 有订阅就不能删,只能停售 */
  usage?: { subscriptions: number }
  allowDelete?: boolean
}) {
  const router = useRouter()
  const [f, setF] = useState<PlanInput>({
    name: plan.name,
    priceYuan: String(plan.priceCents / 100),
    aiDailyQuota: String(plan.aiDailyQuota),
    active: plan.active,
  })
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, startTransition] = useTransition()

  const set = <K extends keyof PlanInput>(k: K, v: PlanInput[K]) =>
    setF((p) => ({ ...p, [k]: v }))

  const doSave = () =>
    startTransition(async () => {
      setMsg(null)
      const res = await savePlan(plan.id, f)
      if (!res.ok) {
        setMsg({ kind: 'err', text: res.error })
        return
      }
      setMsg({
        kind: 'ok',
        text: res.changedPrice
          ? `已保存。价格 ¥${yuan(res.fromCents)} → ¥${yuan(res.toCents)}。`
          : '已保存。',
      })
      router.refresh()
    })

  const subs = usage?.subscriptions ?? 0

  return (
    <Card className={plan.active ? '' : 'bg-ink-50'}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium text-ink-900">{plan.name}</h3>
        <span className="font-mono text-xs text-ink-400">{plan.code}</span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="套餐名">
            <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="价格(元)" hint={`当前 ¥${yuan(plan.priceCents)}`}>
          <input
            value={f.priceYuan}
            onChange={(e) => set('priceYuan', e.target.value)}
            inputMode="decimal"
            className={`${inputCls} font-mono`}
          />
        </Field>
        <Field label="每日 AI 次数" hint="订阅用户每天可用的 AI 文书辅助次数上限">
          <input
            value={f.aiDailyQuota}
            onChange={(e) => set('aiDailyQuota', e.target.value)}
            inputMode="numeric"
            className={inputCls}
          />
        </Field>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={f.active}
            onChange={(e) => set('active', e.target.checked)}
          />
          <span className="text-sm text-ink-700">在售</span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={pending} onClick={doSave}>
          {pending ? '保存中…' : '保存'}
        </Button>
        {allowDelete && !confirmDelete && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="ml-auto text-xs text-ink-400 underline hover:text-red-600"
          >
            删除
          </button>
        )}
      </div>

      {confirmDelete && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2.5">
          {subs > 0 ? (
            <>
              <p className="text-xs leading-relaxed text-red-800">
                这个套餐已经有 <strong>{subs}</strong> 位用户订阅过,不能删除 ——
                删了之后这些订阅查不到买的是哪个套餐,月结对账、退款、有效期判定都会断。
                需要下架的话,把上面的「在售」取消勾选即可,前台不再出现,老订阅照常。
              </p>
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setConfirmDelete(false)}>
                知道了
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-red-800">删除后不可恢复。</p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await deletePlan(plan.id)
                      if (!res.ok) {
                        setMsg({ kind: 'err', text: res.error })
                        setConfirmDelete(false)
                        return
                      }
                      router.refresh()
                    })
                  }
                >
                  确认删除
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  取消
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <Result msg={msg} />
    </Card>
  )
}
