/**
 * 免费评估的提交闸门。
 *
 * ── 为什么必须有 ──────────────────────────────────────
 *
 * submitAssessment 是全站唯一**不需要登录**、又会写库并跑一遍匹配计算的入口,
 * 而且它就挂在首页最显眼的按钮上。每次调用会:
 *   · 查 program(含 school)+ 在一万五千多条 AdmissionRule 里匹配
 *   · 往 Lead 插一行,带 assessPayload 与 assessResult 两个 JSON
 *     (结果里是完整的匹配列表,单行可能几十 KB)
 *   · 写埋点
 *
 * 不限流的话,一个 for 循环就能同时做到两件事:把 Lead 表灌爆、把 2 核的机器
 * 算满 —— 而 Postgres 就跑在同一台机器上,数据库被拖垮意味着整站不可用。
 *
 * 同一套双闸门(按手机号 + 按 IP)在 lib/auth/verification.ts 里早就有了,
 * 这里只是把它用到同样需要的地方。
 *
 * ── 阈值怎么定的 ─────────────────────────────────────
 *
 * 手机号:一小时 5 次。正常人会改改成绩、换个地区重测两三次,5 次足够;
 *        真要再测,等一小时或换个方案(登录后有「重算」功能,不走这条路)。
 *
 * IP:一小时 30 次。必须留足余量 —— 校园网、公司网出口是 NAT,
 *     一个 IP 后面可能有几百人。定太紧会误伤真实用户,而误伤的是**获客漏斗
 *     最顶端那一步**,代价比放过几个脚本大得多。
 *     30 次仍然能把批量灌库压到「一天最多几百行」这个量级。
 */

export const ASSESS_MAX_PER_PHONE_HOUR = 5
export const ASSESS_MAX_PER_IP_HOUR = 30

export interface ThrottleDecision {
  allowed: boolean
  /** 给用户看的话。刻意不说明触发的是哪一维,免得对方据此调整策略 */
  message: string | null
}

/**
 * 纯判定,便于测试。
 *
 * ⚠️ 拿不到 IP 时(本地直连、没有 nginx)**跳过 IP 那道**,而不是拒绝 ——
 *    否则开发环境和任何没配反代的部署会直接不可用。手机号那道仍然生效。
 */
export function decideAssessThrottle(counts: {
  phoneLastHour: number
  ipLastHour: number | null
}): ThrottleDecision {
  if (counts.phoneLastHour >= ASSESS_MAX_PER_PHONE_HOUR) {
    return {
      allowed: false,
      message: '这个手机号刚测过好几次了,先看看已有的结果,一小时后可以再测。',
    }
  }

  if (counts.ipLastHour !== null && counts.ipLastHour >= ASSESS_MAX_PER_IP_HOUR) {
    return {
      allowed: false,
      message: '当前网络的测评请求有点多,请稍后再试。',
    }
  }

  return { allowed: true, message: null }
}
