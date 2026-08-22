/**
 * 「这所学校现在处在申请流程的哪一步」—— 纯函数,不碰数据库。
 *
 * ── 为什么抽出来 ──────────────────────────────────────
 *
 * 这段逻辑原来埋在 syncApplicationStatuses 里,而那是个要连库的 async 函数,
 * 于是**一直没有测试**。它决定学生工作台上每一所学校的状态标签,
 * 也决定行动计划要不要说「该递交了」—— 值得能直接对着具体情形写断言。
 *
 * (planner/engine.ts 的 planActions 当初也是同样的理由抽出来的。)
 */

/** 已经递交及之后的状态,不再自动回退 */
export const TERMINAL_STATUSES = [
  'submitted',
  'interview_invited',
  'admitted',
  'rejected',
  'waitlisted',
] as const

export interface StatusMaterial {
  programIds: string[]
  status: string
  /**
   * 加分材料(获奖证书、论文等)。
   *
   * ⚠️ 必填,不给默认值。给了默认值就等于允许调用方忘了 select 这个字段,
   *    而忘了的后果正是本文件要修的那个 bug。
   */
  optional: boolean
}

export interface StatusEssay {
  programId: string | null
  status: string
}

/**
 * 算出某所学校应有的状态;返回 null 表示不该改。
 *
 * ⚠️ **加分材料不参与判定。**
 *
 *    获奖证书、论文这类是「有则加分,没有不影响申请」—— 种子数据里
 *    award_certificate 的说明原文就写着「这一项**不计入材料完成度**」,
 *    getMaterialProgress 也确实把它们排除在分母之外。
 *
 *    但状态机此前用的是 `relevant.every(m => m.status === 'completed')`,
 *    把加分材料一起算了进去(那个查询甚至没 select optional,想算也算不了)。
 *    后果:一个必交材料全齐、文书也定稿的学生,只因为没得过奖,
 *      · 进度条显示 100%
 *      · 状态却永远停在「准备材料中」,进不了「可以递交」
 *      · 行动计划因此永远不说「该递交了」
 *    进度条说你做完了,状态说你没做完 —— 两句话来自同一批数据。
 */
export function nextApplicationStatus(
  current: string,
  programId: string,
  materials: StatusMaterial[],
  essays: StatusEssay[],
): string | null {
  if ((TERMINAL_STATUSES as readonly string[]).includes(current)) return null

  const relevant = materials.filter((m) => m.programIds.includes(programId))
  if (!relevant.length) return null

  /** 只看必交项 —— 加分项不该拦住任何人 */
  const required = relevant.filter((m) => !m.optional)

  /**
   * ⚠️ 必交项一个都没有时,不能用 every 的空数组语义(恒为 true)判「全做完了」。
   *    那会把「这所学校只挂了加分材料」直接推进到「可以递交」。
   *    真实数据里不会出现(保底清单全是必交项),但这条判断是
   *    「凭空说你可以递交了」的唯一入口,不值得赌。
   */
  const allDone = required.length > 0 && required.every((m) => m.status === 'completed')

  /**
   * 「动过了」可以把加分项算进来 —— 学生上传了获奖证书,
   * 说明他确实在准备这所学校,状态从「未开始」前进是对的。
   */
  const anyStarted = relevant.some((m) => m.status !== 'not_started')

  const mine = essays.filter((e) => e.programId === programId)
  const hasEssay = mine.length > 0
  const essayFinal = mine.every((e) => e.status === 'final')

  let next: string
  if (allDone && (!hasEssay || essayFinal)) next = 'ready_to_submit'
  else if (hasEssay && !essayFinal) next = 'writing_essay'
  else if (anyStarted) next = 'preparing_materials'
  else next = 'not_started'

  return next === current ? null : next
}
