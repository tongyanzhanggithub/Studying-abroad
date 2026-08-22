import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { ChangePassword } from '@/components/ChangePassword'
import { ROLE_LABEL } from '@/lib/auth/roles'

/**
 * 「我的账号」。
 *
 * ⚠️ 门槛是 data_entry(最低的运营侧角色),不是 super_admin ——
 *    /admin/accounts 要 super_admin,所以运营和数据录入此前
 *    根本没有任何地方能改自己的密码。顾问走 /advisor 上那份。
 */
export const dynamic = 'force-dynamic'

export default async function MyAccountPage() {
  const me = await requireAdmin('data_entry')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">我的账号</h1>
        <p className="mt-1 text-sm text-ink-600">当前角色:{ROLE_LABEL[me.role]}</p>
      </div>

      <ChangePassword />

      <Card>
        <p className="text-xs leading-relaxed text-ink-600">
          改完密码,<strong>其它设备上已登录的会话会立刻失效</strong>,需要用新密码重新登录;
          你正在用的这台不受影响 —— 你刚刚已经用旧密码验证过了。
          所以怀疑号被别人拿到时,改密码就够了。
        </p>
      </Card>
    </div>
  )
}
