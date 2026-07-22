import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Card, Disclaimer } from '@/components/ui'
import { RecommendationCard } from '@/components/RecommendationCard'
import { selectCard } from '@/lib/recommendation/engine'
import { formatCents, cn } from '@/lib/utils'
import { BuyButton } from '@/app/pricing/BuyButton'

/**
 * 增值服务市场(PRD 4.6)。
 *
 * 定位说明放在页面顶部 —— 这些服务是**可选**的,
 * 不买也能完整使用系统。这条信息必须说在前面。
 */

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ highlight?: string }>
}) {
  const user = await requireUser()
  const { highlight } = await searchParams

  const [skus, recCard, myOrders] = await Promise.all([
    db.serviceSku.findMany({ where: { active: true }, orderBy: { sort: 'asc' } }),
    selectCard(user.id, 'services_top'),
    db.serviceOrder.findMany({
      where: {
        userId: user.id,
        status: { in: ['paid', 'assigned', 'delivering', 'delivered', 'confirmed'] },
      },
      select: { skuId: true },
    }),
  ])

  const purchased = new Set(myOrders.map((o) => o.skuId))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">人工服务</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-600">
          系统已经覆盖了信息和流程。这里解决的是系统给不了的那部分 ——
          需要人的判断力的环节。<strong>都是可选的</strong>,不买不影响你使用任何功能。
        </p>
      </div>

      {recCard && <RecommendationCard card={recCard} />}

      <div className="space-y-3">
        {skus.map((sku) => (
          <Card
            key={sku.id}
            className={cn(highlight === sku.id && 'border-brand-500 ring-1 ring-brand-100')}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="font-medium text-ink-900">{sku.name}</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-600">{sku.description}</p>
                <p className="mt-1.5 text-xs text-ink-400">
                  {sku.delivererRole} · {sku.deliveryForm} · 承诺 {sku.slaHours} 小时内交付
                </p>
              </div>
              <div className="w-36 shrink-0">
                <p className="mb-2 text-right text-lg font-semibold text-ink-900">
                  {formatCents(sku.priceCents)}
                </p>
                {purchased.has(sku.id) ? (
                  <p className="text-right text-xs text-ink-400">已购买</p>
                ) : (
                  <BuyButton
                    kind="service"
                    id={sku.id}
                    label="购买"
                    loggedIn
                    variant="secondary"
                    size="sm"
                  />
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Disclaimer>
        人工服务提供的是专业意见和判断参考,不代替你本人的决策,也不代写文书、
        不代为递交申请。所有服务均不承诺任何录取结果。
        交付人接单前可全额退款,已接单未交付退 50%,已交付不退。
      </Disclaimer>
    </div>
  )
}
