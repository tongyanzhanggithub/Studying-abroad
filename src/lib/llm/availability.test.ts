import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decideAvailability } from '@/lib/llm/availability'

/**
 * 「AI 到底能不能用」的判定。
 *
 * 这个函数决定首页讲不讲 AI 文书。它必须和 getLlmProvider() 的实际行为
 * **逐条对齐** —— 对不上就会出现「首页说有、点进去说没有」,
 * 那是失信,比一直保守不讲糟得多。
 */

const DOMESTIC = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

describe('不可用的情形', () => {
  it('provider 是 mock', () => {
    const r = decideAvailability({ provider: 'mock', apiKey: '', baseUrl: '' }, true)
    expect(r.available).toBe(false)
  })

  it('有 provider 但没 key —— getLlmProvider 这时也会退回 mock', () => {
    const r = decideAvailability(
      { provider: 'openai_compatible', apiKey: '', baseUrl: DOMESTIC },
      true,
    )
    expect(r.available).toBe(false)
  })

  it('兼容模式缺 Base URL —— 同样退回 mock', () => {
    const r = decideAvailability(
      { provider: 'openai_compatible', apiKey: 'sk-x', baseUrl: '' },
      true,
    )
    expect(r.available).toBe(false)
    expect(r.reason).toContain('Base URL')
  })

  /**
   * ⚠️ 生产环境下境外端点会被 getLlmProvider 直接拒绝调用(数据不能出境)。
   *    判定必须跟着算不可用,否则首页会宣传一个点下去必然报错的功能。
   */
  it('生产环境 + 境外端点 = 不可用', () => {
    const r = decideAvailability(
      { provider: 'anthropic', apiKey: 'sk-ant-x', baseUrl: '' },
      true,
    )
    expect(r.available).toBe(false)
    expect(r.reason).toBeTruthy()
  })
})

describe('可用的情形', () => {
  it('国内兼容端点 + key,生产环境下可用', () => {
    const r = decideAvailability(
      { provider: 'openai_compatible', apiKey: 'sk-x', baseUrl: DOMESTIC },
      true,
    )
    expect(r).toEqual({ available: true, reason: null })
  })

  it.each([
    'https://api.deepseek.com/v1',
    'https://api.moonshot.cn/v1',
    'https://ark.cn-beijing.volces.com/api/v3',
    'https://open.bigmodel.cn/api/paas/v4',
  ])('%s 也认', (baseUrl) => {
    expect(
      decideAvailability({ provider: 'openai_compatible', apiKey: 'sk-x', baseUrl }, true)
        .available,
    ).toBe(true)
  })

  /**
   * 开发环境下 region-guard 只告警不拦(见 llm/index.ts),
   * 判定跟着放行 —— 否则本地用任意模型调试时首页会说 AI 不可用,
   * 而实际上是能调通的。
   */
  it('开发环境 + 境外端点 = 可用(与运行时的只告警不拦一致)', () => {
    const r = decideAvailability(
      { provider: 'anthropic', apiKey: 'sk-ant-x', baseUrl: '' },
      false,
    )
    expect(r.available).toBe(true)
  })
})

describe('首页文案跟着可用性走', () => {
  const page = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8')

  /**
   * 这几条防的是「有人图省事把文案改回写死的常量」。
   *
   * 这个文件里已经有两处专门撤过 AI 文案并留了注释,但剩下两处漏了 ——
   * 说明靠人记得是不可靠的。
   */
  it('首页取了实际可用性,而不是写死', () => {
    expect(page).toContain('isAiAvailable')
    expect(page).toContain('const aiReady =')
  })

  /**
   * ⚠️ workspacePreviews 已经和「怎么用」那一节合并成 applicationFlow
   *    (首页原来有两个整块讲同样四件事)。名字变了,要守的东西没变:
   *    这两节必须是**按 aiReady 生成的函数**,不能退回写死的常量。
   */
  it('FAQ 与流程卡片都是按可用性生成的函数', () => {
    expect(page).toContain('function faqs(aiReady: boolean)')
    expect(page).toContain('function applicationFlow(aiReady: boolean)')
    expect(page).toContain('faqs(aiReady)')
    expect(page).toContain('applicationFlow(aiReady)')
  })

  it('不存在写死的 FAQS / WORKSPACE_PREVIEWS 常量', () => {
    expect(page).not.toContain('const FAQS =')
    expect(page).not.toContain('const WORKSPACE_PREVIEWS =')
  })

  /**
   * ⚠️ 这条原来锚在一句具体文案上(「AI 问问题,你保留真实表达」)——
   *    改一次文案它就红,而文案本来就是会改的。
   *
   *    要守的其实是:凡是只有接通模型才成立的说法,都必须落在
   *    aiReady 三元的 **true 分支**里。所以改成按分支切开来验:
   *    true 分支允许出现「素材追问 / 结构建议 / 逐句润色」这类词,
   *    false 分支一个都不许有。
   */
  it('只有接通才成立的说法,必须落在 aiReady 的 true 分支', () => {
    const AI_ONLY = ['素材追问', '结构建议', '逐句润色', '素材访谈']

    const start = page.indexOf('function applicationFlow')
    expect(start).toBeGreaterThan(-1)
    const fn = page.slice(start, page.indexOf('const ADVISOR_GROUPS'))

    const t = fn.indexOf('aiReady')
    expect(t).toBeGreaterThan(-1)
    const split = fn.indexOf(': {', t) // 三元的 false 分支起点
    expect(split).toBeGreaterThan(-1)

    const trueBranch = fn.slice(t, split)
    const falseBranch = fn.slice(split)

    // true 分支里至少讲了一条只有接通才成立的能力,否则这个分叉就没意义
    expect(AI_ONLY.some((w) => trueBranch.includes(w))).toBe(true)
    // false 分支一条都不许有
    for (const w of AI_ONLY) expect(falseBranch).not.toContain(w)
  })

  /**
   * ⚠️ 这条是回归测试,防的是我自己踩过的坑。
   *
   *    isAiAvailable 要查数据库。首页的营销数据有 try/catch 兜底,数据库断了
   *    会降级成保守数字、页面照常打开;而这个函数第一版**没有兜底**,
   *    被直接 await 在 HomePage 里之后,数据库一断整个首页就白屏 ——
   *    等于把那层降级废掉了。本地 PGlite 断开时真的复现了。
   */
  it('可用性读取失败时不抛异常,按不可用处理 —— 否则数据库一断首页就白屏', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/llm/availability.ts'), 'utf8')
    const body = src.slice(src.indexOf('async function readAvailability'))
    expect(body).toContain('try {')
    expect(body).toContain('catch')
    expect(body).toContain('available: false')
  })

  it('后台改 AI 设置时会让可用性缓存失效', () => {
    const actions = readFileSync(
      join(process.cwd(), 'src/app/admin/settings/actions.ts'),
      'utf8',
    )
    // 不清标签的话,接上模型后首页最长 5 分钟还在说「接入中」
    expect(actions).toContain('CACHE_TAGS.aiAvailability')
  })
})
