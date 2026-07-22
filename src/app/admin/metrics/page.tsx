import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { countDistinctUsers, countEvents } from '@/lib/analytics'
import { formatCents } from '@/lib/utils'
import { VERIFY_STALE_DAYS } from '@/lib/programs/types'

/**
 * 核心数据看板(PRD 11)。
 * 漏斗按周看,并对 11.3 的三条健康度红线做显式告警。
 */

function Stat({
  label,
  value,
  sub,
  alert,
}: {
  label: string
  value: string
  sub?: string
  alert?: boolean
}) {
  return (
    <Card className={alert ? 'border-red-200 bg-red-50' : undefined}>
      <p className="text-xs text-ink-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${alert ? 'text-red-800' : 'text-ink-900'}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-ink-400">{sub}</p>}
    </Card>
  )
}

export default async function AdminMetricsPage() {
  await requireAdmin('operator')

  const since = new Date(Date.now() - 7 * 86_400_000)
  const staleBefore = new Date(Date.now() - VERIFY_STALE_DAYS * 86_400_000)

  const [
    assessStart, assessComplete, pricingView, paySuccess,
    onboardingComplete, servicePaySuccess,
    shareClicked, referralOpened, referralConverted,
    recShown, recClicked,
    activeSubs, serviceOrders, totalPrograms, unverifiedPrograms,
    failedNotifications,
    pendingNotifications,
    pendingDeadlineNotifications,
  ] = await Promise.all([
    countEvents('assess_start', since),
    countEvents('assess_complete', since),
    countEvents('pricing_view', since),
    countEvents('pay_success', since),
    countDistinctUsers('onboarding_complete', since),
    countEvents('service_pay_success', since),
    countEvents('assess_share', since),
    countEvents('referral_link_opened', since),
    countEvents('assess_share_converted', since),
    countEvents('rec_card_shown', since),
    countEvents('rec_card_clicked', since),
    db.subscription.count({ where: { status: 'active' } }),
    db.serviceOrder.findMany({
      where: { status: { in: ['paid', 'assigned', 'delivering', 'delivered', 'confirmed'] } },
      select: { amountCents: true, userId: true },
    }),
    db.program.count(),
    db.program.count({
      where: {
        OR: [
          { confidence: { in: ['ai_collected', 'unknown'] } },
          { confidence: 'verified', lastVerifiedAt: { lt: staleBefore } },
        ],
      },
    }),
    db.notification.count({ where: { status: 'failed' } }),
    /**
     * ⚠️ 只盯 failed 是不够的,而且相当危险。
     *
     * 渠道(微信订阅消息 / 短信 / 邮件)全都还没接,`deliver()` 把每一条通知
     * 都写成 pending 就结束了 —— **永远不会有 failed**。
     * 于是看板一直显示「0 条失败」,而实际是 100% 没送达。
     * 一个永远绿的告警比没有告警更危险:它让人以为这条线是通的。
     *
     * 所以必须同时盯积压量。
     */
    db.notification.count({ where: { status: 'pending' } }),
    db.notification.count({
      where: {
        status: 'pending',
        // 截止提醒是 PRD 里的强制项,积压在这里等于用户要错过申请
        template: { code: { startsWith: 'deadline_' } },
      },
    }),
  ])

  const assessRate = assessStart ? Math.round((assessComplete / assessStart) * 100) : 0
  const payRate = assessComplete ? Math.round((paySuccess / assessComplete) * 100) : 0
  const buyerIds = new Set(serviceOrders.map((o) => o.userId))
  const attachRate = activeSubs ? Math.round((buyerIds.size / activeSubs) * 100) : 0
  const recCtr = recShown ? Math.round((recClicked / recShown) * 1000) / 10 : 0
  const staleRate = totalPrograms ? Math.round((unverifiedPrograms / totalPrograms) * 100) : 0

  const subRevenue = await db.payment.aggregate({
    where: { status: 'succeeded' },
    _sum: { amountCents: true },
  })
  const totalRevenue = subRevenue._sum.amountCents ?? 0
  const arpu = activeSubs ? Math.round(totalRevenue / activeSubs) : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">数据看板</h1>
        <p className="mt-1 text-sm text-ink-600">近 7 天</p>
      </div>

      {/* PRD 11.3 健康度红线 */}
      <div className="space-y-2">
        {staleRate > 10 && (
          <Card className="border-red-200 bg-red-50">
            <p className="text-sm text-red-900">
              <strong>红线:</strong>未核对/超期数据占 {staleRate}%(阈值 10%)。
              按 PRD 应<strong>暂停投放</strong>,先补数据。
            </p>
          </Card>
        )}
        {recShown > 100 && recCtr < 2 && (
          <Card className="border-red-200 bg-red-50">
            <p className="text-sm text-red-900">
              <strong>红线:</strong>推荐卡点击率 {recCtr}%(阈值 2%)。
              说明卡片对用户是骚扰而非帮助,应重做文案或收紧触发条件。
            </p>
          </Card>
        )}
        {failedNotifications > 0 && (
          <Card className="border-red-200 bg-red-50">
            <p className="text-sm text-red-900">
              <strong>红线:</strong>有 {failedNotifications} 条通知发送失败。
              若涉及截止日提醒,需<strong>立即人工电话兜底</strong>。
            </p>
          </Card>
        )}
        {pendingNotifications > 0 && (
          <Card className="border-red-200 bg-red-50">
            <p className="text-sm leading-relaxed text-red-900">
              <strong>红线:</strong>有 <strong>{pendingNotifications}</strong> 条通知堆在待发送队列里没有送出去
              {pendingDeadlineNotifications > 0 && (
                <>,其中 <strong>{pendingDeadlineNotifications}</strong> 条是截止日期提醒</>
              )}
              。微信/短信渠道还没接入,这些通知<strong>用户一条都收不到</strong> ——
              截止提醒积压意味着有人会错过申请。
              <Link href="/admin/notifications" className="ml-1 underline">
                去队列里人工兜底 →
              </Link>
            </p>
          </Card>
        )}
      </div>

      <section>
        <h2 className="mb-3 font-medium text-ink-900">获客漏斗</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="评估开始" value={String(assessStart)} />
          <Stat label="评估完成率" value={`${assessRate}%`} sub="目标 >60%" alert={assessStart > 50 && assessRate < 60} />
          <Stat label="定价页浏览" value={String(pricingView)} />
          <Stat label="付费转化率" value={`${payRate}%`} sub="目标 5-8%" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-medium text-ink-900">激活与变现</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="完成 onboarding" value={String(onboardingComplete)} sub="目标 7 日内 >80%" />
          <Stat
            label="加购率(北极星)"
            value={`${attachRate}%`}
            sub="目标 25-40%"
            alert={activeSubs > 20 && attachRate < 25}
          />
          <Stat label="混合客单价" value={formatCents(arpu)} sub="目标 ¥5,000+" />
          <Stat label="服务成交" value={String(servicePaySuccess)} sub="近 7 天" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-medium text-ink-900">分享裂变</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="分享动作" value={String(shareClicked)} />
          <Stat label="分享链接被打开" value={String(referralOpened)} />
          <Stat label="裂变带来的评估" value={String(referralConverted)} />
          <Stat
            label="分享转化率"
            value={referralOpened ? `${Math.round((referralConverted / referralOpened) * 100)}%` : '—'}
            sub="打开 → 完成评估"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-medium text-ink-900">推荐引擎</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="卡片曝光" value={String(recShown)} />
          <Stat label="卡片点击" value={String(recClicked)} />
          <Stat label="点击率" value={`${recCtr}%`} sub="红线 <2%" alert={recShown > 100 && recCtr < 2} />
          <Stat label="生效季票" value={String(activeSubs)} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-medium text-ink-900">数据健康度</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="院校项目总数" value={String(totalPrograms)} />
          <Stat
            label="未核对 / 超期"
            value={`${unverifiedPrograms}(${staleRate}%)`}
            sub="红线 >10%"
            alert={staleRate > 10}
          />
        </div>
      </section>
    </div>
  )
}
