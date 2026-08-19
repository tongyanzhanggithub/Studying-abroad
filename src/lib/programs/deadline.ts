import type { DeadlineAudience } from '@prisma/client'

/**
 * 选校卡片上的截止日文案。
 *
 * ⚠️ 倒计时只有在**这个日期确实适用于我们的用户**时才能说得这么肯定。
 *
 *    2026-08 的核查发现:英国院校普遍公布两个截止日(需签证 / 本地),
 *    库里一度存的是本地那一档 —— UCL 需签证申请人的通道其实已经关闭两个月,
 *    页面却显示「还有 13 天截止」。学生照着它赶材料、交申请费,然后被拒收。
 *    见 docs/数据核查-2026-08.md。
 *
 * 规则:
 *   overseas / all  → 正常倒计时(前者是需签证档,后者是官网不分档)
 *   home            → 对需要签证的中国学生无效,不给日期
 *   unspecified     → 存量数据没标口径,不知道取的是哪一档,同样不给倒计时
 *
 * 宁可少说,也不能把一个不适用的日期说成倒计时。
 */
export function deadlineText(
  days: number | null,
  hasDeadline: boolean,
  audience: DeadlineAudience,
): string {
  if (!hasDeadline || days === null) return '截止日待公布'

  if (audience === 'home') {
    // 官网只给了本地/无需签证档,对需要签证的中国学生无效
    return '本档次不适用,以官网为准'
  }
  if (audience === 'unspecified') {
    // 存量数据没标口径 —— 不知道取的是哪一档,不能拿它做倒计时
    return days < 0 ? '本轮已截止(口径待核)' : '截止日以官网为准'
  }

  if (days < 0) return '本轮已截止'
  if (days === 0) return '今天截止'
  return `还有 ${days} 天截止`
}

/**
 * 这个截止日能不能拿来对用户「做倒计时 / 催办 / 发提醒」。
 *
 * ⚠️ 这不是展示层的偏好,是**能不能这么说**的问题,所以必须集中在一处。
 *
 *    上面的 deadlineText 一开始只管住了院校库的卡片,而同一个日期在
 *    仪表盘、材料中心、行动计划、每日提醒里各自用 daysUntil 直接算 ——
 *    于是院校库老老实实写「截止日以官网为准」,仪表盘却在同一个项目上
 *    写「12 天后截止」,定时任务还会主动推一条「还有 3 天」给学生。
 *
 *    2026-08-19 线上实测:87 个未来截止日里,67 个(77%)是 unspecified,
 *    也就是说四分之三的倒计时都建立在一个没人核过档次的日期上。
 *
 * 用 audience 而不是「有没有日期」做闸门:日期一直都在,能不能拿它说话
 * 取决于它是哪一档。见本文件顶部 UCL 的例子。
 */
export function isCountdownable(audience: DeadlineAudience): boolean {
  return audience === 'overseas' || audience === 'all'
}

/**
 * 取「可以对用户明说」的截止日,口径不明或不适用的一律当作没有。
 *
 * 各处算天数时用它替换裸的 program.finalDeadline —— 这样闸门只有一处,
 * 不会再出现某个页面忘了加而单独漏出去。
 *
 * ⚠️ 返回 null 的语义是「不能拿它对用户下判断」,不是「没有截止日」。
 *    需要展示原始日期(如后台核对)的地方仍应直接读 finalDeadline。
 */
export function countdownDeadline<T extends Date | string | null | undefined>(
  finalDeadline: T,
  audience: DeadlineAudience,
): T | null {
  // 入参类型对齐 utils 的 daysUntil —— 各处存的可能是 Date,也可能是序列化后的字符串
  return finalDeadline != null && isCountdownable(audience) ? finalDeadline : null
}

/** 提醒类定时任务的取数条件 —— 和 isCountdownable 同一套口径 */
export const COUNTDOWNABLE_AUDIENCES = ['overseas', 'all'] as const satisfies readonly DeadlineAudience[]
