import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { formatCents } from '@/lib/utils'
import { SkuEditor } from '../pricing/SkuEditor'
import { AddService } from './AddService'

/**
 * 人工服务目录管理。
 *
 * ⚠️ 独立成一页有两个原因:
 *   1. 之前服务编辑藏在「价格」页里。运营要找「怎么加一个新服务」,
 *      会去点「服务派单」——那是订单页,不是目录页。功能存在但找不到,
 *      跟没有差不多。
 *   2. 之前**只能改 seed 出来的五个,加不了新的**。想上一个新服务
 *      得改代码重新部署,而人工服务本来就是要按市场反馈不断调整的品类。
 */
export default async function AdminServicesPage() {
  await requireAdmin('super_admin')

  const [skus, orderStats, ruleStats] = await Promise.all([
    db.serviceSku.findMany({ orderBy: [{ active: 'desc' }, { sort: 'asc' }] }),
    db.serviceOrder.groupBy({ by: ['skuId'], _count: true }),
    db.recommendationRule.groupBy({ by: ['skuId'], _count: true }),
  ])

  const pendingBySku = await db.serviceOrder.groupBy({
    by: ['skuId'],
    where: { status: 'pending_payment' },
    _count: true,
  })

  const orders = new Map(orderStats.map((r) => [r.skuId, r._count]))
  const rules = new Map(ruleStats.map((r) => [r.skuId, r._count]))
  const pending = new Map(pendingBySku.map((r) => [r.skuId, r._count]))

  const live = skus.filter((s) => s.active)
  const off = skus.filter((s) => !s.active)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">人工服务</h1>
          <p className="mt-1 text-sm text-ink-600">
            在售 {live.length} 项,已停售 {off.length} 项。改动即刻反映到定价页和服务市场。
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <Link href="/admin/dispatch" className="text-brand-600 hover:underline">
            服务派单 →
          </Link>
          <Link href="/admin/deliverers" className="text-brand-600 hover:underline">
            交付人 →
          </Link>
        </div>
      </div>

      <Card className="border-brand-200 bg-brand-50/50">
        <ul className="space-y-1 text-xs leading-relaxed text-ink-700">
          <li>
            · 改价<strong>只影响之后的新订单</strong>。已支付、已交付、已结算的金额都是下单当时快照下来的。
          </li>
          <li>· 新建的服务默认<strong>停售</strong>,确认文案和交付人之后再上架。</li>
          <li>· 已经有订单的服务<strong>不能删除</strong>,只能停售 —— 否则历史订单查不到买的是什么。</li>
          <li>
            · 上架前先确认{' '}
            <Link href="/admin/deliverers" className="underline">
              交付人
            </Link>{' '}
            里有人能接这类单,否则订单会卡在「待派单」。
          </li>
        </ul>
      </Card>

      <AddService />

      {skus.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-600">还没有任何服务。用上面的按钮新增,或跑 npm run db:seed 恢复默认五项。</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {[
            { title: '在售', list: live },
            { title: '已停售', list: off },
          ].map(({ title, list }) =>
            list.length === 0 ? null : (
              <section key={title} className="space-y-3">
                <h2 className="text-lg font-medium text-ink-900">
                  {title}
                  <span className="ml-2 text-sm font-normal text-ink-400">{list.length}</span>
                </h2>
                {list.map((s) => (
                  <div key={s.id} className="space-y-1">
                    <p className="px-1 text-xs text-ink-400">
                      {formatCents(s.priceCents)} · 累计 {orders.get(s.id) ?? 0} 单
                      {(rules.get(s.id) ?? 0) > 0 &&
                        ` · 被 ${rules.get(s.id)} 条推荐规则引用`}
                    </p>
                    <SkuEditor
                      sku={{
                        id: s.id,
                        code: s.code,
                        name: s.name,
                        description: s.description,
                        priceCents: s.priceCents,
                        delivererRole: s.delivererRole,
                        deliveryForm: s.deliveryForm,
                        slaHours: s.slaHours,
                        active: s.active,
                        sort: s.sort,
                      }}
                      pendingOrders={pending.get(s.id) ?? 0}
                      usage={{ orders: orders.get(s.id) ?? 0, rules: rules.get(s.id) ?? 0 }}
                      allowDelete
                    />
                  </div>
                ))}
              </section>
            ),
          )}
        </div>
      )}
    </div>
  )
}
