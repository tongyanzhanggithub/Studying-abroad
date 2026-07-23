import { requireUser } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { DataControls, PasswordControls } from './Controls'

/**
 * 账号设置(PRD 3.1 / 10.3)。
 *
 * ⚠️ 合规必备:提供**数据导出**与**账号注销**入口。
 *    这不是可选功能 —— 《个人信息保护法》要求个人有权查阅、复制、删除其个人信息。
 */
export default async function SettingsPage() {
  const user = await requireUser()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-ink-900">设置</h1>

      <Card>
        <h2 className="mb-2 font-medium text-ink-900">登录密码</h2>
        <PasswordControls hasPassword={!!user.passwordHash} />
      </Card>

      <Card>
        <h2 className="mb-2 font-medium text-ink-900">账号</h2>
        <p className="text-sm text-ink-600">手机号 {user.phone}</p>
        <p className="mt-1 text-xs text-ink-400">
          {user.agreedTermsAt
            ? `已于 ${user.agreedTermsAt.toLocaleDateString('zh-CN')} 同意用户协议(版本 ${user.agreedTermsVersion})`
            : ''}
        </p>
      </Card>

      <Card>
        <h2 className="mb-2 font-medium text-ink-900">你的数据</h2>
        <p className="mb-4 text-sm leading-relaxed text-ink-600">
          你的申请材料、文书、选校单都属于你。可以随时导出全部数据,
          也可以随时注销账号并删除所有信息。
        </p>
        <DataControls />
      </Card>
    </div>
  )
}
