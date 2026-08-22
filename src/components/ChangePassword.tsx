'use client'

import { useState, useTransition } from 'react'
import { Button, Card, Field, Input } from '@/components/ui'
import { changeOwnPassword } from '@/app/admin/accounts/actions'

/**
 * 改自己的密码。
 *
 * ── 为什么单独做成共用组件 ────────────────────────────
 *
 * changeOwnPassword 这个 server action **写好了却从来没有入口** ——
 * 全项目只有它自己的定义那一行,没有任何调用。它的注释写着
 * 「所有角色都能用,包括顾问」,而实际上:
 *
 *   · /admin/accounts 要 super_admin —— 运营和数据录入进不去
 *   · /advisor 上没有任何账号相关的东西 —— 顾问更没有
 *
 * 也就是说**没有任何人能改自己的密码**。而账号创建时那段提示写的是
 * 「通过安全渠道转交给本人……并让他登录后尽快自己改掉」——
 * 产品自己的文案在让用户做一件系统不提供的事。
 *
 * 对外部签约的交付顾问尤其要紧:他拿到一个别人生成、别人见过的密码,
 * 想换只能回头求运营重置。
 *
 * 所以放成共用组件,挂在两处覆盖全部四种角色:
 *   /admin/me      data_entry 及以上(数据录入 / 运营 / 超管)
 *   /advisor       顾问
 */
export function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const submit = () => {
    setMsg(null)
    /**
     * 两次输入不一致在前端就拦掉 —— 服务端没有 confirm 这个概念,
     * 让它走一趟只会把「打错字」变成「密码被改成了你以为之外的东西」。
     */
    if (next !== confirm) {
      setMsg({ kind: 'err', text: '两次输入的新密码不一致' })
      return
    }
    startTransition(async () => {
      const res = await changeOwnPassword(current, next)
      if (!res.ok) {
        setMsg({ kind: 'err', text: res.error })
        return
      }
      setCurrent('')
      setNext('')
      setConfirm('')
      setMsg({ kind: 'ok', text: '密码已修改。下次登录用新密码。' })
    })
  }

  return (
    <Card>
      <h2 className="font-medium text-ink-900">修改密码</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-600">
        账号是别人创建的,初始密码也是别人生成并转交的 —— 登录后尽快改成只有你知道的。
        系统不保存明文,忘了只能找超级管理员重置。
      </p>

      <div className="mt-4 max-w-sm space-y-3">
        <Field label="当前密码">
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label="新密码">
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="再输一次新密码">
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>

        <Button
          disabled={pending || !current || !next || !confirm}
          onClick={submit}
        >
          {pending ? '处理中…' : '修改密码'}
        </Button>

        {msg && (
          <p
            className={
              msg.kind === 'ok'
                ? 'text-sm text-green-700'
                : 'text-sm text-urgent-critical'
            }
          >
            {msg.text}
          </p>
        )}
      </div>
    </Card>
  )
}
