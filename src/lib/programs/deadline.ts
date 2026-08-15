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
