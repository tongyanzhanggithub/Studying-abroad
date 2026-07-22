'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { fetchPageText, htmlToText } from '@/lib/collect/fetch'
import { discoverProgramLinks } from '@/lib/collect/discover'
import { extractProgram, type ExtractedProgram, type Extracted } from '@/lib/collect/extract'
import type { Direction, Region } from '@prisma/client'

/**
 * AI 采集的服务端动作。
 *
 * 整条链路刻意分成两段,中间一定有人:
 *   采集(createDraft)→ ProgramDraft 表 → 人工审核(approveDraft)→ Program 表
 * 没有任何一个 action 可以从抓取直接写到 Program。
 */

/** ── 采集 ─────────────────────────────────────────────── */

export async function createDraftFromUrl(url: string, region: Region) {
  await requireAdmin('operator')

  let page: { url: string; text: string }
  try {
    page = await fetchPageText(url)
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : '抓取失败' }
  }
  return runExtract(page.url, page.text, region)
}

/**
 * 粘贴正文采集。
 *
 * 很多院校官网是前端渲染的,服务端抓回来是一具空壳;
 * 也有不少关键信息只在 PDF 招生简章里。这时让运营自己复制粘贴,
 * 比让采集功能直接不可用要实际得多。
 */
export async function createDraftFromText(sourceUrl: string, rawText: string, region: Region) {
  await requireAdmin('operator')

  // 粘进来的可能是从浏览器复制的 HTML 片段,统一过一遍清洗
  const text = /<[a-z][\s\S]*>/i.test(rawText) ? htmlToText(rawText) : rawText.trim()
  if (text.length < 200) {
    return { ok: false as const, error: '正文太短(不足 200 字),抽不出什么东西。' }
  }
  if (!sourceUrl.trim()) {
    return { ok: false as const, error: '还是要填官网地址 —— 审核的人要靠它对照原文。' }
  }
  return runExtract(sourceUrl.trim(), text, region)
}

async function runExtract(sourceUrl: string, text: string, region: Region) {
  let extracted: Awaited<ReturnType<typeof extractProgram>>
  try {
    extracted = await extractProgram(sourceUrl, text)
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'AI 抽取失败' }
  }

  const d = extracted.data
  const schoolNameEn = d.school_name_en.value?.trim() ?? ''
  const programNameEn = d.program_name_en.value?.trim() ?? ''

  if (!schoolNameEn || !programNameEn) {
    return {
      ok: false as const,
      error:
        '这个页面里连学校名或项目名都没抽出来,多半不是项目详情页。' +
        '换成具体某个硕士项目的页面再试。',
    }
  }

  // 查重:同名项目已经在库里,说明这次是更新而不是新增
  const matched = await db.program.findFirst({
    where: {
      region,
      nameEn: { equals: programNameEn, mode: 'insensitive' },
      school: { nameEn: { equals: schoolNameEn, mode: 'insensitive' } },
    },
    select: { id: true },
  })

  const draft = await db.programDraft.create({
    data: {
      sourceUrl,
      region,
      // 只留一段够审核对照的,不整页存 —— 310 条量级下整页正文会把库撑得很难备份
      sourceText: text.slice(0, 40_000),
      payload: d as unknown as object,
      schoolNameEn,
      programNameEn,
      matchedProgramId: matched?.id ?? null,
      model: extracted.model,
      tokensUsed: extracted.tokensUsed,
    },
  })

  revalidatePath('/admin/collect')
  return { ok: true as const, draftId: draft.id, isUpdate: Boolean(matched) }
}

/** ── 按学校采集 ───────────────────────────────────────── */

/**
 * 第一步:从学校的项目列表页发现候选项目链接。
 *
 * 只发现,不抓取、不调模型 —— 这一步几乎不花钱,可以随便试。
 * 真正花钱的是下一步逐个抽取,所以必须先让人看清要抓哪些。
 */
export async function discoverSchoolPrograms(listingUrl: string, region: Region) {
  await requireAdmin('operator')

  let page: Awaited<ReturnType<typeof fetchPageText>>
  try {
    page = await fetchPageText(listingUrl)
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : '抓取失败' }
  }

  const host = new URL(page.finalUrl).hostname
  const links = discoverProgramLinks(page.html, page.finalUrl, { host })

  if (links.length === 0) {
    return {
      ok: false as const,
      error:
        '没在这个页面上找到像项目详情页的链接。可能是:①这是搜索结果页,列表由 JS 动态加载,' +
        '服务端抓不到;②给的不是项目列表页。可以换成学院的「Taught postgraduate courses」总览页再试。',
    }
  }

  // 标出已经在库里的,避免重复采集浪费额度
  const existing = await db.program.findMany({
    where: { region, sourceUrls: { hasSome: links.map((l) => l.url) } },
    select: { sourceUrls: true },
  })
  const known = new Set(existing.flatMap((p) => p.sourceUrls))

  return {
    ok: true as const,
    host,
    links: links.map((l) => ({ ...l, existing: known.has(l.url) })),
  }
}

/**
 * 第二步:对勾选的链接逐个抽取。
 *
 * 串行,并且每条失败都单独返回 —— 一所学校三十个项目,
 * 中间挂掉两个不该让整批白跑。
 */
export async function collectOne(url: string, region: Region) {
  await requireAdmin('operator')

  let page: Awaited<ReturnType<typeof fetchPageText>>
  try {
    page = await fetchPageText(url)
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : '抓取失败' }
  }
  return runExtract(page.finalUrl, page.text, region)
}

/** ── 审核 ─────────────────────────────────────────────── */

/** 审核页回传的最终值 —— 审核人可以逐字段改,不是照单全收 */
export interface ReviewedValues {
  schoolNameEn: string
  schoolNameZh: string
  programNameEn: string
  programNameZh: string
  faculty: string
  direction: Direction
  durationMonths: string
  tuition: string
  campus: string
  isOnlineOnly: boolean

  gpaRequirement: string
  chinaUniversityList: string
  undergradBackground: string
  ieltsOverall: string
  ieltsSubscores: string
  toeflOverall: string
  toeflSubscores: string
  cet6Accepted: string
  gmatGre: string
  prerequisites: string
  workExperience: string
  interview: string

  opensAt: string
  finalDeadline: string
  rolling: boolean
  deadlineNotes: string
}

function nn(v: string): string | null {
  const t = v.trim()
  return t === '' ? null : t
}
function num(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
function parseDate(v: string): Date | null | false {
  const t = v.trim()
  if (t === '') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false
  const d = new Date(`${t}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? false : d
}

/**
 * 采纳草稿 —— 写入 Program。
 *
 * `confidence` 只有两种取值,由审核人自己选:
 *   · verified     —— 我逐字段对照官网核对过了
 *   · ai_collected —— 先收进来,但还没核实,进待核对队列
 *
 * 默认给 ai_collected。「审核过」和「核对过」不是一回事:
 * 审核人可能只是扫了一眼觉得没有明显胡说,那不足以支撑
 * 对用户展示成确定值(PRD 4.2)。要标 verified 得自己明确勾。
 */
export async function approveDraft(
  draftId: string,
  values: ReviewedValues,
  markVerified: boolean,
) {
  const admin = await requireAdmin('operator')

  const draft = await db.programDraft.findUnique({ where: { id: draftId } })
  if (!draft) return { ok: false as const, error: '草稿不存在' }
  if (draft.status !== 'pending') return { ok: false as const, error: '这条已经处理过了' }

  const finalDeadline = parseDate(values.finalDeadline)
  const opensAt = parseDate(values.opensAt)
  if (finalDeadline === false || opensAt === false) {
    return { ok: false as const, error: '日期要写成 2026-01-15 这样,没保存。' }
  }
  if (!values.schoolNameEn.trim() || !values.programNameEn.trim()) {
    return { ok: false as const, error: '学校名和项目名都不能空。' }
  }

  const school = await db.school.upsert({
    where: { nameEn_region: { nameEn: values.schoolNameEn.trim(), region: draft.region } },
    create: {
      nameEn: values.schoolNameEn.trim(),
      nameZh: nn(values.schoolNameZh),
      region: draft.region,
    },
    update: nn(values.schoolNameZh) ? { nameZh: nn(values.schoolNameZh) } : {},
  })

  const ielts = num(values.ieltsOverall)
  const toefl = num(values.toeflOverall)

  const requirements = {
    undergrad_background: nn(values.undergradBackground),
    china_university_list: nn(values.chinaUniversityList),
    gpa_requirement: nn(values.gpaRequirement),
    ielts:
      ielts === null && nn(values.ieltsSubscores) === null
        ? null
        : { overall: ielts, subscores: nn(values.ieltsSubscores) },
    toefl:
      toefl === null && nn(values.toeflSubscores) === null
        ? null
        : { overall: toefl, subscores: nn(values.toeflSubscores) },
    cet6_accepted: nn(values.cet6Accepted),
    gmat_gre: nn(values.gmatGre),
    prerequisites: nn(values.prerequisites),
    work_experience: nn(values.workExperience),
    interview: nn(values.interview),
  }

  const deadlines = {
    opens_at: nn(values.opensAt),
    rolling: values.rolling,
    final_deadline: nn(values.finalDeadline),
    notes: nn(values.deadlineNotes),
  }

  const common = {
    nameZh: nn(values.programNameZh),
    faculty: nn(values.faculty),
    direction: values.direction,
    region: draft.region,
    durationMonths: num(values.durationMonths),
    tuition: nn(values.tuition),
    campus: nn(values.campus),
    isOnlineOnly: values.isOnlineOnly,
    requirements: requirements as object,
    deadlines: deadlines as object,
    finalDeadline: finalDeadline,
    isRolling: values.rolling,
    confidence: markVerified ? ('verified' as const) : ('ai_collected' as const),
    lastVerifiedAt: markVerified ? new Date() : null,
    verifiedBy: markVerified ? admin.adminId : null,
  }

  const program = await db.program.upsert({
    where: { schoolId_nameEn: { schoolId: school.id, nameEn: values.programNameEn.trim() } },
    create: {
      ...common,
      schoolId: school.id,
      nameEn: values.programNameEn.trim(),
      sourceUrls: [draft.sourceUrl],
      notes: `AI 采集于 ${draft.createdAt.toISOString().slice(0, 10)}(${draft.model ?? '未知模型'})`,
    },
    update: {
      ...common,
      // 来源链接是累积的,新采集不该把之前核对时记下的官网地址冲掉
      sourceUrls: { push: draft.sourceUrl },
    },
  })

  await db.programDraft.update({
    where: { id: draftId },
    data: {
      status: 'approved',
      reviewedBy: admin.adminId,
      reviewedAt: new Date(),
      resultProgramId: program.id,
    },
  })

  revalidatePath('/admin/collect')
  revalidatePath('/admin/programs')
  return { ok: true as const, programId: program.id, verified: markVerified }
}

export async function rejectDraft(draftId: string, reason: string) {
  const admin = await requireAdmin('operator')
  await db.programDraft.updateMany({
    where: { id: draftId, status: 'pending' },
    data: {
      status: 'rejected',
      reviewedBy: admin.adminId,
      reviewedAt: new Date(),
      rejectReason: nn(reason),
    },
  })
  revalidatePath('/admin/collect')
  return { ok: true as const }
}

/** 把抽取结果摊平成表单初值 —— 没有 evidence 的字段在 normalize 阶段已经是 null 了 */
export async function draftToFormValues(payload: ExtractedProgram): Promise<ReviewedValues> {
  const g = <T,>(f: Extracted<T> | undefined): string =>
    f?.value === null || f?.value === undefined ? '' : String(f.value)

  return {
    schoolNameEn: g(payload.school_name_en),
    schoolNameZh: g(payload.school_name_zh),
    programNameEn: g(payload.program_name_en),
    programNameZh: g(payload.program_name_zh),
    faculty: g(payload.faculty),
    direction: (payload.direction?.value ?? 'other') as Direction,
    durationMonths: g(payload.duration_months),
    tuition: g(payload.tuition),
    campus: g(payload.campus),
    isOnlineOnly: payload.is_online_only?.value === true,

    gpaRequirement: g(payload.gpa_requirement),
    chinaUniversityList: g(payload.china_university_list),
    undergradBackground: g(payload.undergrad_background),
    ieltsOverall: g(payload.ielts_overall),
    ieltsSubscores: g(payload.ielts_subscores),
    toeflOverall: g(payload.toefl_overall),
    toeflSubscores: g(payload.toefl_subscores),
    cet6Accepted: g(payload.cet6_accepted),
    gmatGre: g(payload.gmat_gre),
    prerequisites: g(payload.prerequisites),
    workExperience: g(payload.work_experience),
    interview: g(payload.interview),

    opensAt: g(payload.opens_at),
    finalDeadline: g(payload.final_deadline),
    rolling: payload.rolling?.value === true,
    deadlineNotes: g(payload.deadline_notes),
  }
}
