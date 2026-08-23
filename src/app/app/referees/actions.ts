'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import {
  ALL_REFEREE_QUESTION_IDS,
  buildRefereePacket,
} from '@/lib/essays/referee-questions'
import type { RefereeStatus, RefereeType } from '@prisma/client'

const MAX_ANSWER_LENGTH = 4000
/** 多数项目要 2 封;留点余量,但不能不设上限 */
const MAX_REFEREES = 6

const VALID_TYPES: RefereeType[] = ['academic', 'professional']
const VALID_STATUSES: RefereeStatus[] = [
  'draft',
  'invited',
  'agreed',
  'submitted',
  'declined',
]

/**
 * ⚠️ 所有写操作都必须验归属。
 *    refereeId 来自 URL / 表单,是用户可控的;不验的话换个 id 就能改别人的
 *    推荐人信息 —— 而那里面是**真实第三方的姓名、单位和邮箱**,
 *    是这个库里最不该泄露的一类数据。
 */
async function ownedReferee(userId: string, refereeId: string) {
  return db.referee.findFirst({ where: { id: refereeId, userId } })
}

export async function createReferee(input: { name: string; type: string }) {
  const user = await requireUser()

  const name = input.name.trim()
  if (!name) return { ok: false as const, error: '请填写推荐人姓名。' }
  if (!VALID_TYPES.includes(input.type as RefereeType)) {
    return { ok: false as const, error: '推荐人类型不正确。' }
  }

  const count = await db.referee.count({ where: { userId: user.id } })
  if (count >= MAX_REFEREES) {
    return { ok: false as const, error: `最多添加 ${MAX_REFEREES} 位推荐人。` }
  }

  const referee = await db.referee.create({
    data: { userId: user.id, name, type: input.type as RefereeType, sort: count },
  })

  revalidatePath('/app/referees')
  return { ok: true as const, id: referee.id }
}

export async function updateReferee(
  refereeId: string,
  input: {
    name?: string
    title?: string
    department?: string
    institution?: string
    email?: string
    phone?: string
    note?: string
  },
) {
  const user = await requireUser()
  if (!(await ownedReferee(user.id, refereeId))) {
    return { ok: false as const, error: '推荐人不存在。' }
  }

  const name = input.name?.trim()
  if (input.name !== undefined && !name) {
    return { ok: false as const, error: '姓名不能为空。' }
  }

  await db.referee.update({
    where: { id: refereeId },
    data: {
      ...(name ? { name } : {}),
      ...(input.title !== undefined ? { title: input.title.trim() || null } : {}),
      ...(input.department !== undefined
        ? { department: input.department.trim() || null }
        : {}),
      ...(input.institution !== undefined
        ? { institution: input.institution.trim() || null }
        : {}),
      ...(input.email !== undefined ? { email: input.email.trim() || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone.trim() || null } : {}),
      ...(input.note !== undefined ? { note: input.note.trim() || null } : {}),
    },
  })

  revalidatePath('/app/referees')
  return { ok: true as const }
}

/**
 * 改进度。
 *
 * ⚠️ 时间戳只在**首次**进入该状态时写,不因反复切换而覆盖。
 *    「什么时候问的」是用来判断该不该催、要不要换人的依据,
 *    每次点一下就刷新的话这个判断就没了。
 */
export async function setRefereeStatus(refereeId: string, status: string) {
  const user = await requireUser()
  const referee = await ownedReferee(user.id, refereeId)
  if (!referee) return { ok: false as const, error: '推荐人不存在。' }
  if (!VALID_STATUSES.includes(status as RefereeStatus)) {
    return { ok: false as const, error: '状态不正确。' }
  }

  const now = new Date()
  const next = status as RefereeStatus

  await db.referee.update({
    where: { id: refereeId },
    data: {
      status: next,
      ...(next === 'invited' && !referee.invitedAt ? { invitedAt: now } : {}),
      ...(next === 'agreed' && !referee.agreedAt ? { agreedAt: now } : {}),
      ...(next === 'submitted' && !referee.submittedAt ? { submittedAt: now } : {}),
    },
  })

  revalidatePath('/app/referees')
  return { ok: true as const }
}

export async function deleteReferee(refereeId: string) {
  const user = await requireUser()
  // deleteMany + userId 条件:一步完成归属校验与删除,不存在中间态
  const res = await db.referee.deleteMany({ where: { id: refereeId, userId: user.id } })
  if (res.count === 0) return { ok: false as const, error: '推荐人不存在。' }

  revalidatePath('/app/referees')
  return { ok: true as const }
}

export async function saveRefereeAnswer(
  refereeId: string,
  questionId: string,
  answer: string,
) {
  const user = await requireUser()
  if (!(await ownedReferee(user.id, refereeId))) {
    return { ok: false as const, error: '推荐人不存在。' }
  }
  if (!ALL_REFEREE_QUESTION_IDS.has(questionId)) {
    return { ok: false as const, error: '这个问题不存在,请刷新页面后重试。' }
  }

  const trimmed = answer.trim()
  if (trimmed.length > MAX_ANSWER_LENGTH) {
    return { ok: false as const, error: `单条回答请控制在 ${MAX_ANSWER_LENGTH} 字以内。` }
  }

  // 清空即删除,不留空串 —— 否则进度会把它算成已答(同素材库)
  if (!trimmed) {
    await db.refereeAnswer.deleteMany({ where: { refereeId, questionId } })
  } else {
    await db.refereeAnswer.upsert({
      where: { refereeId_questionId: { refereeId, questionId } },
      create: { refereeId, questionId, answer: trimmed },
      update: { answer: trimmed },
    })
  }

  revalidatePath('/app/referees')
  return { ok: true as const }
}

/**
 * 生成发给推荐人的素材包。
 *
 * ⚠️ 输出**不是推荐信**,是「以学生口吻整理的事实清单」。
 *    见 referee-questions.ts 里 buildRefereePacket 的注释。
 */
export async function generatePacket(refereeId: string) {
  const user = await requireUser()
  const referee = await ownedReferee(user.id, refereeId)
  if (!referee) return { ok: false as const, error: '推荐人不存在。' }

  const [rows, choices, profile] = await Promise.all([
    db.refereeAnswer.findMany({
      where: { refereeId },
      select: { questionId: true, answer: true },
    }),
    db.userSchoolChoice.findMany({
      where: { userId: user.id },
      include: { program: { include: { school: true } } },
      orderBy: { sort: 'asc' },
    }),
    db.profile.findUnique({
      where: { userId: user.id },
      select: { passportSurname: true, passportGivenName: true },
    }),
  ])

  /**
   * ⚠️ 用**官方英文名**,不是 nameZh。
   *    推荐信是英文的 —— 给老师一个「巴斯大学 · 市场营销理学硕士」,
   *    等于让他自己去查这个项目的官方英文叫什么,查错了信就对不上申请。
   *    nameEn 在 schema 里是必填,所以这里不需要兜底。
   */
  const targetPrograms = choices.map((c) => ({
    program: c.program.nameEn,
    school: c.program.school.nameEn,
  }))

  /**
   * ⚠️ 姓名必须是护照拼音。
   *    schema 里 passportSurname 的注释点名列了推荐信:
   *    拼法和成绩单不一致,学校会当成两个人。
   *    而这里原来传的是 user.name(中文名)—— 正好是那句话说的情况。
   *    没填时传 null,素材包里会写明「等我补好再发您」,而不是硬凑一个。
   */
  const passportName =
    profile?.passportSurname && profile?.passportGivenName
      ? `${profile.passportSurname.toUpperCase()} ${profile.passportGivenName}`
      : null

  // 最早的截止日 —— 推荐人最需要知道的就是「什么时候之前要交」
  const deadlines = choices
    .map((c) => c.program.finalDeadline)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())

  const text = buildRefereePacket({
    passportName,
    studentName: user.name ?? '(请在设置里补上你的姓名)',
    referee: { name: referee.name, title: referee.title, type: referee.type },
    targetPrograms,
    // ISO 格式 —— 它印在英文区里给老师照抄,中文日期在那儿不合适
    deadline: deadlines.length ? deadlines[0].toISOString().slice(0, 10) : null,
    answers: Object.fromEntries(rows.map((r) => [r.questionId, r.answer])),
  })

  return { ok: true as const, text }
}
