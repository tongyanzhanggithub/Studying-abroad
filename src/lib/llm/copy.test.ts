import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { codeOnly } from '@/lib/source-scan'
import { essayStepDesc, essayIntro, interviewHint, AI_OFF_NOTE } from '@/lib/llm/copy'

/**
 * 「宣传了一个还不能用的功能」这件事,这个项目已经修过一次 ——
 * 上次只修了营销首页,工作台三处原样留着,而工作台是**收了钱才能进**的地方。
 *
 * 所以这里守两件事:
 *   1. 文案函数本身在两种配置下说的话不一样(纯函数,直接断言)
 *   2. 那三个页面确实**接**了这些函数,而不是又把话写死回去(源码扫描)
 *
 * ⚠️ 源码扫描一律走 codeOnly()。这些文件的注释里正好引用着被删掉的旧文案 ——
 *    不剥注释的话,守卫会被「解释为什么删掉它」的注释判红。
 *    (lib/source-scan.ts 顶部记着这个坑已经踩到第五次。)
 */

const root = process.cwd()
const read = (p: string) => codeOnly(readFileSync(join(root, p), 'utf8'))

const DASHBOARD = 'src/app/app/dashboard/page.tsx'
const ESSAYS = 'src/app/app/essays/page.tsx'
const WORKBENCH = 'src/app/app/essay/[id]/Workbench.tsx'
const ESSAY_PAGE = 'src/app/app/essay/[id]/page.tsx'
const HOME = 'src/app/page.tsx'

describe('AI 文案跟着配置走', () => {
  it('接通时才讲「挖素材 / 结构建议 / 逐句润色」', () => {
    expect(essayStepDesc(true)).toContain('挖素材')
    expect(essayIntro(true)).toContain('逐句改语法')
    expect(interviewHint(true)).toContain('一次问一个问题')
  })

  it('没接通时一句都不许讲成「现在就能用」', () => {
    for (const s of [essayStepDesc(false), essayIntro(false), interviewHint(false)]) {
      expect(s).not.toMatch(/AI (会|通过提问|是你的写作工具)/)
    }
    // 反过来:必须说清楚它还没接通,而不是闭口不提
    expect(essayIntro(false)).toContain('接入中')
    expect(essayStepDesc(false)).toContain('接入中')
    expect(interviewHint(false)).toBe(AI_OFF_NOTE)
  })

  it('没接通时也要说明现在能用的是什么 —— 不能只留一句「不可用」', () => {
    expect(essayIntro(false)).toContain('按学校分开写')
    expect(essayStepDesc(false)).toContain('合规检查')
  })

  it('「接入中」的说法里带上不额外收费 —— 这是对付费用户的承诺', () => {
    expect(AI_OFF_NOTE).toContain('不会向你收取')
  })
})

describe('工作台三处必须接了这个开关', () => {
  it.each([
    ['新手四步第 3 步', DASHBOARD, 'essayStepDesc('],
    ['文书列表页头', ESSAYS, 'essayIntro('],
    ['文书工作台', WORKBENCH, 'interviewHint('],
  ])('%s 用的是文案函数,不是写死的句子', (_label, file, call) => {
    expect(read(file)).toContain(call)
  })

  it.each([DASHBOARD, ESSAYS, ESSAY_PAGE])('%s 读取了 isAiAvailable', (file) => {
    expect(read(file)).toContain('isAiAvailable')
  })

  /**
   * ⚠️ 真正要防的是「有人把句子又写死回去」。
   *    上面的 toContain 只能证明函数被调过 —— 旁边再贴一句写死的宣传语它照样绿。
   */
  it.each([DASHBOARD, ESSAYS, WORKBENCH])('%s 里没有写死的 AI 宣传语', (file) => {
    const src = read(file)
    for (const banned of ['挖素材', '挖出素材', '逐句改语法', '一次问一个问题']) {
      expect(src).not.toContain(banned)
    }
  })

  it('三个调模型的入口都受 aiReady 约束,合规检查不受影响', () => {
    const src = read(WORKBENCH)
    // 访谈 / 结构 / 润色:三处 disabled 都带上 !props.aiReady
    expect(src.match(/disabled=\{pending \|\| !props\.aiReady/g) ?? []).toHaveLength(3)
    // 合规那颗按钮不调模型,不许被一起灰掉
    const compliance = src.slice(src.indexOf('checkCompliance(props.essayId)') - 400)
    expect(compliance.slice(0, 400)).not.toContain('!props.aiReady')
  })
})

describe('首页降级时不许报数字', () => {
  const src = read(HOME)

  /**
   * ⚠️ 原来的兜底写死 programCount: 566(真实 143)和一个 ¥1,999 的套餐
   *    (真实起价月票 ¥30)—— 库一断就对外报一套假数据,价格错 66 倍。
   */
  it('兜底里没有写死的项目数', () => {
    expect(src).not.toMatch(/programCount:\s*[1-9]\d+/)
  })

  it('兜底里没有写死的套餐价格', () => {
    expect(src).not.toContain('FALLBACK_PLANS')
    expect(src).not.toMatch(/priceCents:\s*\d+/)
  })

  it('降级时统计数字整块隐藏、地区退回中性说法', () => {
    expect(src).toContain('{!degraded && (')
    expect(src).toContain('degraded ? [] :')
  })

  it('降级标记确实从数据加载那里传出来', () => {
    expect(src).toContain('degraded: true')
    expect(src).toContain('degraded: false')
  })
})
