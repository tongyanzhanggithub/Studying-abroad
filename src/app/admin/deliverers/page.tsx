import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { AddDeliverer, DelivererRow } from './DelivererEditor'

/**
 * 交付人管理。
 *
 * ⚠️ 这一页以前完全不存在:派单页会警告「还没有录入任何交付人,否则订单
 *    无法派出去」,但后台没有任何录入入口 —— 用户按提示去找,找不到。
 *    人工服务是有收入的模块,没有交付人等于卖了服务交付不了。
 */
export default async function AdminDeliverersPage() {
  await requireAdmin('operator')

  const [deliverers, openCounts, doneCounts] = await Promise.all([
    db.deliverer.findMany({ orderBy: [{ active: 'desc' }, { createdAt: 'asc' }] }),
    db.serviceOrder.groupBy({
      by: ['delivererId'],
      where: { status: { in: ['assigned', 'delivering', 'disputed'] } },
      _count: true,
    }),
    db.serviceOrder.groupBy({
      by: ['delivererId'],
      where: { status: 'confirmed' },
      _count: true,
    }),
  ])

  const open = new Map(openCounts.map((r) => [r.delivererId, r._count]))
  const done = new Map(doneCounts.map((r) => [r.delivererId, r._count]))

  const active = deliverers.filter((d) => d.active)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">交付人</h1>
        <p className="mt-1 text-sm text-ink-600">
          签约的顾问、文书编辑、学长学姐。只有「在岗」的才会出现在派单下拉里。
        </p>
      </div>

      {deliverers.length === 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm leading-relaxed text-amber-900">
            还没有任何交付人。人工服务已经在前台卖了,但没有人能接单 ——
            先在这里录入至少一位,否则付了钱的订单会一直卡在「待派单」。
          </p>
        </Card>
      )}

      <AddDeliverer />

      <div className="space-y-3">
        {deliverers.map((d) => (
          <DelivererRow
            key={d.id}
            d={{
              id: d.id,
              name: d.name,
              role: d.role,
              wxContact: d.wxContact,
              phone: d.phone,
              splitRatio: d.splitRatio,
              note: d.note,
              showOnSite: d.showOnSite,
              publicTitle: d.publicTitle,
              education: d.education,
              yearsExp: d.yearsExp,
              specialties: d.specialties,
              highlight: d.highlight,
              active: d.active,
            }}
            stats={{ open: open.get(d.id) ?? 0, done: done.get(d.id) ?? 0 }}
          />
        ))}
      </div>

      {active.length > 0 && (
        <Card className="bg-ink-50">
          <p className="text-xs leading-relaxed text-ink-600">
            <strong>为什么只能停用不能删除:</strong>
            交付人被历史订单引用着。删掉之后月结对账就查不到钱该付给谁了。
            停用后不再出现在派单下拉里,但历史订单照常显示。
          </p>
        </Card>
      )}
    </div>
  )
}
