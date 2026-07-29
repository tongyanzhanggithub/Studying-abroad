import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { codeOnly } from '@/lib/source-scan'
import {
  decideAssessThrottle,
  ASSESS_MAX_PER_PHONE_HOUR,
  ASSESS_MAX_PER_IP_HOUR,
} from '@/lib/assess-throttle'

/**
 * 免费评估的限流。
 *
 * submitAssessment 是全站唯一不需要登录、又会写库并跑匹配计算的入口,
 * 就挂在首页最显眼的按钮上。不限流的话一个 for 循环能同时灌爆 Lead 表
 * 和算满 2 核的机器 —— 而 Postgres 就在同一台上。
 */

describe('双闸门判定', () => {
  it('正常提交放行', () => {
    expect(decideAssessThrottle({ phoneLastHour: 0, ipLastHour: 0 }).allowed).toBe(true)
    expect(decideAssessThrottle({ phoneLastHour: 2, ipLastHour: 5 }).allowed).toBe(true)
  })

  it('手机号达到上限就拦', () => {
    const r = decideAssessThrottle({
      phoneLastHour: ASSESS_MAX_PER_PHONE_HOUR,
      ipLastHour: 0,
    })
    expect(r.allowed).toBe(false)
    expect(r.message).toBeTruthy()
  })

  it('上限是「达到即拦」,不是「超过才拦」', () => {
    expect(
      decideAssessThrottle({ phoneLastHour: ASSESS_MAX_PER_PHONE_HOUR - 1, ipLastHour: 0 })
        .allowed,
    ).toBe(true)
  })

  it('IP 达到上限也拦', () => {
    const r = decideAssessThrottle({ phoneLastHour: 0, ipLastHour: ASSESS_MAX_PER_IP_HOUR })
    expect(r.allowed).toBe(false)
  })

  /**
   * ⚠️ 拿不到 IP 时(本地直连、没配反代)跳过 IP 那道,而不是拒绝 ——
   *    否则开发环境和任何没有 nginx 的部署会直接不可用。
   */
  it('拿不到 IP 时只走手机号那道,不因此拒绝服务', () => {
    expect(decideAssessThrottle({ phoneLastHour: 0, ipLastHour: null }).allowed).toBe(true)
    expect(
      decideAssessThrottle({ phoneLastHour: ASSESS_MAX_PER_PHONE_HOUR, ipLastHour: null })
        .allowed,
    ).toBe(false)
  })

  it('提示语不说明触发的是哪一维 —— 免得对方据此调整策略', () => {
    const byPhone = decideAssessThrottle({ phoneLastHour: 99, ipLastHour: 0 }).message ?? ''
    const byIp = decideAssessThrottle({ phoneLastHour: 0, ipLastHour: 99 }).message ?? ''
    for (const m of [byPhone, byIp]) {
      expect(m).not.toContain('IP')
      expect(m).not.toMatch(/\d+\s*次\/小时|上限是/)
    }
  })
})

describe('阈值取值合理', () => {
  it('IP 上限明显高于手机号上限 —— 校园网/公司网是 NAT,一个 IP 后面几百人', () => {
    expect(ASSESS_MAX_PER_IP_HOUR).toBeGreaterThan(ASSESS_MAX_PER_PHONE_HOUR * 3)
  })

  it('手机号上限留够正常重测的次数', () => {
    // 改改成绩、换个地区重测两三次是常见行为,卡太死会伤到真实用户
    expect(ASSESS_MAX_PER_PHONE_HOUR).toBeGreaterThanOrEqual(3)
  })
})

describe('接入位置正确', () => {
  // ⚠️ 必须去掉注释行 —— 下面那条断言要找的 X-Forwarded-For,
  //    正好出现在源码里解释「为什么不用它」的那句注释里。见 lib/source-scan.ts。
  const src = codeOnly(readFileSync(join(process.cwd(), 'src/app/assess/actions.ts'), 'utf8'))

  /**
   * ⚠️ 闸门必须在 runAssessment 之前。放在后面等于形同虚设 ——
   *    昂贵的那部分(查 program + 一万五千条规则匹配)已经跑完了。
   */
  it('限流在 runAssessment 之前', () => {
    const gate = src.indexOf('decideAssessThrottle(')
    const run = src.indexOf('await runAssessment(')
    expect(gate).toBeGreaterThan(-1)
    expect(run).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(run)
  })

  it('只认 X-Real-IP,不认客户端可伪造的 X-Forwarded-For', () => {
    expect(src).toContain("get('x-real-ip')")
    expect(src.toLowerCase()).not.toContain('x-forwarded-for')
  })

  it('IP 会随 Lead 落库,否则下次没法按 IP 计数', () => {
    expect(src).toMatch(/referredById:[\s\S]{0,80}ip,/)
  })
})
