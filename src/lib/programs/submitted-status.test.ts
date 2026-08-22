import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SUBMITTED_OR_LATER, isSubmittedOrLater } from '@/lib/programs/types'
import { codeOnly } from '@/lib/source-scan'

/**
 * 「这份申请已经递交出去了」的状态名单。
 *
 * ── 为什么它值得一组专门的测试 ────────────────────────
 *
 * 这份名单原来在四个地方各写了一遍,**其中两处漏了 interview_invited**:
 *
 *   仪表盘「已递交」计数     5 个,齐
 *   planner 已过截止判定     5 个,齐
 *   planner 滚动录取提示     3 个,漏 interview_invited / waitlisted
 *   每日截止提醒的 SQL       4 个,漏 interview_invited
 *
 * 最后那处**会发短信**。deadline_3d 是 mandatory 短信,文案是
 * 「【Compass】{school} 申请将于 {date} 截止,请尽快递交。」——
 * 一个已经递交、并且拿到面试邀请的学生会收到它。
 *
 * 2026-08-19 本地实测:给同一批项目的四条选校记录分别置成
 * submitted / interview_invited / admitted / waitlisted,跑一次
 * runDeadlineReminders —— 只有 interview_invited 那条真的发了出去。
 *
 * interview_invited 在 ApplicationStatus 枚举里排在 submitted **之后**,
 * 含义是「已经交了,而且学校约了面试」。漏掉它不是口径之争,是写错了。
 */

describe('SUBMITTED_OR_LATER 名单本身', () => {
  it('五个状态一个都不能少', () => {
    expect([...SUBMITTED_OR_LATER].sort()).toEqual([
      'admitted',
      'interview_invited',
      'rejected',
      'submitted',
      'waitlisted',
    ])
  })

  /**
   * ⚠️ 这一条是整组的核心。它被漏掉过两次,而且两次都是同一个原因:
   *    名字看起来像「还在流程中」,其实排在 submitted 后面。
   */
  it('interview_invited 算「已递交」—— 它排在 submitted 之后', () => {
    expect(isSubmittedOrLater('interview_invited')).toBe(true)
  })

  it.each(['submitted', 'admitted', 'rejected', 'waitlisted'])('%s 算已递交', (s) => {
    expect(isSubmittedOrLater(s)).toBe(true)
  })

  it.each(['not_started', 'preparing_materials', 'writing_essay', 'ready_to_submit'])(
    '%s 不算已递交',
    (s) => {
      expect(isSubmittedOrLater(s)).toBe(false)
    },
  )

  it('不认识的状态一律当作「还没递交」—— 宁可多提醒,不要漏提醒', () => {
    expect(isSubmittedOrLater('some_future_status')).toBe(false)
  })
})

/**
 * ⚠️ 源码守卫:这份名单只能有一处。
 *
 *    四个调用点里有两个漂移过,靠 review 显然没拦住 ——
 *    只要还允许在别处手写 ['submitted', ...],同样的漏字迟早再来一次。
 */
describe('源码守卫:不许再手写这份名单', () => {
  const ROOT = process.cwd()
  const CONSUMERS = [
    'src/lib/notifications/send.ts',
    'src/lib/planner/engine.ts',
    'src/lib/materials/status.ts',
    'src/app/app/dashboard/page.tsx',
  ]

  it.each(CONSUMERS)('%s 用共享名单,不内联字面量', (rel) => {
    const src = codeOnly(readFileSync(join(ROOT, rel), 'utf8')).replace(/\s+/g, ' ')

    expect(
      /SUBMITTED_OR_LATER|isSubmittedOrLater/.test(src),
      `${rel} 没引用共享名单`,
    ).toBe(true)

    /**
     * 内联字面量的特征:'submitted' 和另一个申请状态出现在同一对方括号里。
     * 单独出现的 'submitted'(比如状态标签映射、单个状态比较)是正常的,不该误报。
     */
    const inlined = /\[[^\]]*'submitted'[^\]]*'(admitted|rejected|waitlisted|interview_invited)'[^\]]*\]/.test(
      src,
    )
    expect(inlined, `${rel} 里又手写了一份状态名单`).toBe(false)
  })
})
