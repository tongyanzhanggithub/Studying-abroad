'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser, getActiveSubscription } from '@/lib/auth/session'
import { track } from '@/lib/analytics'
import { countWords, renderTemplate } from '@/lib/utils'
import {
  getLlmProvider,
  completeSafe,
  loadPrompt,
  consumeQuota,
  refundQuota,
  recordTokens,
  QuotaExceededError,
} from '@/lib/llm'
import { runComplianceCheck } from '@/lib/essays/compliance'
import { formatAnswersForPrompt } from '@/lib/essays/question-bank'
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

/**
 * 当前版本写满多久之后另起一版。
 *
 * 这个值是在两种坏结果之间取的折中:
 *   · 太短 → 退化回「每次停顿存一份全文」,也就是原来的问题
 *   · 太长 → 学生手滑全选删除、自动保存跟着覆盖,能回退的最早状态太旧
 * 30 分钟意味着最坏情况丢失半小时的修改,而一小时的写作只留下两行左右。
 */
const VERSION_ROLL_MINUTES = 30

/**
 * 把当前版本「封存」:把它的内容原样复制成新的一版并指向新版。
 *
 * 之后的自动保存改写的是**新版**,旧那一行就此定格 —— 于是「润色之前的原文」
 * 「标记终稿那一刻的文字」都能留下一份不会再被覆盖的记录。
 *
 * 没有当前版本(理论上不该发生)时什么都不做,让调用方继续走正常流程。
 */
async function sealCurrentVersion(essayId: string, label: string): Promise<void> {
  const essay = await db.essay.findUnique({
    where: { id: essayId },
    select: { currentVersionId: true },
  })
  if (!essay?.currentVersionId) return

  const current = await db.essayVersion.findUnique({ where: { id: essay.currentVersionId } })
  if (!current) return

  await db.$transaction(async (tx) => {
    await tx.essayVersion.update({ where: { id: current.id }, data: { label } })
    const next = await tx.essayVersion.create({
      data: {
        essayId,
        content: current.content,
        wordCount: current.wordCount,
        createdBy: current.createdBy,
      },
    })
    await tx.essay.update({ where: { id: essayId }, data: { currentVersionId: next.id } })
  })
}

/**
 * 保存正文(自动保存调用)。
 *
 * ⚠️ 这里**原地更新当前版本**,不是每次都新建一版。
 *
 *    原来是每调用一次就 `essayVersion.create` 一行完整正文。而工作台的自动保存
 *    防抖是 1200ms —— 也就是说打字时每一次停顿都往库里插一份全文副本,
 *    写半小时能攒出几百行。
 *
 *    真正让这件事变得没有意义的是:**没有任何地方读得到这些版本**。
 *    文书页和合规检查都只取 `take: 1`(最新一版),工作台里没有版本列表、
 *    没有对比、没有回滚。除最新一行外全是写进去再没人看的死数据,
 *    却实打实占着磁盘,还会把「导出我的数据」撑到几百 MB。
 *
 *    改成:平时原地更新;只有在**说得出理由**的时刻才另起一版 ——
 *    距上一版超过 VERSION_ROLL_MINUTES、AI 润色之前、标记终稿。
 */
export async function saveContent(essayId: string, content: string) {
  const user = await requireUser()
  const essay = await db.essay.findFirst({ where: { id: essayId, userId: user.id } })
  if (!essay) return { ok: false as const, error: '文书不存在' }

  const wordCount = countWords(content)

  const current = essay.currentVersionId
    ? await db.essayVersion.findUnique({ where: { id: essay.currentVersionId } })
    : null

  // 没有当前版本(老数据 / 建档异常),或当前版本已经写了够久 → 另起一版
  const roll =
    !current || Date.now() - current.createdAt.getTime() > VERSION_ROLL_MINUTES * 60_000

  if (roll) {
    const version = await db.essayVersion.create({
      data: { essayId, content, wordCount, createdBy: 'user' },
    })
    await db.essay.update({ where: { id: essayId }, data: { currentVersionId: version.id } })
  } else {
    await db.essayVersion.update({
      where: { id: current.id },
      data: { content, wordCount },
    })
  }

  return { ok: true as const, wordCount }
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

  /**
   * ⚠️ 素材从**用户级的素材库**取,不再是 essay.materialCards。
   *
   *    materialCards 是个死字段:全项目只有这一处读、零处写,所以 prompt 里
   *    「已收集到的素材卡片」永远是 `[]` —— 模型每次都从零开始问,
   *    学生在素材库里认真写下的东西一个字都没被用上。
   *
   *    改成读 StoryAnswer,并且**只带答过的题**(见 formatAnswersForPrompt):
   *    把没答的也列过去,模型会挨个补问一遍,而访谈的价值在于
   *    顺着他已经写下的往下深挖,不是把表格再念一次。
   */
  const storyRows = await db.storyAnswer.findMany({
    where: { userId: user.id },
    select: { questionId: true, answer: true },
  })
  const story = formatAnswersForPrompt(
    Object.fromEntries(storyRows.map((r) => [r.questionId, r.answer])),
  )

  const tpl = await loadPrompt('essay_interview')
  const userPrompt = renderTemplate(tpl.userTpl, {
    school: essay.program?.school.nameZh ?? essay.program?.school.nameEn ?? '(未指定院校)',
    program: essay.program?.nameZh ?? essay.program?.nameEn ?? '',
    prompt: essay.promptText ?? '(未填写文书题目)',
    cards: story,
    history: history.map((m) => `${m.role}: ${m.content}`).join('\n'),
  })

  const llm = await getLlmProvider()
  // 失败不要抛 —— 抛出去会整页崩掉,把编辑器里没保存的正文一起带走
  const call = await completeSafe(llm, [
    { role: 'system', content: tpl.system },
    { role: 'user', content: `${userPrompt}\n\n学生刚才说:${userMessage}` },
  ])
  if (!call.ok) {
    // 模型没给出结果,这次不该算用户的配额
    await refundQuota(user.id)
    return { ok: false as const, error: call.error }
  }
  const result = call.result

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
  const call = await completeSafe(llm, [
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
  if (!call.ok) {
    // 模型没给出结果,这次不该算用户的配额
    await refundQuota(user.id)
    return { ok: false as const, error: call.error }
  }
  const result = call.result

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
  const call = await completeSafe(llm, [
    { role: 'system', content: tpl.system },
    { role: 'user', content: renderTemplate(tpl.userTpl, { languageLevel, text }) },
  ])
  if (!call.ok) {
    // 模型没给出结果,这次不该算用户的配额
    await refundQuota(user.id)
    return { ok: false as const, error: call.error }
  }
  const result = call.result

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

  /**
   * ⚠️ 封存润色前的原文。
   *
   *    润色只返回建议,改写是学生自己在编辑器里做的 —— 而自动保存现在是
   *    **原地更新**当前版本,他一边采纳建议一边就把原文覆盖掉了,没有退路。
   *    这一刻是整个流程里最需要「回得去」的:学生完全可能改完发现不如原来的。
   *    顺带这份留痕对原创性声明也有用 —— 能看出 AI 介入之前他自己写成什么样。
   */
  await sealCurrentVersion(essayId, `第 ${essay.polishRound + 1} 轮润色前`)

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
export async function finalizeEssay(essayId: string, attestOriginal = false) {
  const user = await requireUser()
  const essay = await db.essay.findFirst({ where: { id: essayId, userId: user.id } })
  if (!essay) return { ok: false as const, error: '文书不存在' }

  const check = await runComplianceCheck(essayId)

  /**
   * ⚠️ 区分两类 blocker,否则零容忍院校的文书永远定不了稿(死锁,见 compliance.ts)。
   *   · 客观事实类(空文书、超字数)—— 系统能判定,一律拦死;
   *   · 院校 AI 政策类 —— 系统无法验证「是不是本人写的」,性质是告知 + 学生担责,
   *     所以改为要求学生显式声明原创,声明留痕。
   */
  if (!check.passed) {
    if (!check.attestableOnly) {
      return {
        ok: false as const,
        error: '合规检查未通过,请先处理标红的问题再标记终稿。',
        result: check,
      }
    }
    if (!attestOriginal) {
      return {
        ok: false as const,
        needsAttestation: true as const,
        error: '这所学校对 AI 辅助写作持零容忍态度。请先确认这篇文书完全由你本人撰写。',
        result: check,
      }
    }
  }

  /**
   * ⚠️ 把定稿这一刻的文字封存成不可再改的一版。
   *    标记终稿之后学生还能回来编辑,而自动保存是原地更新的 ——
   *    不封存的话,「他当初交上去的到底是哪个版本」就永远查不到了。
   *    出现学术诚信争议时,这是唯一能自证的东西。
   */
  await sealCurrentVersion(essayId, '终稿')

  await db.essay.update({
    where: { id: essayId },
    data: {
      status: 'final',
      finalizedAt: new Date(),
      // 留痕:谁在什么时候声明了原创。出现争议时这是唯一依据。
      complianceCheck: {
        ...(check as unknown as object),
        ...(attestOriginal
          ? { originalityAttestedAt: new Date().toISOString(), attestedBy: user.id }
          : {}),
      } as unknown as object,
    },
  })
  await syncApplicationStatuses(user.id)
  await track('essay_final', { userId: user.id, properties: { essayId } })

  revalidatePath(`/app/essay/${essayId}`)
  revalidatePath('/app/essays')
  revalidatePath('/app/dashboard')
  return { ok: true as const, result: check }
}
