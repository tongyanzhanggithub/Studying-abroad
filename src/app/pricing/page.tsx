import Link from 'next/link'
import { db } from '@/lib/db'
import { Disclaimer } from '@/components/ui'
import { BrandLogo } from '@/components/BrandLogo'
import { formatCents } from '@/lib/utils'
import { serviceDisplay } from '@/lib/service-display'
import { track } from '@/lib/analytics'
import { getCurrentUser } from '@/lib/auth/session'
import { BuyButton } from './BuyButton'

/**
 * 定价页(PRD 3.1 `/pricing`)。
 *
 * ⚠️ 合规(PRD 10.5):季票属预收费,**退款规则必须在支付前页面明示**,
 *    不能只写在用户协议里。
 */

type PricingPlan = {
  id: string
  name: string
  priceCents: number
  features: unknown
}

type PricingSku = {
  id: string
  code: string
  name: string
  description: string | null
  priceCents: number
  delivererRole: string
  deliveryForm: string
  slaHours: number
}

type PricingUser = Awaited<ReturnType<typeof getCurrentUser>>

/**
 * ⚠️ 这里**刻意不提供兜底价格**。
 *
 * 曾经用一套写死的价目表兜底,但它和数据库里的真实 SKU 完全对不上
 * (名称、档位、金额都不同)。数据库抖一下,用户就会看到一套便宜一半的价格 ——
 * 而 PRD 10.5 要求价格与退款规则在付款前如实明示。
 *
 * 展示错价比展示不了价格严重得多:前者是价格承诺不一致,后者只是一次刷新。
 * 所以取不到数据时宁可显示「暂时取不到」并隐藏购买入口。
 */
const VALUE_POINTS = [
  {
    title: '先知道钱和时间该投向哪里',
    body: '把项目拆成冲刺、匹配、稳妥三档,再结合地区、语言、截止日和材料要求做取舍。',
  },
  {
    title: '少做重复劳动',
    body: '成绩单、CV、护照这类共用材料只维护一次,系统会告诉你它们分别覆盖哪些学校。',
  },
  {
    title: '关键节点有人盯',
    body: '从名单确定到材料递交,14/7/3/1 天节点自动提醒,把临门一脚的遗漏降到最低。',
  },
]

const REFUND_ROWS = [
  {
    title: '系统季票',
    body: '购买后 7 天内,且核心功能使用少于 3 次,可全额退款。超过 7 天或已多次使用,按剩余月份阶梯退款;剩余不足 1 个月不予退款。',
  },
  {
    title: '单点人工服务',
    body: '交付人接单前可全额退款;已接单但尚未交付退 50%;已交付后不予退款。',
  },
]

function featureItems(features: unknown) {
  return (features as { items?: string[] } | null)?.items ?? []
}

/** 价格取不到时的占位卡,风格与正常卡片一致,但不给任何数字和购买入口 */
function PriceUnavailable({ what }: { what: string }) {
  return (
    <article className="feed-card bg-white p-6">
      <h3 className="text-lg font-medium text-ink-900">{what}暂时显示不出来</h3>
      <p className="mt-3 text-sm leading-relaxed text-ink-600">
        我们没能取到最新价格。与其给你一个可能不准的数字,不如先不显示 ——
        价格是要收钱的承诺,不能猜。
      </p>
      <p className="mt-2 text-sm text-ink-600">请刷新页面重试。</p>
    </article>
  )
}

async function getPricingData(): Promise<{
  plans: PricingPlan[]
  skus: PricingSku[]
  user: PricingUser
  usingFallback: boolean
}> {
  try {
    const [plans, skus, user] = await Promise.all([
      db.plan.findMany({
        where: { active: true },
        orderBy: { sort: 'asc' },
        select: { id: true, name: true, priceCents: true, features: true },
      }),
      db.serviceSku.findMany({
        where: { active: true },
        orderBy: { sort: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          priceCents: true,
          delivererRole: true,
          deliveryForm: true,
          slaHours: true,
        },
      }),
      getCurrentUser(),
    ])

    return { plans, skus, user, usingFallback: false }
  } catch (error) {
    // 降级只保证页面不白屏,**不伪造价格**
    console.error('[pricing] 无法读取套餐/服务数据,页面将隐藏价格与购买入口', error)
    return { plans: [], skus: [], user: null, usingFallback: true }
  }
}

export default async function PricingPage() {
  const { plans, skus, user, usingFallback } = await getPricingData()

  await track('pricing_view', {
    userId: user?.id ?? null,
    properties: { usingFallback },
  })

  return (
    <main className="marketing-page min-h-screen bg-insta-surface text-ink-800">
      <header className="sticky top-0 z-30 border-b border-white/60 bg-white/75 shadow-[0_1px_28px_rgba(193,53,132,0.08)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <BrandLogo className="text-lg" />
          <nav className="-mr-2 flex items-center gap-1 text-sm text-ink-600 sm:gap-2">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center rounded-lg px-3 transition-colors hover:bg-white/80 hover:text-ink-900"
            >
              首页
            </Link>
            <Link
              href="/assess"
              className="insta-button ml-1 inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-white"
            >
              免费测一测
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-white/70 bg-white">
        <div className="absolute inset-x-0 top-0 h-28 bg-[linear-gradient(90deg,rgba(255,100,76,0.12),rgba(225,48,108,0.10),rgba(88,81,219,0.10))]" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1.04fr_0.96fr] lg:py-20">
          <div>
            <p className="gradient-text text-sm font-semibold">SEASON PASS</p>
            <h1 className="display-heading mt-4 max-w-3xl text-4xl font-semibold text-ink-900 sm:text-6xl">
              一张通行证,
              <br />
              把申请季管到递交前
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-600">
              比起动辄数万元的全包方案,Compass 把最反复、最容易漏的流程做成可执行系统:
              先测定位,再建名单,再跟材料、文书和截止日。需要专家判断时,再加购单点服务。
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a
                href="#plans"
                className="insta-button inline-flex justify-center rounded-full px-7 py-4 text-base font-medium text-white sm:py-3.5"
              >
                查看通行证
              </a>
              <Link
                href="/assess"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-ink-200 bg-white px-7 text-base font-medium text-ink-700 transition-colors hover:border-insta-pink hover:text-insta-pink sm:min-h-0"
              >
                先免费测一测
              </Link>
            </div>
          </div>

          <div className="grid content-start gap-3">
            {VALUE_POINTS.map((point, index) => (
              <article
                key={point.title}
                className="feed-card p-5 shadow-[0_18px_45px_rgba(16,24,40,0.06)]"
              >
                <span className="font-mono text-sm text-insta-pink">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h2 className="mt-2 text-lg font-medium text-ink-900">{point.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{point.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="plans" className="soft-section border-b border-white/70">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="max-w-2xl">
            <p className="gradient-text text-sm font-semibold">WHAT YOU GET</p>
            <h2 className="display-heading mt-2 text-2xl font-semibold text-ink-900 sm:text-3xl">
              核心流程一次解锁
            </h2>
            <p className="mt-3 text-ink-600">
              适合想自己掌握申请节奏,但不想靠表格、群消息和零散攻略硬扛的人。
            </p>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            {plans.length === 0 && <PriceUnavailable what="通行证价格" />}

            {plans.map((plan, index) => {
              const features = featureItems(plan.features)
              return (
                <article
                  key={plan.id}
                  className={
                    index === 0
                      ? 'feed-card border-insta-pink bg-white p-6 shadow-[0_18px_45px_rgba(225,48,108,0.14)]'
                      : 'feed-card bg-white p-6'
                  }
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-semibold text-ink-900">{plan.name}</h3>
                      <p className="mt-1 text-sm text-ink-500">从测评到递交前的申请管理系统</p>
                    </div>
                    {index === 0 && (
                      <span className="insta-gradient rounded-full px-2.5 py-0.5 text-xs text-white">
                        推荐
                      </span>
                    )}
                  </div>

                  <p className="mt-6 text-5xl font-semibold tracking-tight text-ink-900">
                    {formatCents(plan.priceCents)}
                    <span className="ml-1.5 text-sm font-normal text-ink-400">/ 申请季</span>
                  </p>

                  <ul className="mt-6 space-y-3 text-sm text-ink-600">
                    {features.map((feature) => (
                      <li key={feature} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-insta-pink" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-7">
                    <BuyButton
                      kind="plan"
                      id={plan.id}
                      label={`购买${plan.name}`}
                      loggedIn={!!user}
                    />
                  </div>
                </article>
              )
            })}

            <div className="feed-card bg-ink-900 p-6 text-white">
              <p className="text-sm font-semibold text-white/55">WHY THIS PRICE</p>
              <h3 className="mt-2 text-2xl font-semibold">把钱花在判断和推进上</h3>
              <p className="mt-4 text-sm leading-relaxed text-white/65">
                留学申请真正贵的不是表格,是试错成本。Compass 用系统先把高频流程跑顺,
                让你在需要人类经验的时候再请专家介入,而不是从第一天就被迫买一整套全包服务。
              </p>
              <div className="mt-7 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                {[
                  ['定位', '先判断学校档位和方向匹配度'],
                  ['执行', '材料、文书、截止日同步推进'],
                  ['加购', '名单精修、文书批改按需购买'],
                ].map(([title, body]) => (
                  <div key={title} className="border-t border-white/15 pt-3">
                    <p className="font-medium">{title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-white/55">{body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-white/70 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-16 lg:grid-cols-[0.86fr_1.14fr] sm:py-20">
          <div>
            <p className="gradient-text text-sm font-semibold">OPTIONAL SERVICES</p>
            <h2 className="display-heading mt-2 text-2xl font-semibold text-ink-900 sm:text-3xl">
              关键判断,再请人看
            </h2>
            <p className="mt-3 text-ink-600">
              人工服务是升级项,适合在选校取舍、文书表达和最终递交前补一层专业判断。
            </p>
          </div>

          <div className="space-y-3">
            {skus.length === 0 && <PriceUnavailable what="人工服务价格" />}

            {skus.map((sku) => {
              const display = serviceDisplay(sku)
              return (
                <article key={sku.id} className="feed-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-ink-900">{display.name}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-ink-600">
                        {display.description}
                      </p>
                      <p className="mt-2 text-xs text-ink-400">
                        {display.delivererRole} · {display.deliveryForm} · {sku.slaHours} 小时内交付
                      </p>
                    </div>
                    <p className="shrink-0 text-lg font-semibold text-ink-900">
                      {formatCents(sku.priceCents)}
                    </p>
                  </div>
                  <div className="mt-4 max-w-xs">
                    <BuyButton
                      kind="service"
                      id={sku.id}
                      label="加购这项服务"
                      loggedIn={!!user}
                      variant="secondary"
                      size="sm"
                    />
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <section className="soft-section border-b border-white/70">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="max-w-2xl">
            <p className="gradient-text text-sm font-semibold">REFUND POLICY</p>
            <h2 className="display-heading mt-2 text-2xl font-semibold text-ink-900 sm:text-3xl">
              退款规则写在付款前
            </h2>
            <p className="mt-3 text-ink-600">
              价格和边界提前说清楚,你再决定要不要继续。
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {REFUND_ROWS.map((row) => (
              <article key={row.title} className="feed-card p-5">
                <h3 className="font-medium text-ink-900">{row.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{row.body}</p>
              </article>
            ))}
          </div>

          <div className="mt-8">
            <Disclaimer>
              Compass 提供信息服务与软件工具,不代理申请、不承诺任何录取结果。
              人工服务提供的是专业意见,最终决策与递交由你本人完成。发票可在订单页申请开具。
            </Disclaimer>
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="mx-auto max-w-6xl px-5 py-20 text-center sm:py-24">
          <h2 className="display-heading text-3xl font-semibold text-ink-900 sm:text-4xl">
            先用 60 秒看清自己的申请地图
          </h2>
          <p className="mx-auto mt-4 max-w-md text-ink-600">
            测完再决定是否购买通行证,更容易判断它值不值得放进你的申请季。
          </p>
          <Link
            href="/assess"
            className="insta-button mt-8 inline-block rounded-full px-8 py-4 text-base font-medium text-white"
          >
            免费测一测
          </Link>
        </div>
      </section>
    </main>
  )
}
