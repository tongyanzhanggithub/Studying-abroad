'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { requestInvoice } from './invoice-actions'

/**
 * 开票申请。
 *
 * 定价页承诺「发票可在订单页申请开具」,这里是它的兑现入口。
 * 不接税务系统 —— 提交后进后台队列,财务线下开具后回填发票号。
 */
export function InvoiceRequestForm({
  paymentId,
  status,
  resultNote,
}: {
  paymentId: string
  /** 已提交过的话传当前状态,没提交过传 null */
  status: 'pending' | 'issued' | 'rejected' | null
  resultNote: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [titleType, setTitleType] = useState<'personal' | 'company'>('personal')
  const [title, setTitle] = useState('')
  const [taxNumber, setTaxNumber] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')

  if (status) {
    const label =
      status === 'pending' ? '发票申请已提交' : status === 'issued' ? '发票已开具' : '发票未能开具'
    return (
      <div className="mt-2 text-xs text-ink-500">
        {label}
        {status === 'pending' && ' —— 我们会在 5 个工作日内开具并发到你填写的邮箱'}
        {resultNote && <span className="ml-1 text-ink-600">({resultNote})</span>}
      </div>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 text-xs text-brand-600 hover:underline"
      >
        申请发票
      </button>
    )
  }

  return (
    <div className="mt-3 rounded-lg border border-ink-200 p-3">
      <p className="text-sm font-medium text-ink-900">申请发票</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">
        开票金额以这笔订单的实付金额为准。电子发票会发到你填写的邮箱。
      </p>

      <div className="mt-3 space-y-2">
        <div className="flex gap-2">
          {(['personal', 'company'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTitleType(t)}
              className={`min-h-10 flex-1 rounded-lg border px-3 text-sm ${
                titleType === t
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-ink-200 text-ink-600'
              }`}
            >
              {t === 'personal' ? '个人' : '企业'}
            </button>
          ))}
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={titleType === 'personal' ? '发票抬头(你的姓名)' : '公司全称'}
          className="min-h-11 w-full rounded-lg border border-ink-200 px-3 text-sm"
        />

        {titleType === 'company' && (
          <input
            value={taxNumber}
            onChange={(e) => setTaxNumber(e.target.value)}
            placeholder="纳税人识别号(必填,否则发票无法使用)"
            className="min-h-11 w-full rounded-lg border border-ink-200 px-3 text-sm"
          />
        )}

        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="接收电子发票的邮箱"
          className="min-h-11 w-full rounded-lg border border-ink-200 px-3 text-sm"
        />

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="备注(选填)"
          className="min-h-11 w-full rounded-lg border border-ink-200 px-3 text-sm"
        />
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null)
              try {
                const r = await requestInvoice({
                  paymentId,
                  titleType,
                  title,
                  taxNumber,
                  email,
                  note,
                })
                if (!r.ok) {
                  setError(r.error)
                  return
                }
                setOpen(false)
                router.refresh()
              } catch {
                setError('提交失败,请检查网络后重试')
              }
            })
          }
        >
          {pending ? '提交中…' : '提交申请'}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
          取消
        </Button>
      </div>
    </div>
  )
}
