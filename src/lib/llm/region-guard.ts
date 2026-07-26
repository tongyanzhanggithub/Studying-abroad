import 'server-only'

/**
 * LLM 服务商的数据出境校验。
 *
 * ── 为什么这是代码问题,不是运维问题 ──────────────────────
 * PRD 10.7 要求用户数据存境内。而**最容易把数据送出境的不是服务器,是第三方 API**:
 * 文书访谈会把学生的经历、家庭背景、个人陈述整段发给模型;AI 采集会把页面正文发出去。
 * 只要 LLM 端点在境外,这些数据就出境了 —— 服务器部署在哪都没用。
 *
 * 而这件事极容易手滑:`.env.example` 里同时列着 anthropic 和国内服务商,
 * 后台设置页还能把 key 直接存进数据库覆盖 .env。靠"记得选国内的"是不可靠的,
 * 所以在这里做成硬约束。
 *
 * ⚠️ 判定策略是**黑名单 + 未知告警**,不是白名单:
 *    白名单会把我不认识的合规国内服务商也拦掉,逼得运营去关掉这个检查 ——
 *    一个被关掉的检查等于没有检查。所以:确定境外的直接拒,不认识的大声告警。
 */

/** 确定在境外的服务商域名 —— 命中即拒绝 */
const OVERSEAS_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'openai.azure.com',
  'generativelanguage.googleapis.com',
  'api.mistral.ai',
  'api.cohere.ai',
  'api.cohere.com',
  'openrouter.ai',
  'api.groq.com',
  'api.together.xyz',
  'api.perplexity.ai',
  'api.x.ai',
]

/** 已知的境内合规服务商 —— 命中即放行,不再告警 */
const DOMESTIC_HOSTS = [
  'dashscope.aliyuncs.com', // 阿里云通义千问
  'api.deepseek.com', // DeepSeek
  'api.moonshot.cn', // 月之暗面 Kimi
  'ark.cn-beijing.volces.com', // 火山方舟(豆包)
  'open.bigmodel.cn', // 智谱 GLM
  'qianfan.baidubce.com', // 百度千帆
  'aip.baidubce.com',
  'hunyuan.tencentcloudapi.com', // 腾讯混元
  'api.lingyiwanwu.com', // 零一万物
  'api.baichuan-ai.com', // 百川
]

export type LlmRegionVerdict =
  | { ok: true; note?: string }
  | { ok: false; reason: string }

function hostOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * 校验某个 LLM 配置是否满足「数据不出境」。
 *
 * @param provider  anthropic | openai_compatible | mock
 * @param baseUrl   openai_compatible 时的端点
 */
export function checkLlmRegion(provider: string, baseUrl: string): LlmRegionVerdict {
  // mock 不产生任何外部请求
  if (provider === 'mock') return { ok: true }

  if (provider === 'anthropic') {
    return {
      ok: false,
      reason:
        'LLM_PROVIDER=anthropic 的端点在境外 —— 学生的文书、背景与个人陈述会随请求出境,' +
        '违反 PRD 10.7「用户数据存境内」。请改用 openai_compatible 接入境内合规模型' +
        '(通义千问 / DeepSeek / 豆包 / 智谱等,见 .env.example)。',
    }
  }

  if (provider === 'openai_compatible') {
    if (!baseUrl.trim()) return { ok: true } // 没配就是没启用,由别处的「未接入」告警负责
    const host = hostOf(baseUrl)
    if (!host) {
      return { ok: false, reason: `LLM 端点地址无法解析:${baseUrl}` }
    }
    const hit = OVERSEAS_HOSTS.find((h) => host === h || host.endsWith(`.${h}`))
    if (hit) {
      return {
        ok: false,
        reason:
          `LLM 端点 ${host} 在境外 —— 学生数据会随请求出境,违反 PRD 10.7。` +
          '请改用境内合规模型(见 .env.example)。',
      }
    }
    const known = DOMESTIC_HOSTS.find((h) => host === h || host.endsWith(`.${h}`))
    if (!known) {
      return {
        ok: true,
        note:
          `LLM 端点 ${host} 不在已知的境内服务商名单里。请**自行确认它在境内**并且有合规资质 —— ` +
          '学生的文书与背景信息会整段发给它。若是自建/私有部署的模型,可忽略这条提示。',
      }
    }
    return { ok: true }
  }

  return { ok: true }
}
