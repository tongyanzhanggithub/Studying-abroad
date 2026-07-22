import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { getRegionHealth } from '@/lib/regions/gate'
import { RegionRow } from './RegionRow'

/**
 * 地区分批开放(PRD 11.3 的执行界面)。
 *
 * PRD 规定未核对数据 >10% 就该暂停投放。地区一多,「全部核对完才能上线」
 * 等于永远上不了线。这一页把闸门下放到地区:哪个核对达标就先开哪个。
 *
 * ⚠️ 达标只是**建议**,开放要人点。数据质量的责任不能交给一个自动阈值。
 */
export default async function AdminRegionsPage() {
  const admin = await requireAdmin('super_admin')
  const rows = await getRegionHealth()

  const publicRows = rows.filter((r) => r.isPublic)
  const readyToOpen = rows.filter((r) => !r.isPublic && r.meetsBar)
  const totalPrograms = rows.reduce((s, r) => s + r.total, 0)
  const publicPrograms = publicRows.reduce((s, r) => s + r.total, 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">地区开放</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-600">
          只有在这里开放的地区,才会出现在首页、免费评估和选校库里。
          未开放地区的数据仍可在「院校库」中核对,但用户完全看不到。
        </p>
      </div>

      {publicRows.length === 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm leading-relaxed text-amber-900">
            <strong>目前没有任何地区对用户开放</strong> —— 免费评估会显示「暂无可选地区」,
            首页的院校列表也是空的。这是默认状态(默认关闭,避免未核对数据意外流出)。
            先把某个地区核对达标,再在下面点开放。
          </p>
        </Card>
      )}

      {readyToOpen.length > 0 && (
        <Card className="border-green-200 bg-green-50">
          <p className="text-sm leading-relaxed text-green-900">
            <strong>{readyToOpen.map((r) => r.label).join('、')}</strong> 已达到开放门槛。
            确认数据没问题后,可以点「开放」。
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <p className="text-xs text-ink-400">已开放地区</p>
          <p className="mt-1 text-2xl font-semibold text-ink-900">
            {publicRows.length}
            <span className="ml-1 text-sm font-normal text-ink-400">/ {rows.length}</span>
          </p>
        </Card>
        <Card>
          <p className="text-xs text-ink-400">用户可见项目</p>
          <p className="mt-1 text-2xl font-semibold text-ink-900">
            {publicPrograms}
            <span className="ml-1 text-sm font-normal text-ink-400">/ {totalPrograms}</span>
          </p>
        </Card>
        <Card>
          <p className="text-xs text-ink-400">达标待开放</p>
          <p className="mt-1 text-2xl font-semibold text-ink-900">{readyToOpen.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-ink-400">待核对总量</p>
          <p className="mt-1 text-2xl font-semibold text-ink-900">
            {rows.reduce((s, r) => s + r.pending, 0)}
          </p>
        </Card>
      </div>

      <div className="space-y-3">
        {rows.map((r) => (
          <RegionRow key={r.region} health={r} adminId={admin.adminId} />
        ))}
      </div>

      <Card className="bg-ink-50">
        <p className="text-xs leading-relaxed text-ink-600">
          门槛默认是「核对率 ≥90% 且项目数 ≥25」,可以按地区单独调整。
          核对率的分母是该地区全部在售项目,分子是<strong>已核对且 30 天内复核过</strong>的项目 ——
          核对过但放了太久同样不算数。
        </p>
      </Card>
    </div>
  )
}
