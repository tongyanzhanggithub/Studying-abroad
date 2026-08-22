import 'server-only'
import { db } from '@/lib/db'
import { track } from '@/lib/analytics'
import { renderTemplate, daysUntil, formatDate } from '@/lib/utils'
import { COUNTDOWNABLE_AUDIENCES } from '@/lib/programs/deadline'
import { SUBMITTED_OR_LATER } from '@/lib/programs/types'
import type { NotificationChannel } from '@prisma/client'

/**
 * 通知系统(PRD 4.9 / 5.4)。
 *
 * 优先级:微信服务通知 > 短信(仅截止 3 天内)> 邮件(周报)
 *
 * ⚠️ 幂等:用 dedupeKey 保证同一提醒不会重复下发 —— 用户收到两条
 *    「还有 3 天截止」比收不到更伤信任。
 *
 * ⚠️ 可用性(PRD 8):截止提醒任务必须有失败重试与人工兜底告警。
 *    任一提醒任务失败 → 立即人工电话兜底(PRD 11.3)。
 */

/**
 * 实际投递。渠道未接入时保持 pending,由后台可见,不静默丢弃。
 *
 * ⚠️ 这里**不写库**:create 时 status 默认就是 pending,原来还多发一条
 *    「把 pending 写成 pending」的 UPDATE —— 每条通知白写一次盘,批量推送时
 *    写 IOPS 直接翻倍。接入真实渠道后,在这里根据投递结果再更新状态。
 */
async function deliver(notificationId: string, channel: NotificationChannel) {
  // TODO: 接入微信小程序订阅消息 / 阿里云短信 / 邮件服务
  // 渠道全部依赖企业资质,资质到位前保持 pending 状态,
  // 运营可在后台看到「待发送」队列并人工兜底。
  void notificationId
  void channel
}

type NotificationTemplateRow = Awaited<
  ReturnType<typeof db.notificationTemplate.findUnique>
>

/**
 * 批量推送前一次性取好模板,避免在循环里逐个用户重复查同一条模板。
 *
 * ⚠️ 不做跨请求的长缓存:模板是运营在后台可改的,缓存久了会发出旧文案。
 *    这里只在**一次批量任务内**复用,拿到的就是本次任务开始时的版本。
 */
async function loadTemplates(codes: string[]): Promise<Map<string, NotificationTemplateRow>> {
  const rows = await db.notificationTemplate.findMany({
    where: { code: { in: [...new Set(codes)] } },
  })
  return new Map(rows.map((r) => [r.code, r]))
}

async function createNotification(params: {
  userId: string
  templateCode: string
  payload: Record<string, string | number>
  dedupeKey: string
  /** 已预取的模板(批量场景传入,避免循环内重复查库) */
  template?: NotificationTemplateRow
}) {
  const template =
    params.template ??
    (await db.notificationTemplate.findUnique({ where: { code: params.templateCode } }))
  if (!template || !template.active) return null

  /**
   * 幂等:原来是「先 findUnique 判存在,再 create」两步,并发/多实例下两条都能过
   * 检查、一条 create 撞 dedupeKey 唯一约束抛 P2002。直接 create,靠数据库的唯一约束
   * 兜底,撞了就当已存在跳过(返回 null)—— 一步到位,无竞态。
   */
  let notification
  try {
    notification = await db.notification.create({
      data: {
        userId: params.userId,
        templateId: template.id,
        channel: template.channel,
        payload: {
          ...params.payload,
          title: template.title,
          body: renderTemplate(template.bodyTpl, params.payload),
        },
        dedupeKey: params.dedupeKey,
      },
    })
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return null // 已存在,跳过
    throw err
  }

  await deliver(notification.id, template.channel)
  // ⚠️ 埋点名是 created 不是 sent:deliver() 目前是桩(渠道未接入),通知只落库为 pending、
  //    并没有真正发出去。打成 notification_sent 会让指标把「待发送」记成「已发送」而失真。
  await track('notification_created', {
    userId: params.userId,
    properties: { template: params.templateCode, channel: template.channel },
  })

  return notification
}

/**
 * 数据变更 → 用户触达(PRD 5.4,P0 必须实现)。
 *
 * 找出选校单里包含该项目的所有用户并推送。
 * 数据变更可以人工录入,但推送必须自动 —— 这是「实时数据」承诺的兑现。
 */
export async function notifyProgramChange(changeLogId: string): Promise<number> {
  const log = await db.programChangeLog.findUnique({
    where: { id: changeLogId },
    include: { program: { include: { school: true } } },
  })
  if (!log) return 0

  const affected = await db.userSchoolChoice.findMany({
    where: { programId: log.programId },
    select: { userId: true },
    distinct: ['userId'],
  })

  // 循环外取一次模板 —— 同一批推送的都是 program_changed,不必每个用户查一遍
  const tplMap = await loadTemplates(['program_changed'])
  const tpl = tplMap.get('program_changed')

  let sent = 0
  for (const { userId } of affected) {
    // 单个用户推送失败不该中断整批(与 runDeadlineReminders 一致),
    // 否则一次唯一冲突/异常就让后面的人都收不到,且 notifiedAt 也更新不了
    try {
      const n = await createNotification({
        template: tpl,
        userId,
        templateCode: 'program_changed',
        payload: {
          school: log.program.school.nameZh ?? log.program.school.nameEn,
          program: log.program.nameZh ?? log.program.nameEn,
          field: log.field,
          summary: log.summary,
        },
        dedupeKey: `change:${changeLogId}:${userId}`,
      })
      if (n) sent += 1
    } catch (err) {
      console.error(`[通知] 数据变更推送失败 user=${userId} change=${changeLogId}:`, err)
    }
  }

  await db.programChangeLog.update({
    where: { id: changeLogId },
    data: { notifiedAt: new Date() },
  })

  return sent
}

/**
 * 服务订单状态变化 → 通知学生。
 *
 * 学生付了钱之后,交付全过程发生在系统之外(视频会议、批注文档)。
 * 不通知的话,他从付款到收到东西之间是完全黑的 —— 这段沉默正是
 * 「是不是被坑了」的来源,也是客服问得最多的问题。
 *
 * dedupeKey 带上状态,保证同一单同一状态只发一次(改派会重发,这是对的:
 * 换人了学生该知道)。
 */
export async function notifyServiceOrder(
  orderId: string,
  templateCode: 'service_assigned' | 'service_delivered',
): Promise<boolean> {
  const order = await db.serviceOrder.findUnique({
    where: { id: orderId },
    include: { sku: true, deliverer: true },
  })
  if (!order) return false

  /**
   * ⚠️ 学生注销后 userId 被解绑为 null(订单本身要留着给交付人对账,
   *    见 schema 里 ServiceOrder 的注释)。这时**没有人可通知** ——
   *    直接返回,不要试着往 null 上发。
   *
   *    这不是异常路径:注销之后运营仍然可能在后台推进这张订单的状态
   *    (为了把交付人的分成结掉),每次状态变更都会走到这里。
   */
  if (!order.userId) return false

  const n = await createNotification({
    userId: order.userId,
    templateCode,
    payload: {
      service: order.sku.name,
      deliverer: order.deliverer?.name ?? '待分配',
      role: order.deliverer?.role ?? '',
      sla: order.sku.slaHours,
      note: order.deliveryNote ?? '',
    },
    /**
     * ⚠️ 必须带上 deliveredAt。
     *
     *    原来 key 是 `service:{orderId}:{templateCode}:{delivererId}`。走
     *    「异议 → 退回重做 → 顾问重新提交交付」时,这三段**一个都没变** ——
     *    第二次的 service_delivered 通知撞唯一约束被静默跳过(createNotification 返回 null)。
     *    结果:学生对第二次交付一无所知,而 48 小时自动确认的时钟已经重新开始走。
     *    沉默 + 自动确认 = 投诉。
     *
     *    加上这一次的交付时间戳,重新交付就是一条新通知;同一次交付重复调用仍然去重。
     */
    dedupeKey: `service:${orderId}:${templateCode}:${order.delivererId ?? 'none'}:${
      order.deliveredAt?.getTime() ?? 0
    }`,
  })
  return n !== null
}

/**
 * 截止日期提醒(PRD 4.4:截止前 14/7/3/1 天且清单未完成 → 推送)。
 *
 * 由定时任务每日调用一次。
 */
export const DEADLINE_THRESHOLDS = [
  { days: 14, code: 'deadline_14d' },
  { days: 7, code: 'deadline_7d' },
  { days: 3, code: 'deadline_3d' },
  { days: 1, code: 'deadline_1d' },
] as const

/**
 * 把「还剩 N 天」翻译成可以直接丢进 SQL 的时间区间。
 *
 * 每个阈值对应**本地时区**的一整天:[今天零点 + N 天, 再往后一天)。
 * 半开区间,不会漏也不会重。
 *
 * ⚠️ 必须和 utils 里的 daysUntil 用同一套口径(都按本地零点截断),
 *    否则会出现「SQL 捞出来了,JS 里又算成不是这一档」而一条都发不出去。
 *    本地时区由部署侧的 TZ=Asia/Shanghai 钉死(见 deploy/compass.service)。
 *
 * 导出仅为可测 —— 这是整个提醒链路的取数条件,算错等于集体收不到提醒。
 */
export function deadlineWindows(
  now: Date,
  thresholds: readonly number[],
): Array<{ gte: Date; lt: Date }> {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)

  return thresholds.map((d) => {
    const gte = new Date(startOfToday)
    gte.setDate(gte.getDate() + d)
    const lt = new Date(gte)
    lt.setDate(lt.getDate() + 1)
    return { gte, lt }
  })
}

export async function runDeadlineReminders(): Promise<{ sent: number; errors: string[] }> {
  const THRESHOLDS = DEADLINE_THRESHOLDS

  const errors: string[] = []
  let sent = 0

  // 4 个阈值模板循环外一次取完 —— 否则每命中一条选校记录就查一次模板
  const tplMap = await loadTemplates(THRESHOLDS.map((t) => t.code))

  /**
   * ⚠️ 日期筛选必须下推到数据库。
   *
   *    原来的 where 只有 `finalDeadline: { not: null }` —— 也就是把**全库所有人的
   *    所有选校记录**拉出来,再在 JS 里 `THRESHOLDS.find(t => t.days === left)`
   *    筛掉 99% 以上(命中率只有 4/365)。而且 include 是全字段的 Program,
   *    带着 requirements / deadlines 两个 Json blob 和 sourceUrls 数组 ——
   *    恰好是这张表最重的三个字段,一个都用不上。
   *
   *    这是**失败后果最严重**的那个定时任务(没跑 = 学生错过申请),
   *    却跑在 --max-old-space-size=1024 的堆上,用户越多越危险。
   *
   *    改成按 4 个日期区间查,顺带让 @@index([finalDeadline]) 真正派上用场;
   *    include 换成 select,只取渲染文案要用的那几个字段。
   */
  const windows = deadlineWindows(new Date(), THRESHOLDS.map((t) => t.days))

  const choices = await db.userSchoolChoice.findMany({
    where: {
      /**
       * ⚠️ 用共享名单,不要在这里手写。
       *    原来手写的是 ['submitted','admitted','rejected','waitlisted'] ——
       *    **漏了 interview_invited**,于是已经递交、并且拿到面试邀请的学生
       *    仍然会收到「请尽快递交」的 mandatory 短信。见 SUBMITTED_OR_LATER。
       */
      status: { notIn: [...SUBMITTED_OR_LATER] },
      program: {
        OR: windows.map((w) => ({ finalDeadline: w })),
        /**
         * ⚠️ 只提醒**档次核过、确实适用于我们用户**的截止日。
         *
         *    这是整条链路里唯一会**主动推给学生**的地方 —— 页面写错了他可能
         *    看一眼就过去,推送写错了他会照着它熬夜赶材料、交申请费。
         *    而 UCL 那种情况(需签证通道 6 月就关了,库里存的是 8 月的本地档)
         *    推出去就是「还有 3 天截止」,学生赶完发现根本递不进去。
         *
         *    下推到 SQL 而不是在下面的循环里 continue:这个任务本来就是为了
         *    别把全库选校记录拉进内存才改成按区间查的,不该再把过滤挪回 JS。
         */
        deadlineAudience: { in: [...COUNTDOWNABLE_AUDIENCES] },
      },
    },
    select: {
      id: true,
      userId: true,
      programId: true,
      program: {
        select: {
          nameZh: true,
          nameEn: true,
          finalDeadline: true,
          school: { select: { nameZh: true, nameEn: true } },
        },
      },
    },
  })

  for (const choice of choices) {
    const left = daysUntil(choice.program.finalDeadline)
    if (left === null) continue

    /**
     * SQL 已经把范围收到这 4 天了,这一步只是**把行映射到对应的模板**。
     * 保留 continue 作为兜底:时区/边界万一有偏差,宁可少发一条,
     * 也不能发一条「还有 5 天」却套用 3 天模板的提醒。
     */
    const threshold = THRESHOLDS.find((t) => t.days === left)
    if (!threshold) continue

    try {
      const pending = await db.userMaterial.count({
        where: {
          userId: choice.userId,
          programIds: { has: choice.programId },
          status: { not: 'completed' },
        },
      })

      const n = await createNotification({
        template: tplMap.get(threshold.code),
        userId: choice.userId,
        templateCode: threshold.code,
        payload: {
          school: choice.program.school.nameZh ?? choice.program.school.nameEn,
          program: choice.program.nameZh ?? choice.program.nameEn,
          date: formatDate(choice.program.finalDeadline),
          pending,
        },
        dedupeKey: `deadline:${threshold.code}:${choice.id}`,
      })
      if (n) sent += 1
    } catch (err) {
      // ⚠️ 单条失败不能中断整批 —— 但必须记录并告警,由人工兜底
      errors.push(`用户 ${choice.userId} / 项目 ${choice.programId}:${(err as Error).message}`)
    }
  }

  if (errors.length) {
    console.error('[通知] 截止提醒存在失败项,需人工兜底:', errors)
  }

  return { sent, errors }
}
