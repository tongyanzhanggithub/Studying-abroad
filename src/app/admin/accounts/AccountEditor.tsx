'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Field, Input, Select } from '@/components/ui'
import {
  createAccount,
  updateAccount,
  resetAccountPassword,
  setAccountActive,
  type AccountInput,
} from './actions'
import type { AdminRole } from '@prisma/client'
import { ROLE_LABEL, ROLE_DESC } from '@/lib/auth/roles'

// 两份标签已合并到 lib/auth/roles.ts —— 原来 layout 那份把 operator 写成
// 「运营管理员」、data_entry 写成「数据核对」,还漏了 advisor。原样再导出,
// 引这个文件的地方不用改。
export { ROLE_LABEL }

/** 新密码只显示一次,必须让管理员看清并转交 */
function PasswordOnce({ email, password }: { email: string; password: string }) {
  return (
    <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
      <p className="text-xs font-medium text-green-900">密码只显示这一次</p>
      <p className="mt-1 font-mono text-sm text-green-900">
        {email} / {password}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-green-800">
        通过安全渠道转交给本人(不要发在群里),并让他登录后尽快自己改掉。
        忘了只能重置,系统里不保存明文。
      </p>
    </div>
  )
}

function Form({
  id,
  initial,
  deliverers,
  onDone,
  onCancel,
}: {
  id: string | null
  initial: AccountInput
  deliverers: Array<{ id: string; name: string; role: string; taken: boolean }>
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [f, setF] = useState(initial)
  const [err, setErr] = useState<string | null>(null)
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const set = <K extends keyof AccountInput>(k: K, v: AccountInput[K]) =>
    setF((p) => ({ ...p, [k]: v }))

  if (created) {
    return (
      <div>
        <PasswordOnce {...created} />
        <Button
          className="mt-3"
          size="sm"
          onClick={() => {
            setCreated(null)
            onDone()
          }}
        >
          我已记下
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="邮箱" hint="登录用">
          <Input value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="姓名">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="角色" hint={ROLE_DESC[f.role]}>
            <Select
              value={f.role}
              onChange={(e) => set('role', e.target.value as AdminRole)}
            >
              {(Object.keys(ROLE_LABEL) as AdminRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {f.role === 'advisor' && (
          <div className="sm:col-span-2">
            <Field
              label="关联交付人"
              hint="顾问登录后看到的是这个交付人名下的订单。没有关联就一单也看不到。"
            >
              <Select
                value={f.delivererId}
                onChange={(e) => set('delivererId', e.target.value)}
              >
                <option value="">选择交付人</option>
                {deliverers.map((d) => (
                  <option key={d.id} value={d.id} disabled={d.taken && d.id !== initial.delivererId}>
                    {d.name}({d.role}){d.taken && d.id !== initial.delivererId ? ' · 已有账号' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setErr(null)
              if (id) {
                const res = await updateAccount(id, f)
                if (!res.ok) {
                  setErr(res.error)
                  return
                }
                onDone()
                router.refresh()
              } else {
                const res = await createAccount(f)
                if (!res.ok) {
                  setErr(res.error)
                  return
                }
                setCreated({ email: res.email, password: res.password })
                router.refresh()
              }
            })
          }
        >
          {pending ? '保存中…' : id ? '保存' : '创建账号'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
    </div>
  )
}

export function AddAccount({
  deliverers,
}: {
  deliverers: Array<{ id: string; name: string; role: string; taken: boolean }>
}) {
  const [open, setOpen] = useState(false)
  if (!open) return <Button onClick={() => setOpen(true)}>+ 新增账号</Button>

  return (
    <Card>
      <h3 className="mb-4 font-medium text-ink-900">新增账号</h3>
      <Form
        id={null}
        initial={{ email: '', name: '', role: 'operator', delivererId: '' }}
        deliverers={deliverers}
        onDone={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </Card>
  )
}

export function AccountRow({
  a,
  deliverers,
  isSelf,
}: {
  a: {
    id: string
    email: string
    name: string
    role: AdminRole
    active: boolean
    delivererId: string | null
    delivererName: string | null
    lastLoginAt: string | null
    locked: boolean
  }
  deliverers: Array<{ id: string; name: string; role: string; taken: boolean }>
  isSelf: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [reset, setReset] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <Card className={a.active ? '' : 'bg-ink-50'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink-900">{a.name}</span>
            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">
              {ROLE_LABEL[a.role]}
            </span>
            {isSelf && (
              <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">你</span>
            )}
            {!a.active && (
              <span className="rounded bg-ink-200 px-1.5 py-0.5 text-xs text-ink-600">已停用</span>
            )}
            {a.locked && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
                登录已锁定
              </span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-xs text-ink-500">{a.email}</p>
          <p className="text-xs text-ink-400">
            {a.delivererName ? `关联交付人 ${a.delivererName} · ` : ''}
            {a.lastLoginAt ? `最后登录 ${a.lastLoginAt}` : '从未登录'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3 text-xs">
          <button onClick={() => setEditing(!editing)} className="text-brand-600 hover:underline">
            {editing ? '收起' : '编辑'}
          </button>
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setErr(null)
                const res = await resetAccountPassword(a.id)
                if (res.ok) setReset(res.password)
                router.refresh()
              })
            }
            className="text-ink-400 hover:text-ink-700"
          >
            重置密码
          </button>
          {!isSelf && (
            <button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setErr(null)
                  const res = await setAccountActive(a.id, !a.active)
                  if (!res.ok) setErr(res.error)
                  else router.refresh()
                })
              }
              className="text-ink-400 hover:text-ink-700"
            >
              {a.active ? '停用' : '恢复'}
            </button>
          )}
        </div>
      </div>

      {reset && <PasswordOnce email={a.email} password={reset} />}
      {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

      {editing && (
        <div className="mt-4 border-t border-ink-100 pt-4">
          <Form
            id={a.id}
            initial={{
              email: a.email,
              name: a.name,
              role: a.role,
              delivererId: a.delivererId ?? '',
            }}
            deliverers={deliverers}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
    </Card>
  )
}
