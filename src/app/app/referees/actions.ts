'use server'

import { formatDate } from '@/lib/utils'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import {
  buildInviteEmail,
  ALL_REFEREE_QUESTION_IDS,
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

/**
 * 新建推荐人。
 *
 * ⚠️ 一次把**联系方式**收齐,不要只收一个名字。
 *    原来只有「姓名 + 类型」两个字段,职称/单位/院系/邮箱/手机要事后
 *    再展开「联系方式」补 —— 而这几项恰恰是你**加人的那一刻**手上就有的
 *    (你正要给他发邮件),隔一天再回来补,反而想不起院系全称怎么写。
 *
 *    除姓名外都可留空:很多人加的时候只记得姓和职称,不该因此拦着。
 */
export async function createReferee(input: {
  name: string
  type: string
  title?: string
  institution?: string
  department?: string
  email?: string
  phone?: string
}) {
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

  /** 空字符串存成 null —— 否则「填过但清空了」和「从没填」在库里分不出来 */
  const opt = (v: string | undefined) => {
    const t = (v ?? '').trim()
    return t.length ? t : null
  }

  const referee = await db.referee.create({
    data: {
      userId: user.id,
      name,
      type: input.type as RefereeType,
      sort: count,
      title: opt(input.title),
      institution: opt(input.institution),
      department: opt(input.department),
      email: opt(input.email),
      phone: opt(input.phone),
    },
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
 * 「问他愿不愿意」—— 生成邀请邮件。
 *
 * ⚠️ 项目名用**中文**,和(已删除的)英文素材包相反 ——
 *    这封信是给中国老师看的,给他一串英文项目名反而不友好。
 */
export async function generateInvite(refereeId: string) {
  const user = await requireUser()
  const referee = await ownedReferee(user.id, refereeId)
  if (!referee) return { ok: false as const, error: '推荐人不存在。' }

  const choices = await db.userSchoolChoice.findMany({
    where: { userId: user.id },
    include: { program: { include: { school: true } } },
    orderBy: { sort: 'asc' },
  })

  const targetPrograms = choices.map((c) => {
    const school = c.program.school.nameZh ?? c.program.school.nameEn
    const program = c.program.nameZh ?? c.program.nameEn
    return `${school} · ${program}`
  })

  const deadlines = choices
    .map((c) => c.program.finalDeadline)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())

  const text = buildInviteEmail({
    studentName: user.name ?? '(请在设置里补上你的姓名)',
    referee: { name: referee.name, title: referee.title, type: referee.type },
    targetPrograms,
    deadline: deadlines.length ? formatDate(deadlines[0]) : null,
  })

  return { ok: true as const, text }
}
