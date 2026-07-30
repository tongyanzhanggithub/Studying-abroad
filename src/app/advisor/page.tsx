import { db } from '@/lib/db'
import { requireAdvisor } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { formatCents, formatDate } from '@/lib/utils'
import { ORDER_STATUS_LABEL } from '@/lib/services/dispatch'
import { OrderActions } from './OrderActions'

/**
 * 顾问工作台:只看派给自己的单。
 *
 * ⚠️ 学生信息只给交付必需的那部分。顾问看得到背景(为了做咨询),
 *    但看不到手机号 —— 联系走企业微信,平台不做私下联系的桥。
 *    这既是隐私要求(PRD 10.3:学生数据只有本人和被授权顾问可见),
 *    也是业务要求:顾问拿到手机号就能绕过平台私单。
 */
/**
 * ⚠️ 必须含 `delivered`。
 *    原来只有 assigned/delivering/disputed,而「已交付待验收」通常要挂 48 小时 ——
 *    顾问提交交付之后,卡片立刻从「进行中」消失,又不在「已完成」里(那只查
 *    confirmed),他看到的是「待交付 0 单、累计完成 0 单」,无法确认自己交付成功了。
 */
const ACTIVE = ['assigned', 'delivering', 'delivered', 'disputed'] as const

export default async function AdvisorPage() {
  const session = await requireAdvisor()

  if (!session.delivererId) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <p className="text-sm leading-relaxed text-amber-900">
          你的账号还没有关联交付人档案,所以看不到任何订单。
          请让管理员在后台「账号」页里把这个账号关联到对应的交付人。
        </p>
      </Card>
    )
  }

  const [active, done, deliverer] = await Promise.all([
    db.serviceOrder.findMany({
      where: { delivererId: session.delivererId, status: { in: [...ACTIVE] } },
      include: {
        sku: true,
        user: { include: { profile: true } },
      },
      orderBy: { assignedAt: 'asc' },
    }),
    db.serviceOrder.findMany({
      where: { delivererId: session.delivererId, status: 'confirmed' },
      include: { sku: true },
      orderBy: { confirmedAt: 'desc' },
      // ⚠️ 不能 take:20 —— 这份数据要用来算「待结算金额」,截断了钱就是错的。
      //    做满 20 单之后顾问看到的收入会凭空少一截。列表展示另行截断。
    }),
    db.deliverer.findUnique({ where: { id: session.delivererId } }),
  ])

  const now = Date.now()

  /**
   * 顾问最关心的是「这个月我能拿多少」,但已结算的部分是锁定的。
   *
   * ⚠️ splitRatio 为 null 时要回退到交付人档案上的当前比例 —— 与
   *    lib/services/settlement.ts 的口径保持一致。原来直接 `?? 0`,
   *    导致派单时没快照比例的单在顾问端显示 0 元,而结算时又按档案比例发钱,
   *    同一笔单两个数字,顾问一定会来问。
   */
  const ratioOf = (o: { splitRatio: number | null }) =>
    o.splitRatio ?? deliverer?.splitRatio ?? 0
  const pendingPayout = done
    .filter((o) => !o.settlementMonth)
    .reduce((sum, o) => sum + Math.round(o.amountCents * ratioOf(o)), 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">我的订单</h1>
        <p className="mt-1 text-sm text-ink-600">
          待交付 {active.length} 单 · 累计完成 {done.length} 单
          {pendingPayout > 0 && ` · 待结算 ${formatCents(pendingPayout)}`}
        </p>
      </div>

      {active.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-600">
            现在没有派给你的单。有新单时运营会在群里通知你,也可以随时回来刷新看看。
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {active.map((o) => {
            const deadline = o.paidAt ? o.paidAt.getTime() + o.sku.slaHours * 3600_000 : null
            const overdue = deadline !== null && now > deadline && !o.deliveredAt
            // 学生注销后 user 解绑为 null;背景信息随之消失,但订单要留着结算
            const p = o.user?.profile ?? null

            return (
              <Card key={o.id} className={overdue ? 'border-red-200' : undefined}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink-900">{o.sku.name}</span>
                      <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">
                        {ORDER_STATUS_LABEL[o.status]}
                      </span>
                      {overdue && (
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">
                          已超承诺时限
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-xs text-ink-400">
                      派单于 {o.assignedAt ? formatDate(o.assignedAt) : '—'}
                      {deadline && ` · 承诺 ${formatDate(new Date(deadline))} 前交付`}
                      {ratioOf(o) > 0 &&
                        ` · 你的分成 ${formatCents(Math.round(o.amountCents * ratioOf(o)))}`}
                    </p>

                    {/* 交付必需的学生背景 */}
                    <div className="mt-2 rounded-lg bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-700">
                      <p className="font-medium text-ink-800">学生背景</p>
                      {p ? (
                        <p className="mt-0.5">
                          {[
                            p.undergradTier && `本科 ${p.undergradTier}`,
                            p.undergradMajor,
                            p.gpa != null && `均分 ${p.gpa}`,
                            p.languageType && p.languageScore != null
                              ? `${p.languageType} ${p.languageScore}`
                              : '语言未填',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-ink-500">学生还没填背景资料。</p>
                      )}
                      {o.assignNote && (
                        <p className="mt-1.5 text-ink-600">运营备注:{o.assignNote}</p>
                      )}
                    </div>

                    {o.status === 'disputed' && o.disputeReason && (
                      <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs leading-relaxed text-amber-900">
                        学生提出异议:{o.disputeReason}
                        <br />
                        运营会先跟你和学生沟通,在这之前不用重复交付。
                      </p>
                    )}

                    {/*
                      异议被判「退回重做」后,订单会变回 delivering ——
                      顾问原本只看到状态突然变了,不知道要改什么。
                      把运营的处理结论显示出来。
                    */}
                    {o.status !== 'disputed' && o.disputeResolution && (
                      <p className="mt-2 rounded bg-ink-50 px-2 py-1.5 text-xs leading-relaxed text-ink-700">
                        运营处理结论:{o.disputeResolution}
                      </p>
                    )}

                    {o.status === 'delivered' && (
                      <p className="mt-2 rounded bg-green-50 px-2 py-1.5 text-xs leading-relaxed text-green-800">
                        已提交交付,等学生验收。48 小时内学生没有异议会自动确认,之后进入月结。
                      </p>
                    )}
                  </div>

                  <div className="w-full shrink-0 sm:w-64">
                    <OrderActions orderId={o.id} status={o.status} />
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Card className="bg-ink-50">
        <p className="text-xs leading-relaxed text-ink-600">
          <strong>联系学生走企业微信</strong>,运营会把你们拉进同一个群。
          这里不显示学生手机号 —— 既是隐私要求,也是为了让沟通留痕,
          之后出现分歧时双方都有据可查。
          {deliverer?.splitRatio != null && (
            <>
              <br />
              你的分成比例是 {Math.round(deliverer.splitRatio * 100)}%,
              按订单派单时锁定,之后调整不影响已接的单。月结在次月进行。
            </>
          )}
        </p>
      </Card>

      {done.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-medium text-ink-900">最近完成</h2>
          <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
            {done.slice(0, 20).map((o, i) => (
              <div
                key={o.id}
                className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm ${
                  i > 0 ? 'border-t border-ink-100' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-ink-700">{o.sku.name}</span>
                <span className="shrink-0 text-xs text-ink-400">
                  {o.confirmedAt && formatDate(o.confirmedAt)}
                </span>
                <span className="shrink-0 text-xs text-ink-600">
                  {formatCents(Math.round(o.amountCents * ratioOf(o)))}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                    o.settlementMonth
                      ? 'bg-green-50 text-green-800'
                      : 'bg-ink-100 text-ink-600'
                  }`}
                >
                  {o.settlementMonth ? `已结算 ${o.settlementMonth}` : '待结算'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
