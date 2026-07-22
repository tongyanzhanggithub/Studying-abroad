import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

/**
 * 后台可改的运行时配置。目前只用来放 LLM 的 API key。
 *
 * ── 为什么加密 ──────────────────────────────────────────
 * API key 落库等于多了一份泄露面:数据库备份、误开的只读账号、
 * 一个 SQL 注入,都会把 key 带出去,而被盗的 LLM key 是直接烧钱的。
 * 所以存的是 AES-256-GCM 密文,密钥从 AUTH_SECRET 派生。
 *
 * ⚠️ 诚实说明这层加密的**边界**:AUTH_SECRET 就在同一台机器的 .env 里,
 *    能登上服务器读文件的人一样能解开。它防的是「只拿到数据库」的场景,
 *    不是完整的密钥托管。真要更强的隔离,应该上 KMS / 密钥管理服务。
 */

const ALGO = 'aes-256-gcm'

function key(): Buffer {
  // AUTH_SECRET 长度不定,用 sha256 归一到 32 字节
  return createHash('sha256').update(env.authSecret).digest()
}

function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  // iv:tag:ciphertext —— 自带 iv,不需要额外存
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':')
}

function decrypt(stored: string): string | null {
  try {
    const [ivB64, tagB64, dataB64] = stored.split(':')
    if (!ivB64 || !tagB64 || !dataB64) return null
    const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    // AUTH_SECRET 换过之后旧密文解不开 —— 返回 null 让调用方降级到 .env,
    // 而不是抛异常把整个页面搞崩
    return null
  }
}

/** 给运营看的掩码,确认「填没填、填的是不是那把」用,不足以还原 key */
export function maskKey(k: string): string {
  const t = k.trim()
  if (t.length <= 12) return '*'.repeat(t.length)
  return `${t.slice(0, 6)}…${'*'.repeat(4)}${t.slice(-4)}`
}

export type SettingKey =
  | 'llm.provider'
  | 'llm.apiKey'
  | 'llm.baseUrl'
  | 'llm.model'

/** 是否加密存储 —— provider / model / baseUrl 不是秘密,明文存便于排查 */
const SECRET_KEYS: SettingKey[] = ['llm.apiKey']

export async function getSetting(k: SettingKey): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key: k } })
  if (!row) return null
  return SECRET_KEYS.includes(k) ? decrypt(row.value) : row.value
}

export async function setSetting(k: SettingKey, value: string, adminId: string): Promise<void> {
  const isSecret = SECRET_KEYS.includes(k)
  await db.appSetting.upsert({
    where: { key: k },
    create: {
      key: k,
      value: isSecret ? encrypt(value) : value,
      hint: isSecret ? maskKey(value) : null,
      updatedBy: adminId,
    },
    update: {
      value: isSecret ? encrypt(value) : value,
      hint: isSecret ? maskKey(value) : null,
      updatedBy: adminId,
    },
  })
}

export async function clearSetting(k: SettingKey): Promise<void> {
  await db.appSetting.deleteMany({ where: { key: k } })
}

export interface LlmConfig {
  provider: 'anthropic' | 'openai_compatible' | 'mock'
  apiKey: string
  baseUrl: string
  model: string
  /** 配置是从哪来的 —— 后台排查时最常问的就是这个 */
  source: 'db' | 'env' | 'none'
}

/**
 * 读取生效中的 LLM 配置。
 *
 * 后台填的优先于 .env:.env 要改就得登服务器重启进程,
 * 运营换个 key 不该需要找工程师。
 */
export async function getLlmConfig(): Promise<LlmConfig> {
  const [provider, apiKey, baseUrl, model] = await Promise.all([
    getSetting('llm.provider'),
    getSetting('llm.apiKey'),
    getSetting('llm.baseUrl'),
    getSetting('llm.model'),
  ])

  if (provider && provider !== 'mock' && apiKey) {
    return {
      provider: provider as LlmConfig['provider'],
      apiKey,
      baseUrl: baseUrl ?? '',
      model: model ?? '',
      source: 'db',
    }
  }

  if (env.llm.provider === 'anthropic' && env.llm.anthropicApiKey) {
    return {
      provider: 'anthropic',
      apiKey: env.llm.anthropicApiKey,
      baseUrl: '',
      model: env.llm.anthropicModel,
      source: 'env',
    }
  }
  if (env.llm.provider === 'openai_compatible' && env.llm.openaiApiKey && env.llm.openaiBaseUrl) {
    return {
      provider: 'openai_compatible',
      apiKey: env.llm.openaiApiKey,
      baseUrl: env.llm.openaiBaseUrl,
      model: env.llm.openaiModel,
      source: 'env',
    }
  }

  return { provider: 'mock', apiKey: '', baseUrl: '', model: '', source: 'none' }
}

/** 后台展示用 —— 绝不返回明文 key */
export async function getLlmConfigForDisplay() {
  const cfg = await getLlmConfig()
  const row = await db.appSetting.findUnique({ where: { key: 'llm.apiKey' } })
  return {
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    source: cfg.source,
    keyHint: cfg.source === 'db' ? (row?.hint ?? '已配置') : cfg.apiKey ? maskKey(cfg.apiKey) : '',
    hasKey: cfg.apiKey !== '',
  }
}
