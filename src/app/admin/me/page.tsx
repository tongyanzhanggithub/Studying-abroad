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
          改密码不会把已登录的其它设备踢下线 —— 后台会话是 30 天有效的 token。
          如果怀疑账号被别人拿到了,除了改密码,还要找超级管理员在
          「账号」页把你停用再启用一次。
        </p>
      </Card>
    </div>
  )
}
