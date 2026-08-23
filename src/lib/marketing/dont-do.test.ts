import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { codeOnly } from '@/lib/source-scan'

/**
 * 首页亮点区「有些事我们不做」。
 *
 * 这是全站唯一一处竞品原样抄不走的内容 —— 因为抄了就得真做到。
 * 也正因如此它最危险:写虚一条就是虚假宣传,而且印在首页最显眼的深色区里。
 *
 * ⚠️ 这些守卫**证明不了**「我们真的没存密码」—— 那要靠 schema 和运行时。
 *    它们能做到的是把「首页的承诺」和「代码里的事实」绑在一起:
 *    谁删掉对应能力,谁就会看到这里红,从而想起首页还挂着这句话。
 */
const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const page = codeOnly(read('src/app/page.tsx'))

describe('「有些事我们不做」', () => {
  it('用的是 DONT_DO,旧的两节没留下来', () => {
    expect(page).toContain('DONT_DO.map')
    expect(page).not.toContain('要的就是确定感')
    expect(page).not.toContain('少被信息差牵着走')
    expect(page).not.toContain('const REASONS')
  })

  it('五条都在,少一条这节就不成立', () => {
    for (const t of [
      '不碰你的申请账号和密码',
      '不给你没核对过的数字',
      '不代写文书',
      '不承诺录取',
      '不代理申请',
    ]) {
      expect(page).toContain(t)
    }
  })

  it('「不承诺录取」和页脚、FAQ 说的是一件事', () => {
    expect(page).toContain('不承诺录取结果')
    expect(page).toContain('能保证录取吗')
  })

  it('「没核对过的不开放」对应真实存在的地区闸门', () => {
    const gate = read('src/lib/regions/gate.ts')
    expect(gate).toMatch(/verifiedRate/)
    expect(gate).toMatch(/isPublic/)
  })

  it('「不代写」对应文书工作台确实没有一键生成全文', () => {
    const wb = codeOnly(read('src/app/app/essay/[id]/Workbench.tsx'))
    expect(wb).not.toMatch(/生成全文|一键生成|写整篇/)
  })

  /**
   * ⚠️ 这条我第一版写错了:断言页面上不出现「父母」「身份证」这些**词**。
   *    但那一页正文里恰恰写着「这里为什么不问身份证号和家庭信息?」——
   *    也就是说,守卫把「兑现承诺的那句话」本身判成了违规。
   *
   *    要守的不是词,是**有没有这些字段**。所以改成扫字段名:
   *    页面和 schema 里都不许出现证件号 / 监护人字段。
   *    反过来,那段解释必须**在**,删了就等于悄悄取消了这个承诺。
   */
  it('「不问证件号和父母信息」—— 扫的是字段,不是词', () => {
    const profile = read('src/app/app/profile/page.tsx')
    const schema = read('prisma/schema.prisma')
    for (const field of ['idNumber', 'idCard', 'parentName', 'guardian']) {
      expect(profile).not.toContain(field)
      expect(schema).not.toContain(field)
    }
    // 解释那段不能删 —— 它是这条承诺对用户可见的部分
    expect(profile).toContain('这里为什么不问身份证号和家庭信息')
  })

  it('老师默认不对外展示 —— 「不拿没核实的人撑门面」的另一半', () => {
    expect(read('prisma/schema.prisma')).toMatch(/showOnSite\s+Boolean\s+@default\(false\)/)
  })
})

describe('合并之后不该再有重复', () => {
  it('四件事只讲一遍 —— 旧的四个章节标记都不许回来', () => {
    for (const eyebrow of ['APPLICATION FEED', 'WORKSPACE PREVIEW', 'TRUST NOTES', 'WHY COMPASS']) {
      expect(page).not.toContain(eyebrow)
    }
  })

  it('「不用交八遍」这类说法最多出现一次', () => {
    expect(page.split('不用交八遍').length - 1).toBeLessThanOrEqual(1)
  })
})
