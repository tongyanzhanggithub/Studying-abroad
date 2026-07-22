import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { PlanEditor } from './SkuEditor'

/**
 * 季票价格维护。人工服务在 /admin/services。
 *
 * 改价只影响之后的新订单:下单时 Subscription/Payment 已经把价格快照下来,
 * 支付回调只跟快照对账。已下单/已支付的一律不动。
 */
export default async function AdminPricingPage() {
  await requireAdmin('super_admin')

  const [plans, skus] = await Promise.all([
    db.plan.findMany({ orderBy: { sort: 'asc' } }),
    db.serviceSku.findMany({ select: { id: true } }),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">季票价格</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-600">
          改动会立刻反映到定价页。
        </p>
      </div>

      <Card className="border-brand-200 bg-brand-50/50">
        <h2 className="text-sm font-medium text-ink-900">改价会影响谁</h2>
        <ul className="mt-2 space-y-1 text-xs leading-relaxed text-ink-700">
          <li>· <strong>只影响改价之后的新订单。</strong>已支付的订单金额是下单当时快照下来的,不会被改写。</li>
          <li>· 价格填<strong>元</strong>,不是分。系统会换算,但请自己再看一眼小数点。</li>
          <li>· 要停售用「在售」开关,不要把价格改成 0。</li>
        </ul>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-ink-900">季票</h2>
        {plans.length === 0 ? (
          <Card><p className="text-sm text-ink-600">没有套餐,先跑 npm run db:seed。</p></Card>
        ) : (
          plans.map((p) => (
            <PlanEditor
              key={p.id}
              plan={{
                id: p.id,
                code: p.code,
                name: p.name,
                priceCents: p.priceCents,
                aiDailyQuota: p.aiDailyQuota,
                active: p.active,
              }}
            />
          ))
        )}
      </section>

      {/*
        人工服务的价格改到「人工服务」页统一管。
        同一个东西有两个入口,迟早会有人在 A 页改完又去 B 页看,以为没保存。
      */}
      <Card className="bg-ink-50">
        <p className="text-sm leading-relaxed text-ink-700">
          人工服务({skus.length} 项)的价格、文案、上下架都在{' '}
          <Link href="/admin/services" className="text-brand-600 underline">
            人工服务
          </Link>{' '}
          页管理 —— 那里还能新增和删除服务。
        </p>
      </Card>

      <Card className="bg-ink-50">
        <p className="text-xs leading-relaxed text-ink-600">
          退款规则(7 天内未使用全额退、接单前全额退、已接单未交付退 50%)写在代码里,
          不在这里配 —— 见 <code>src/lib/payment/index.ts</code>。
          它同时决定前台展示的文案和实际退款金额,两者必须永远一致,
          所以不做成可以只改一边的配置项。
        </p>
      </Card>
    </div>
  )
}
