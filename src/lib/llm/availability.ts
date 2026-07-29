import 'server-only'
import { unstable_cache } from 'next/cache'
import { getLlmConfig } from '@/lib/settings'
import { checkLlmRegion } from '@/lib/llm/region-guard'
import { CACHE_TAGS, MARKETING_CACHE_SECONDS } from '@/lib/cache-tags'
import { env } from '@/lib/env'

/**
 * AI 功能到底能不能用。
 *
 * ── 为什么需要这个 ────────────────────────────────────
 *
 * 首页曾经在宣传「AI 问问题、素材追问、逐句润色」,而 LLM_PROVIDER=mock ——
 * 用户付了钱点进去,拿到的是「AI 助手正在接入中,暂时不可用」。
 *
 * 同一个文件里已经有两处专门为此撤过文案,还留了注释
 * 「讲一个还不能用的功能,等于卖不存在的东西」。但剩下两处漏了。
 *
 * 靠人记得改文案是不可靠的:接上模型的那天没人会想起来把话加回去,
 * 换回 mock 排查问题时更不会想起来撤下去。所以让**文案跟着配置走** ——
 * 接上就自动讲,没接就自动不讲,两个方向都不用改代码。
 *
 * ⚠️ 判定要和 getLlmProvider() 的实际行为一致,否则会出现
 *    「首页说有、点进去说没有」——比一直不讲更糟。
 *    三个条件缺一不可:
 *      1. provider 不是 mock
 *      2. 有 apiKey
 *      3. 过得了数据出境闸门(生产环境命中即拒绝调用,等于不可用)
 */
export interface AiAvailability {
  available: boolean
  /** 不可用的原因,只给后台看,不对外展示 */
  reason: string | null
}

/**
 * 判定逻辑本体 —— 纯函数,导出仅为可测。
 *
 * ⚠️ 它必须和 getLlmProvider() 的实际行为**逐条对齐**。对不上的话会出现
 *    「首页说有、点进去说没有」,那比一直不讲更糟 —— 前者是失信,后者只是保守。
 */
export function decideAvailability(
  cfg: { provider: string; apiKey: string; baseUrl: string },
  isProd: boolean,
): AiAvailability {
  // 对齐 getLlmProvider:provider 为 mock、或缺 key,都会退回 MockLlmProvider
  if (cfg.provider === 'mock' || !cfg.apiKey) {
    return { available: false, reason: '未配置模型供应商或 API key' }
  }
  // 对齐 getLlmProvider:openai_compatible 缺 baseUrl 同样退回 mock
  if (cfg.provider === 'openai_compatible' && !cfg.baseUrl) {
    return { available: false, reason: '兼容模式缺少 Base URL' }
  }

  /**
   * 数据出境闸门。生产环境下 getLlmProvider 命中即抛错拒绝调用,
   * 所以这里必须算不可用 —— 首页不能宣传一个点下去必然报错的功能。
   * 开发环境那边只告警不拦,判定跟着放行,方便本地用任意模型调试。
   */
  const region = checkLlmRegion(cfg.provider, cfg.baseUrl)
  if (!region.ok && isProd) {
    return { available: false, reason: region.reason }
  }

  return { available: true, reason: null }
}

/**
 * ⚠️ **绝不抛异常。**
 *
 *    getLlmConfig 要查数据库。首页那边的营销数据有 try/catch 兜底,
 *    数据库断了会降级成保守数字、页面照常打开;而这个函数一开始没有兜底,
 *    于是它被直接 await 在 HomePage 里的那一刻,数据库一断**整个首页就崩**——
 *    等于把那层精心做的降级给废了。(这不是假设:本地 PGlite 断开时
 *    首页直接白屏,是验证时抓到的。)
 *
 *    出错时一律返回**不可用**:宁可少讲一个功能,也不能宣传一个
 *    此刻根本判断不了状态的功能。
 */
async function readAvailability(): Promise<AiAvailability> {
  try {
    const cfg = await getLlmConfig()
    return decideAvailability(cfg, env.isProd)
  } catch (err) {
    console.error('[llm] 读取 AI 可用性失败,按不可用处理', err)
    return { available: false, reason: '配置读取失败' }
  }
}

/**
 * 跨请求缓存。
 *
 * 首页是匿名流量最大的一页,不该为了判断「AI 通没通」每次都查一遍设置表。
 * 后台改 AI 设置时打标签立即失效(见 admin/settings/actions.ts);
 * 改 .env 需要重启进程,重启本身就清了缓存。
 */
export const getAiAvailability = unstable_cache(readAvailability, ['ai-availability'], {
  tags: [CACHE_TAGS.aiAvailability],
  revalidate: MARKETING_CACHE_SECONDS,
})

/** 便捷判断 —— 页面里只关心能不能用 */
export async function isAiAvailable(): Promise<boolean> {
  return (await getAiAvailability()).available
}
