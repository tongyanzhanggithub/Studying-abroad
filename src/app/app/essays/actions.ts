'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser, getActiveSubscription } from '@/lib/auth/session'
import { track } from '@/lib/analytics'
import { countWords, renderTemplate } from '@/lib/utils'
import {
  getLlmProvider,
  loadPrompt,
  consumeQuota,
  recordTokens,
  QuotaExceededError,
} from '@/lib/llm'
import { runComplianceCheck } from '@/lib/essays/compliance'
import { syncApplicationStatuses } from '@/lib/materials/generate'

/**
 * 文书工作台的服务端动作(PRD 4.5)。
 *
 * ⚠️ 红线:这里**没有也不会有**「一键生成全文」的 action。
 *    AI 的三个入口分别是:访谈提问 / 结构建议 / 逐句润色。
 *    每一个都在 prompt 层和 API 层双重约束,不产出可直接提交的成文。
 */

async function requireQuota(userId: string) {
  const sub = await getActiveSubscription(userId)
  if (!sub) throw new Error('SUBSCRIPTION_REQUIRED')
  await consumeQuota(userId, sub.plan.aiDailyQuota)
}

export async function createEssay(params: {
  title: string
  programId: string | null
  promptText: string
  wordLimit: number | null
}) {
  const user = await requireUser()
  const essay = await db.essay.create({
    data: {
      userId: user.id,
      title: params.title.trim() || '未命名文书',
      programId: params.programId,
      promptText: params.promptText.trim() || null,
      wordLimit: params.wordLimit,
    },
  })
  const version = await db.essayVersion.create({
    data: { essayId: essay.id, content: '', createdBy: 'user' },
  })
  await db.essay.update({
    where: { id: essay.id },
    data: { currentVersionId: version.id },
  })

  revalidatePath('/app/essays')
  return { ok: true as const, essayId: essay.id }
}

/** 保存正文(自动保存调用) */
export async function saveContent(essayId: string, content: string) {
  const user = await requireUser()
  const essay = await db.essay.findFirst({ where: { id: essayId, userId: user.id } })
  if (!essay) return { ok: false as const, error: '文书不存在' }

  const version = await db.essayVersion.create({
    data: {
      essayId,
      content,
      wordCount: countWords(content),
      createdBy: 'user',
    },
  })
  await db.essay.update({
    where: { id: essayId },
    data: { currentVersionId: version.id },
  })

  return { ok: true as const, wordCount: countWords(content) }
}

/**
 * 素材访谈 —— 苏格拉底式提问,一次一个问题。
 * prompt 里显式禁止生成成段文书。
 */
export async function askInterview(essayId: string, userMessage: string) {
  const user = await requireUser()
  const essay = await db.essay.findFirst({
    where: { id: essayId, userId: user.id },
    include: { program: { include: { school: true } } },
  })
  if (!essay) return { ok: false as const, error: '文书不存在' }

  try {
    await requireQuota(user.id)
  } catch (e) {
    if (e instanceof QuotaExceededError) return { ok: false as const, error: e.message }
    throw e
  }

  const session = await db.essayAiSession.findFirst({
    where: { essayId, type: 'interview' },
    orderBy: { createdAt: 'desc' },
  })
  const history = (session?.messages ?? []) as Array<{ role: string; content: string }>

  const tpl = await loadPrompt('essay_interview')
  const userPrompt = renderTemplate(tpl.userTpl, {
    school: essay.program?.school.nameZh ?? essay.program?.school.nameEn ?? '(未指定院校)',
    program: essay.program?.nameZh ?? essay.program?.nameEn ?? '',
    prompt: essay.promptText ?? '(未填写文书题目)',
    cards: JSON.stringify(essay.materialCards),
    history: history.map((m) => `${m.role}: ${m.content}`).join('\n'),
  })

  const llm = await getLlmProvider()
  const result = await llm.complete([
    { role: 'system', content: tpl.system },
    { role: 'user', content: `${userPrompt}\n\n学生刚才说:${userMessage}` },
  ])

  const messages = [
    ...history,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: result.text },
  ]

  if (session) {
    await db.essayAiSession.update({
      where: { id: session.id },
      data: { messages, tokensUsed: session.tokensUsed + result.tokensUsed },
    })
  } else {
    await db.essayAiSession.create({
      data: {
        essayId,
        type: 'interview',
        messages,
        tokensUsed: result.tokensUsed,
        provider: result.provider,
        model: result.model,
      },
    })
  }

  await recordTokens(user.id, result.tokensUsed)
  await track('essay_ai_session', { userId: user.id, properties: { type: 'interview', essayId } })

  revalidatePath(`/app/essay/${essayId}`)
  return { ok: true as const, reply: result.text }
}

/** 结构建议 —— 只输出要点式大纲,不成文 */
export async function generateOutline(essayId: string) {
  const user = await requireUser()
  const essay = await db.essay.findFirst({
    where: { id: essayId, userId: user.id },
    include: { program: { include: { school: true } } },
  })
  if (!essay) return { ok: false as const, error: '文书不存在' }

  try {
    await requireQuota(user.id)
  } catch (e) {
    if (e instanceof QuotaExceededError) return { ok: false as const, error: e.message }
    throw e
  }

  const interview = await db.essayAiSession.findFirst({
    where: { essayId, type: 'interview' },
    orderBy: { createdAt: 'desc' },
  })
  const conversation = ((interview?.messages ?? []) as Array<{ role: string; content: string }>)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n')

  if (!conversation.trim()) {
    return {
      ok: false as const,
      error: '还没有素材可以做结构建议。先在左边的访谈里聊几轮,把经历讲清楚。',
    }
  }

  const tpl = await loadPrompt('essay_outline')
  const llm = await getLlmProvider()
  const result = await llm.complete([
    { role: 'system', content: tpl.system },
    {
      role: 'user',
      content: renderTemplate(tpl.userTpl, {
        school: essay.program?.school.nameZh ?? essay.program?.school.nameEn ?? '',
        program: essay.program?.nameZh ?? essay.program?.nameEn ?? '',
        prompt: essay.promptText ?? '(未填写)',
        wordLimit: essay.wordLimit ?? '未限制',
        cards: conversation,
      }),
    },
  ])

  await db.essay.update({
    where: { id: essayId },
    data: { outline: { text: result.text, generatedAt: new Date().toISOString() } },
  })
  await recordTokens(user.id, result.tokensUsed)
  await track('essay_ai_session', { userId: user.id, properties: { type: 'outline', essayId } })

  revalidatePath(`/app/essay/${essayId}`)
  return { ok: true as const, outline: result.text }
}

export interface PolishSuggestion {
  original: string
  suggestion: string
  reason: string
  type: string
}

/**
 * 逐句润色。
 *
 * ⚠️ 刻意返回**建议列表**而不是改好的全文 —— 学生必须逐条决定接受或拒绝。
 *    这既是合规要求,也是让学生真正参与写作的产品设计。
 */
export async function polishText(essayId: string, text: string) {
  const user = await requireUser()
  const essay = await db.essay.findFirst({
    where: { id: essayId, userId: user.id },
    include: { user: { include: { profile: true } } },
  })
  if (!essay) return { ok: false as const, error: '文书不存在' }
  if (!text.trim()) return { ok: false as const, error: '请先选中要润色的文字' }

  try {
    await requireQuota(user.id)
  } catch (e) {
    if (e instanceof QuotaExceededError) return { ok: false as const, error: e.message }
    throw e
  }

  const profile = essay.user.profile
  const languageLevel =
    profile?.languageType && profile.languageType !== 'none' && profile.languageScore
      ? `${profile.languageType === 'ielts' ? '雅思' : '托福'} ${profile.languageScore}`
      : '未提供'

  const tpl = await loadPrompt('essay_polish')
  const llm = await getLlmProvider()
  const result = await llm.complete([
    { role: 'system', content: tpl.system },
    { role: 'user', content: renderTemplate(tpl.userTpl, { languageLevel, text }) },
  ])

  let suggestions: PolishSuggestion[] = []
  try {
    const jsonStart = result.text.indexOf('[')
    const jsonEnd = result.text.lastIndexOf(']')
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      suggestions = JSON.parse(result.text.slice(jsonStart, jsonEnd + 1))
    }
  } catch {
    // 模型没按格式返回 —— 不硬解析,如实告诉用户
    return {
      ok: false as const,
      error: 'AI 返回的格式不符合预期,请重试。如果反复出现,可能是模型配置有问题。',
    }
  }

  await db.essay.update({
    where: { id: essayId },
    data: { polishRound: { increment: 1 }, status: 'polishing' },
  })
  await recordTokens(user.id, result.tokensUsed)
  await track('essay_ai_session', { userId: user.id, properties: { type: 'polish', essayId } })

  revalidatePath(`/app/essay/${essayId}`)
  return { ok: true as const, suggestions }
}

/** 运行合规检查 */
export async function checkCompliance(essayId: string) {
  const user = await requireUser()
  const owned = await db.essay.findFirst({ where: { id: essayId, userId: user.id } })
  if (!owned) return { ok: false as const, error: '文书不存在' }

  const result = await runComplianceCheck(essayId)
  revalidatePath(`/app/essay/${essayId}`)
  return { ok: true as const, result }
}

/**
 * 标记终稿。
 * ⚠️ 合规检查未通过(存在 blocker)时**不允许**标记终稿。
 */
export async function finalizeEssay(essayId: string) {
  const user = await requireUser()
  const essay = await db.essay.findFirst({ where: { id: essayId, userId: user.id } })
  if (!essay) return { ok: false as const, error: '文书不存在' }

  const check = await runComplianceCheck(essayId)
  if (!check.passed) {
    return {
      ok: false as const,
      error: '合规检查未通过,请先处理标红的问题再标记终稿。',
      result: check,
    }
  }

  await db.essay.update({
    where: { id: essayId },
    data: { status: 'final', finalizedAt: new Date() },
  })
  await syncApplicationStatuses(user.id)
  await track('essay_final', { userId: user.id, properties: { essayId } })

  revalidatePath(`/app/essay/${essayId}`)
  revalidatePath('/app/essays')
  revalidatePath('/app/dashboard')
  return { ok: true as const, result: check }
}
