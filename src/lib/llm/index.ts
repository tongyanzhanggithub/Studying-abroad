import 'server-only'
import { db } from '@/lib/db'
import { getLlmConfig } from '@/lib/settings'

/**
 * LLM 网关。
 *
 * 设计要点(PRD 4.5 / 7.1 / 10.4):
 *   · 多供应商可切换,业务层不感知具体厂商
 *   · PRD 10.7 要求用户数据存境内、优先国内合规模型;openai_compatible
 *     可直接接通义/DeepSeek/豆包等国内服务
 *   · prompt 模板存数据库、后台热更新,不写死在代码里
 *   · 每用户每日调用配额,防滥用
 */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmResult {
  text: string
  tokensUsed: number
  provider: string
  model: string
}

export interface LlmProvider {
  readonly name: string
  readonly model: string
  complete(messages: LlmMessage[], opts?: { maxTokens?: number }): Promise<LlmResult>
}

// ── Anthropic ───────────────────────────────────────────

class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic'
  readonly model: string
  private readonly apiKey: string

  constructor(cfg: { apiKey: string; model: string }) {
    this.apiKey = cfg.apiKey
    this.model = cfg.model || 'claude-sonnet-5'
  }

  async complete(messages: LlmMessage[], opts?: { maxTokens?: number }): Promise<LlmResult> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    const rest = messages.filter((m) => m.role !== 'system')

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts?.maxTokens ?? 2048,
        system: system || undefined,
        messages: rest.map((m) => ({ role: m.role, content: m.content })),
      }),
    })

    if (!res.ok) {
      throw new Error(`Anthropic API 调用失败 ${res.status}: ${await res.text()}`)
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>
      usage: { input_tokens: number; output_tokens: number }
    }

    return {
      text: data.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join(''),
      tokensUsed: data.usage.input_tokens + data.usage.output_tokens,
      provider: this.name,
      model: this.model,
    }
  }
}

// ── OpenAI 兼容(通义/DeepSeek/豆包/Kimi 等)────────────

class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai_compatible'
  readonly model: string
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(cfg: { apiKey: string; baseUrl: string; model: string }) {
    this.apiKey = cfg.apiKey
    this.baseUrl = cfg.baseUrl
    this.model = cfg.model
  }

  async complete(messages: LlmMessage[], opts?: { maxTokens?: number }): Promise<LlmResult> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: opts?.maxTokens ?? 2048,
      }),
    })

    if (!res.ok) {
      throw new Error(`LLM API 调用失败 ${res.status}: ${await res.text()}`)
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>
      usage?: { total_tokens: number }
    }

    return {
      text: data.choices[0]?.message?.content ?? '',
      tokensUsed: data.usage?.total_tokens ?? 0,
      provider: this.name,
      model: this.model,
    }
  }
}

// ── Mock(无 key 时保证全链路可跑)──────────────────────

class MockLlmProvider implements LlmProvider {
  readonly name = 'mock'
  readonly model = 'mock'

  async complete(messages: LlmMessage[]): Promise<LlmResult> {
    const last = messages[messages.length - 1]?.content ?? ''
    return {
      text:
        `[MOCK 响应 · 未配置真实 LLM]\n\n` +
        `收到的最后一条输入(前 200 字):\n${last.slice(0, 200)}\n\n` +
        `请在 .env 中配置 LLM_PROVIDER 与对应 API key 后重试。`,
      tokensUsed: 0,
      provider: this.name,
      model: this.model,
    }
  }
}

/**
 * 取当前生效的 provider。
 *
 * 配置来源优先级:后台设置页 > .env > mock。
 * 做成异步是因为要读数据库 —— 改 key 不该需要登服务器改 .env 再重启进程。
 */
export async function getLlmProvider(): Promise<LlmProvider> {
  const cfg = await getLlmConfig()
  switch (cfg.provider) {
    case 'anthropic':
      return cfg.apiKey ? new AnthropicProvider(cfg) : new MockLlmProvider()
    case 'openai_compatible':
      return cfg.apiKey && cfg.baseUrl ? new OpenAiCompatibleProvider(cfg) : new MockLlmProvider()
    default:
      return new MockLlmProvider()
  }
}

// ── 配额 ────────────────────────────────────────────────

export class QuotaExceededError extends Error {
  constructor(limit: number) {
    super(`今日 AI 使用次数已达上限(${limit} 次),明天再来,或升级到 Pro 版`)
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 消费一次配额;超限抛 QuotaExceededError */
export async function consumeQuota(userId: string, limit: number): Promise<void> {
  const day = today()
  const usage = await db.aiUsageDaily.findUnique({
    where: { userId_day: { userId, day } },
  })
  if (usage && usage.count >= limit) throw new QuotaExceededError(limit)

  await db.aiUsageDaily.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, count: 1 },
    update: { count: { increment: 1 } },
  })
}

export async function recordTokens(userId: string, tokens: number): Promise<void> {
  await db.aiUsageDaily
    .update({
      where: { userId_day: { userId, day: today() } },
      data: { tokens: { increment: tokens } },
    })
    .catch(() => {
      /* 计数失败不影响主流程 */
    })
}

export async function getRemainingQuota(userId: string, limit: number): Promise<number> {
  const usage = await db.aiUsageDaily.findUnique({
    where: { userId_day: { userId, day: today() } },
  })
  return Math.max(0, limit - (usage?.count ?? 0))
}

// ── prompt 模板(后台热更新)───────────────────────────

export async function loadPrompt(code: string): Promise<{ system: string; userTpl: string }> {
  const tpl = await db.promptTemplate.findFirst({
    where: { code, active: true },
    orderBy: { version: 'desc' },
  })
  if (!tpl) throw new Error(`prompt 模板 ${code} 未配置`)
  return { system: tpl.system, userTpl: tpl.userTpl }
}
