import 'server-only'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
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

/**
 * 调 LLM 并把失败转成可读结果,**不抛异常**。
 *
 * ⚠️ 为什么必须有这个:server action 里裸 `await llm.complete(...)` 一旦抛错,
 *    Next 会把整页替换成 error boundary —— 文书工作台的编辑器随之卸载,
 *    用户**没保存的正文一起消失**。而且 Next 在生产会屏蔽 Error message,
 *    这里精心写的中文提示(超时、端点未配置)一个字都到不了用户。
 *    所以统一在服务端 catch,把消息当**数据**返回,由前端渲染。
 */
export async function completeSafe(
  llm: LlmProvider,
  messages: LlmMessage[],
  opts?: { maxTokens?: number },
): Promise<{ ok: true; result: LlmResult } | { ok: false; error: string }> {
  try {
    return { ok: true, result: await llm.complete(messages, opts) }
  } catch (e) {
    console.error('[llm] 调用失败', { provider: llm.name, model: llm.model, error: e })
    return {
      ok: false,
      error:
        e instanceof Error && e.message
          ? e.message
          : 'AI 服务暂时不可用,请稍后重试。你已写的内容不受影响。',
    }
  }
}

/** LLM 调用超时:自建端点(openai_compatible 的 baseUrl 后台可配)吊死时,别把服务端连接挂死 */
const LLM_TIMEOUT_MS = 60_000

/**
 * 带超时的 fetch。
 *
 * ⚠️ 抓取侧有 20s 超时,LLM 侧原来一个都没有 —— 后台可配的自建端点一旦吊死,
 *    extractProgram → server action 会无限期阻塞,占满连接。这里统一加超时。
 * ⚠️ 错误响应体**不外泄**:res.text() 可能含内部端点/模型细节,完整记服务端日志,
 *    对外只抛状态码。
 */
async function llmFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`${label} 调用超时(${LLM_TIMEOUT_MS / 1000} 秒),请稍后重试或检查端点配置`)
    }
    throw new Error(`${label} 调用失败(网络层)`)
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    console.error(`[llm] ${label} 返回 ${res.status}:`, await res.text().catch(() => ''))
    throw new Error(`${label} 调用失败(${res.status})`)
  }
  return res
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

    const res = await llmFetch(
      'https://api.anthropic.com/v1/messages',
      {
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
      },
      'Anthropic API',
    )

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
    const res = await llmFetch(
      `${this.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
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
      },
      'LLM API',
    )

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
    /**
     * ⚠️ 生产环境**绝不返回 mock 文本**。
     *
     *    这段调试串以前会原样渲染进文书工作台的访谈 / 大纲 / 润色结果区 ——
     *    也就是说付了一两千块的学生,点「继续访谈」看到的是
     *    「请在 .env 中配置 LLM_PROVIDER」,而且照常扣掉当日 AI 配额。
     *
     *    AI 采集那条路径早就是「没 key 就直接不可用,不退回 mock」(README 有写),
     *    文书这边却在静默降级 —— 两处标准不一致。这里对齐:生产抛错,
     *    由 completeSafe 转成给用户看的话。
     */
    if (env.isProd) {
      throw new Error('AI 助手正在接入中,暂时不可用。你已写的内容不受影响,其余功能照常使用。')
    }

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
    // 文案不提「Pro 版」—— 套餐是月票/季票/年票,没有叫 Pro 的东西
    super(`今日 AI 使用次数已达上限(${limit} 次),明天再来,或升级更长时长的套餐`)
  }
}

/**
 * 退回一次配额。
 *
 * ⚠️ 配额是在调模型**之前**扣的(必须如此,否则并发能刷爆),
 *    但模型调用失败时那一次不该算在用户头上 —— 他什么都没得到。
 *    不会退到负数。
 */
export async function refundQuota(userId: string): Promise<void> {
  try {
    await db.aiUsageDaily.updateMany({
      where: { userId, day: today(), count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    })
  } catch (err) {
    // 退配额失败不能反过来影响主流程
    console.error(JSON.stringify({ event: 'llm.quota_refund_failed', userId, err: String(err) }))
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 消费一次配额;超限抛 QuotaExceededError */
export async function consumeQuota(userId: string, limit: number): Promise<void> {
  const day = today()
  // ⚠️ 原来是「先 findUnique 判上限,再 upsert 自增」两步,并发下多个请求会同时读到
  //    count=99 一起放行,超发量 = 并发数。改成**先原子自增再判**:upsert 的 increment
  //    是数据库层面的原子操作,返回自增后的值;每个并发请求拿到互不相同的新值,
  //    只有落在 ≤limit 的那些继续,其余抛错。
  const usage = await db.aiUsageDaily.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, count: 1 },
    update: { count: { increment: 1 } },
  })
  if (usage.count > limit) throw new QuotaExceededError(limit)
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
