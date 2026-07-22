'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth/session'
import { clearSetting, getLlmConfig, setSetting } from '@/lib/settings'
import { getLlmProvider } from '@/lib/llm'

/**
 * AI 服务配置。
 *
 * 只有 super_admin 能改 —— 这里存的是能直接烧钱的 API key,
 * 权限门槛应当高于日常的数据录入。
 */
export async function saveLlmSettings(input: {
  provider: 'anthropic' | 'openai_compatible' | 'mock'
  apiKey: string
  baseUrl: string
  model: string
}) {
  const admin = await requireAdmin('super_admin')

  if (input.provider === 'mock') {
    await clearSetting('llm.apiKey')
    await setSetting('llm.provider', 'mock', admin.adminId)
    revalidatePath('/admin/settings')
    return { ok: true as const, message: '已切回 mock,AI 功能不会真的调用外部服务。' }
  }

  if (input.provider === 'openai_compatible' && !input.baseUrl.trim()) {
    return { ok: false as const, error: '兼容模式必须填 Base URL(服务商给的接口地址)。' }
  }
  if (input.provider === 'openai_compatible' && !input.model.trim()) {
    return { ok: false as const, error: '兼容模式必须填模型名。' }
  }

  await setSetting('llm.provider', input.provider, admin.adminId)
  await setSetting('llm.baseUrl', input.baseUrl.trim(), admin.adminId)
  await setSetting('llm.model', input.model.trim(), admin.adminId)

  // key 留空 = 沿用已存的那把,不要用空串把它冲掉 ——
  // 页面从来不回显明文,运营改模型名时不可能重新粘一遍 key
  if (input.apiKey.trim()) {
    await setSetting('llm.apiKey', input.apiKey.trim(), admin.adminId)
  }

  const cfg = await getLlmConfig()
  if (!cfg.apiKey) {
    return { ok: false as const, error: '还没有 API key,先粘一个进来。' }
  }

  revalidatePath('/admin/settings')
  return { ok: true as const, message: '已保存。建议点一下「测试连接」确认这把 key 能用。' }
}

/** 真的发一次请求,而不是只看格式 —— 格式对但额度用完的 key 也是不能用的 key */
export async function testLlmConnection() {
  await requireAdmin('super_admin')

  const llm = await getLlmProvider()
  if (llm.name === 'mock') {
    return { ok: false as const, error: '当前是 mock,没有配置真实服务。' }
  }

  try {
    const t0 = Date.now()
    const res = await llm.complete(
      [{ role: 'user', content: '回复「ok」两个字,不要其它内容。' }],
      { maxTokens: 16 },
    )
    return {
      ok: true as const,
      message: `连接正常 · ${res.provider}/${res.model} · 耗时 ${Date.now() - t0}ms · 返回「${res.text.trim().slice(0, 20)}」`,
    }
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : '调用失败',
    }
  }
}

export async function removeLlmKey() {
  await requireAdmin('super_admin')
  await clearSetting('llm.apiKey')
  revalidatePath('/admin/settings')
  return { ok: true as const }
}
