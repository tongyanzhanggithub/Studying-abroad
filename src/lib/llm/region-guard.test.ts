import { describe, it, expect } from 'vitest'
import { checkLlmRegion } from './region-guard'

/**
 * 数据出境是合规红线(PRD 10.7)。这些用例锁住的是:
 * 哪些配置会被拒绝、哪些放行、哪些只告警。
 */
describe('checkLlmRegion —— 必须拒绝(数据会出境)', () => {
  it('anthropic 直连一律拒绝', () => {
    const r = checkLlmRegion('anthropic', '')
    expect(r.ok).toBe(false)
  })

  it.each([
    'https://api.openai.com/v1',
    'https://myorg.openai.azure.com/',
    'https://openrouter.ai/api/v1',
    'https://api.groq.com/openai/v1',
    'https://api.mistral.ai/v1',
    'https://generativelanguage.googleapis.com/v1',
    'https://api.x.ai/v1',
  ])('境外端点 %s 被拒绝', (url) => {
    expect(checkLlmRegion('openai_compatible', url).ok).toBe(false)
  })

  it('子域名也算(不能靠加前缀绕过)', () => {
    expect(checkLlmRegion('openai_compatible', 'https://eastus.api.openai.com/v1').ok).toBe(false)
  })

  it('端点地址无法解析时拒绝,不放行', () => {
    expect(checkLlmRegion('openai_compatible', 'not-a-url').ok).toBe(false)
  })
})

describe('checkLlmRegion —— 必须放行(境内合规)', () => {
  it.each([
    'https://dashscope.aliyuncs.com/compatible-mode/v1', // 通义千问
    'https://api.deepseek.com/v1',
    'https://api.moonshot.cn/v1',
    'https://ark.cn-beijing.volces.com/api/v3', // 豆包
    'https://open.bigmodel.cn/api/paas/v4', // 智谱
    'https://qianfan.baidubce.com/v2',
  ])('境内端点 %s 放行且不告警', (url) => {
    const r = checkLlmRegion('openai_compatible', url)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toBeUndefined()
  })

  it('mock 不产生外部请求,放行', () => {
    expect(checkLlmRegion('mock', '').ok).toBe(true)
  })

  it('没填端点视为未启用,不拦', () => {
    expect(checkLlmRegion('openai_compatible', '').ok).toBe(true)
  })
})

describe('checkLlmRegion —— 未知服务商:放行但告警', () => {
  it('不认识的域名放行,但带 note 要求人工确认', () => {
    // 用白名单会把不认识的合规国内服务商也拦掉,逼人关掉检查 —— 那等于没有检查
    const r = checkLlmRegion('openai_compatible', 'https://llm.my-company.cn/v1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toContain('自行确认')
  })
})
