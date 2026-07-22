import 'server-only'
import { getLlmProvider } from '@/lib/llm'
import { DIRECTION_ORDER } from '@/lib/programs/types'

/**
 * 从院校官网页面抽取结构化的项目信息。
 *
 * ── 这里的核心约束 ──────────────────────────────────────
 * 抽取结果**一律落到 ProgramDraft 表等人工审核**,不写 Program。
 * 原因见 schema 里 ProgramDraft 的注释:LLM 从网页抽字段一定会出错,
 * 而这个产品卖的就是数据准确(PRD 4.2)。
 *
 * 为了让人工审核**真的审得动**,每个字段都要求模型给出 `evidence` ——
 * 原文里的一句话。没有 evidence 的字段在审核页会被标红。
 * 这是防「一本正经地编」最有效的一招:要求引用原文之后,
 * 模型编不出来时更倾向于返回 null,而不是给一个看着合理的数字。
 */

/** 单个字段的抽取结果 —— 值 + 原文出处 */
export interface Extracted<T> {
  value: T | null
  /** 页面原文片段。模型找不到依据时必须留空,不允许自己组织语言 */
  evidence: string | null
}

export interface ExtractedProgram {
  school_name_en: Extracted<string>
  school_name_zh: Extracted<string>
  program_name_en: Extracted<string>
  program_name_zh: Extracted<string>
  faculty: Extracted<string>
  direction: Extracted<string>
  duration_months: Extracted<number>
  tuition: Extracted<string>
  campus: Extracted<string>
  is_online_only: Extracted<boolean>

  gpa_requirement: Extracted<string>
  china_university_list: Extracted<string>
  undergrad_background: Extracted<string>
  ielts_overall: Extracted<number>
  ielts_subscores: Extracted<string>
  toefl_overall: Extracted<number>
  toefl_subscores: Extracted<string>
  cet6_accepted: Extracted<string>
  gmat_gre: Extracted<string>
  prerequisites: Extracted<string>
  work_experience: Extracted<string>
  interview: Extracted<string>

  opens_at: Extracted<string>
  final_deadline: Extracted<string>
  rolling: Extracted<boolean>
  deadline_notes: Extracted<string>

  /** 模型自己说不准的地方 —— 直接展示给审核人 */
  uncertainties: string[]
}

const FIELD_KEYS = [
  'school_name_en',
  'school_name_zh',
  'program_name_en',
  'program_name_zh',
  'faculty',
  'direction',
  'duration_months',
  'tuition',
  'campus',
  'is_online_only',
  'gpa_requirement',
  'china_university_list',
  'undergrad_background',
  'ielts_overall',
  'ielts_subscores',
  'toefl_overall',
  'toefl_subscores',
  'cet6_accepted',
  'gmat_gre',
  'prerequisites',
  'work_experience',
  'interview',
  'opens_at',
  'final_deadline',
  'rolling',
  'deadline_notes',
] as const

export type FieldKey = (typeof FIELD_KEYS)[number]
export const EXTRACT_FIELDS: readonly FieldKey[] = FIELD_KEYS

export const FIELD_LABEL: Record<FieldKey, string> = {
  school_name_en: '学校英文名',
  school_name_zh: '学校中文名',
  program_name_en: '项目英文名',
  program_name_zh: '项目中文名',
  faculty: '学院',
  direction: '专业方向',
  duration_months: '学制(月)',
  tuition: '学费',
  campus: '校区',
  is_online_only: '纯线上项目',
  gpa_requirement: '均分要求',
  china_university_list: '中国院校认可名单',
  undergrad_background: '本科背景要求',
  ielts_overall: '雅思总分',
  ielts_subscores: '雅思小分',
  toefl_overall: '托福总分',
  toefl_subscores: '托福小分',
  cet6_accepted: '六级接受情况',
  gmat_gre: 'GMAT / GRE',
  prerequisites: '先修课',
  work_experience: '工作经验',
  interview: '面试',
  opens_at: '开放申请',
  final_deadline: '最终截止',
  rolling: '滚动录取',
  deadline_notes: '时间线备注',
}

const SYSTEM_PROMPT = `你是一个严格的信息抽取工具,从大学官网页面正文里抽取硕士项目的申请信息。

绝对规则:
1. 只抽取页面正文里**明确写出来**的信息。页面没写的,value 必须是 null。
2. 每个字段都要给 evidence —— 从正文里**原样复制**的一小段(不超过 200 字),
   证明这个值是页面上写的。找不到原文就把 value 和 evidence 都设为 null。
3. 禁止根据常识、同类学校的惯例、或者你的既有知识补全任何字段。
   宁可返回 null,也不要给一个「大概是这样」的值。
4. 注意区分「要求(requirement)」和「建议 / 平均水平(recommended / typical)」。
   只有明确写成要求的才算要求;是建议就在 evidence 里体现出来。
5. 日期一律输出 YYYY-MM-DD。页面上如果只写了「January 2026」这种没有具体日的,
   value 设为 null,并在 uncertainties 里说明。
6. **特别小心申请年份**:页面上常常同时挂着上一届和本届的日期。
   如果无法确定某个截止日属于哪一届,value 设 null 并写进 uncertainties。
   一个过期的日期比没有日期危险得多 —— 学生会照着它规划。
7. 学费保留原币种原文,不要换算。
8. uncertainties 里列出你拿不准的地方,用中文,每条一句话。

只输出 JSON,不要 markdown 代码块,不要任何解释文字。`

function buildUserPrompt(url: string, text: string): string {
  return `页面地址:${url}

页面正文:
"""
${text}
"""

按下面的结构输出 JSON。每个字段都是 {"value": ..., "evidence": ...} 的形状,
evidence 是原文片段或 null。

direction 只能从这个列表里选一个:${DIRECTION_ORDER.join(', ')}
判断不了就用 other。

{
${FIELD_KEYS.map((k) => `  "${k}": {"value": null, "evidence": null}`).join(',\n')},
  "uncertainties": []
}`
}

/** 从可能带 markdown 包裹的输出里取出 JSON */
export function parseJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : trimmed
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('模型没有返回 JSON')
  return JSON.parse(body.slice(start, end + 1))
}

/** 把模型返回的任意结构收敛成 ExtractedProgram,缺的补 null */
export function normalize(raw: unknown): ExtractedProgram {
  const o = (raw ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const k of FIELD_KEYS) {
    const cell = o[k] as { value?: unknown; evidence?: unknown } | undefined
    let value = cell?.value ?? null
    const evidence =
      typeof cell?.evidence === 'string' && cell.evidence.trim() !== ''
        ? cell.evidence.trim().slice(0, 400)
        : null

    // 模型偶尔会把 null 写成字符串 "null" / "N/A" / "not specified"
    if (typeof value === 'string' && /^(null|n\/a|none|not specified|未提及|无)$/i.test(value.trim())) {
      value = null
    }
    if (typeof value === 'string' && value.trim() === '') value = null

    // 没有 evidence 的值一律降级成 null —— 这正是防编造的那道闸
    out[k] = { value: evidence === null ? null : value, evidence }
  }

  // direction 必须落在枚举里,否则采纳时会写坏数据库
  const dir = (out.direction as Extracted<string>).value
  if (dir && !(DIRECTION_ORDER as readonly string[]).includes(dir)) {
    ;(out.direction as Extracted<string>).value = 'other'
  }

  out.uncertainties = Array.isArray(o.uncertainties)
    ? (o.uncertainties as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 20)
    : []

  return out as unknown as ExtractedProgram
}

export interface ExtractResult {
  data: ExtractedProgram
  model: string
  tokensUsed: number
  isMock: boolean
}

/** 正文最多喂这么多字符 —— 再长既烧钱也容易让模型漏读中间部分 */
const MAX_TEXT = 24_000

export async function extractProgram(url: string, text: string): Promise<ExtractResult> {
  const llm = await getLlmProvider()

  const result = await llm.complete(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(url, text.slice(0, MAX_TEXT)) },
    ],
    { maxTokens: 4096 },
  )

  if (llm.name === 'mock') {
    throw new Error(
      '还没配置 AI 服务 —— 请先到「AI 设置」里填 API key。没有 key 时不会产出任何采集结果,' +
        '避免把 mock 的假数据当成真采集混进待审队列。',
    )
  }

  return {
    data: normalize(parseJson(result.text)),
    model: `${result.provider}/${result.model}`,
    tokensUsed: result.tokensUsed,
    isMock: false,
  }
}
