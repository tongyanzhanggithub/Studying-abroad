import Link from 'next/link'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Disclaimer } from '@/components/ui'
import { RecommendationCard } from '@/components/RecommendationCard'
import { selectCard } from '@/lib/recommendation/engine'
import { formatCents, cn } from '@/lib/utils'
import { serviceDisplay } from '@/lib/service-display'
import { BuyButton } from '@/app/pricing/BuyButton'

/**
 * 增值服务市场(PRD 4.6)。
 *
 * 定位说明放在页面顶部 —— 这些服务是**可选**的,
 * 不买也能完整使用系统。这条信息必须说在前面。
 */

type ServicePath = 'all' | 'diy' | 'full'
type ServiceGroup = 'diy' | 'special' | 'full'
type ServiceSkuForPage = {
  id: string
  code: string
  name: string
  description: string | null
  priceCents: number
  delivererRole: string
  deliveryForm: string
  slaHours: number
}

const PATH_OPTIONS: Array<{
  value: ServicePath
  title: string
  subtitle: string
}> = [
  {
    value: 'all',
    title: '全部',
    subtitle: '还没确定路径时,先把单点服务和全程服务放在一起比较。',
  },
  {
    value: 'diy',
    title: '自己 DIY',
    subtitle: '自己推进申请,只在选校、文书、面试等关键节点请人把关。',
  },
  {
    value: 'full',
    title: '全程服务',
    subtitle: '主理老师持续跟进申请季,适合没时间盯节点或希望有人推进的人。',
  },
]

const SERVICE_META: Record<string, {
  group: ServiceGroup
  badge: string
  outcome: string
  fit: string
}> = {
  strategy_consult: {
    group: 'diy',
    badge: 'DIY 关键判断',
    outcome: '拿到一版可执行的冲刺 / 匹配 / 保底梯度',
    fit: '适合已经想自己申请,但不确定名单是否合理的人。',
  },
  essay_review: {
    group: 'diy',
    badge: 'DIY 文书把关',
    outcome: '明确这篇文书哪里能保留、哪里需要重写或补证据',
    fit: '适合自己写初稿,希望交前有人从招生官视角审一遍的人。',
  },
  mock_interview: {
    group: 'diy',
    badge: 'DIY 面试训练',
    outcome: '提前走一遍真实问答,拿到书面反馈和改进方向',
    fit: '适合已经拿到面试或目标项目常有面试的人。',
  },
  hard_case: {
    group: 'special',
    badge: '先诊断再选择',
    outcome: '判断是继续 DIY、补单点服务,还是更适合全程陪跑',
    fit: '适合低 GPA、跨专业、gap year、转地区或背景跨度较大的人。',
  },
  full_service: {
    group: 'full',
    badge: '全程陪跑',
    outcome: '从名单、材料、文书到截止日排期,由主理老师持续跟进',
    fit: '适合想少踩坑、少盯细节,希望申请季有人负责推进的人。',
  },
}

const GROUP_COPY: Record<ServiceGroup, {
  title: string
  body: string
}> = {
  diy: {
    title: 'DIY 按需加购',
    body: '自己递交,缺哪一环补哪一环。',
  },
  special: {
    title: '不确定路线',
    body: '背景复杂时先会诊,再决定 DIY 还是全程。',
  },
  full: {
    title: '全程服务',
    body: '主理老师持续跟进节点、材料和交付。',
  },
}

function readPath(value: string | undefined): ServicePath {
  if (value === 'diy' || value === 'full') return value
  return 'all'
}

function serviceGroup(sku: ServiceSkuForPage): ServiceGroup {
  return SERVICE_META[sku.code]?.group ?? 'diy'
}

function visibleGroups(path: ServicePath): ServiceGroup[] {
  if (path === 'diy') return ['diy', 'special']
  if (path === 'full') return ['full', 'special']
  return ['diy', 'special', 'full']
}

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ highlight?: string; path?: string }>
}) {
  const user = await requireUser()
  const { highlight, path: rawPath } = await searchParams
  const path = readPath(rawPath)

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
  const selectedPath = PATH_OPTIONS.find((option) => option.value === path) ?? PATH_OPTIONS[0]
  const activeGroups = visibleGroups(path)
  const grouped = activeGroups.map((group) => ({
    group,
    services: skus.filter((sku) => serviceGroup(sku) === group),
  })).filter((item) => item.services.length > 0)

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="border-b border-ink-200 pb-4 sm:pb-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-ink-900 sm:text-2xl">服务加购</h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-600 sm:text-sm">
              自己做就按需选老师,想省心就选全程主理老师。所有服务都是可选项,不影响你继续使用系统。
            </p>
          </div>
          <div className="grid w-full grid-cols-3 gap-1 rounded-full bg-white p-1 shadow-sm ring-1 ring-ink-100 sm:w-auto sm:flex sm:flex-wrap sm:gap-2 sm:bg-transparent sm:p-0 sm:shadow-none sm:ring-0">
            {PATH_OPTIONS.map((option) => {
              const selected = path === option.value
              return (
                <Link
                  key={option.value}
                  href={option.value === 'all' ? '/app/services' : `/app/services?path=${option.value}`}
                  className={cn(
                    'min-h-10 rounded-full px-2 py-2 text-center text-xs font-medium leading-5 transition-colors sm:min-h-0 sm:border sm:px-4 sm:text-sm',
                    selected
                      ? 'bg-brand-600 text-white sm:border-brand-500'
                      : 'text-ink-700 hover:bg-ink-50 sm:border-ink-200 sm:bg-white sm:text-ink-800 sm:hover:border-ink-300',
                  )}
                >
                  {option.title}
                </Link>
              )
            })}
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink-500 sm:mt-3 sm:text-sm">{selectedPath.subtitle}</p>
      </div>

      {recCard && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-900">系统建议</h2>
          <RecommendationCard card={recCard} />
        </section>
      )}

      <div className="space-y-4 sm:space-y-5">
        {grouped.map(({ group, services }) => {
          const copy = GROUP_COPY[group]
          return (
            <section key={group} className="space-y-2">
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-end sm:justify-between sm:gap-2">
                <h2 className="text-base font-semibold text-ink-900 sm:text-lg">{copy.title}</h2>
                <p className="text-xs leading-relaxed text-ink-500 sm:text-sm">{copy.body}</p>
              </div>
              <div className="space-y-2">
                {services.map((sku) => {
                  const display = serviceDisplay(sku)
                  const meta = SERVICE_META[sku.code]
                  const isFull = serviceGroup(sku) === 'full'
                  return (
                    <article
                      key={sku.id}
                      className={cn(
                        'rounded-xl border border-ink-200 bg-white p-3.5 sm:p-4',
                        highlight === sku.id && 'border-brand-500 ring-1 ring-brand-100',
                        isFull && 'bg-gradient-to-r from-brand-50 to-white',
                      )}
                    >
                      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center md:gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-medium leading-snug text-ink-900 sm:text-base">{display.name}</h3>
                            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-500">
                              {meta?.badge ?? '按需加购'}
                            </span>
                          </div>
                          <p className="mt-2 text-[13px] leading-relaxed text-ink-600 sm:text-sm">{display.description}</p>
                          <p className="mt-2 text-xs leading-relaxed text-ink-500">
                            <strong className="text-ink-800">适合:</strong> {meta?.fit ?? '适合需要人工判断的关键节点。'}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-ink-500">
                            <strong className="text-ink-800">结果:</strong> {meta?.outcome ?? '获得明确的修改建议和下一步动作。'}
                          </p>
                          <p className="mt-2 text-xs text-ink-400">
                            {display.delivererRole} · {display.deliveryForm} · {sku.slaHours} 小时内交付
                          </p>
                        </div>
                        <div className="grid grid-cols-[auto_minmax(7rem,1fr)] items-center gap-3 border-t border-ink-100 pt-3 md:block md:w-32 md:border-t-0 md:pt-0">
                          <p className="text-lg font-semibold text-ink-900 md:mb-2 md:text-right">
                            {formatCents(sku.priceCents)}
                          </p>
                          {purchased.has(sku.id) ? (
                            <p className="text-right text-xs text-ink-400">已购买</p>
                          ) : (
                            <BuyButton
                              kind="service"
                              id={sku.id}
                              label={isFull ? '选择全程' : '按需加购'}
                              loggedIn
                              variant={isFull ? 'primary' : 'secondary'}
                              size="sm"
                            />
                          )}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      <Disclaimer>
        DIY 单点服务适合补关键判断,全程服务适合由主理老师持续跟进。人工服务提供的是专业意见和判断参考,
        不代替你本人的决策,也不代写文书、不代为递交申请。所有服务均不承诺任何录取结果。
        交付人接单前可全额退款,已接单未交付退 50%,已交付不退。
      </Disclaimer>
    </div>
  )
}
