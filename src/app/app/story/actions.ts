'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { ALL_QUESTION_IDS } from '@/lib/essays/question-bank'

/** 单条回答长度上限 —— 素材是给自己看的草稿,不是论文 */
const MAX_ANSWER_LENGTH = 4000

/**
 * 保存一条素材回答。
 *
 * 按题保存而不是整表提交:素材库有二三十个问题,一次填完是不现实的,
 * 学生会分好几次、隔好几天来填。整表提交意味着中途关掉浏览器就全丢了。
 *
 * ⚠️ questionId 必须来自题库。这是用户可控的入参,不校验的话
 *    任何人都能往这张表里塞任意 key —— 它会一路进到发给模型的 prompt 里。
 */
export async function saveStoryAnswer(questionId: string, answer: string) {
  const user = await requireUser()

  if (!ALL_QUESTION_IDS.has(questionId)) {
    return { ok: false as const, error: '这个问题不存在,请刷新页面后重试。' }
  }

  const trimmed = answer.trim()
  if (trimmed.length > MAX_ANSWER_LENGTH) {
    return { ok: false as const, error: `单条回答请控制在 ${MAX_ANSWER_LENGTH} 字以内。` }
  }

  /**
   * ⚠️ 清空即删除,不留空字符串行。
   *    留空行的话「答了多少题」会把它算成已答 —— 而进度是这个功能唯一的推进反馈,
   *    虚高的进度比没有进度更糟。
   */
  if (!trimmed) {
    await db.storyAnswer.deleteMany({ where: { userId: user.id, questionId } })
  } else {
    await db.storyAnswer.upsert({
      where: { userId_questionId: { userId: user.id, questionId } },
      create: { userId: user.id, questionId, answer: trimmed },
      update: { answer: trimmed },
    })
  }

  revalidatePath('/app/story')
  return { ok: true as const }
}
