import type { ApplicationStatus, Confidence, Program, School } from '@prisma/client'

// 本科专业分类已迁到 @/lib/programs/undergrad-catalog(教育部《本科专业目录》国标),
// 由 @/components/MajorPicker 消费。原来那份手拼的海外 subject area 列表已废弃。

/**
 * Program.requirements 与 Program.deadlines 是 Json 列,
 * 这里定义它们的运行时形状,并提供安全读取器。
 * 采集脚本、后台录入、前端展示三方共用这一套定义。
 */

export interface LanguageRequirement {
  overall: number | null
  subscores: string | null
}

export interface ProgramRequirements {
  undergrad_background?: string | null
  /** 英国校常见的「中国大学认可名单」分档,中国申请者最关心的字段 */
  china_university_list?: string | null
  gpa_requirement?: string | null
  ielts?: LanguageRequirement | null
  toefl?: LanguageRequirement | null
  /** 港校特有:是否接受六级 */
  cet6_accepted?: string | null
  gmat_gre?: string | null
  prerequisites?: string | null
  work_experience?: string | null
  interview?: string | null
}

export interface DeadlineRound {
  name: string
  deadline: string | null
  decision_by?: string | null
}

export interface ProgramDeadlines {
  opens_at?: string | null
  rolling?: boolean
  rounds?: DeadlineRound[]
  final_deadline?: string | null
  notes?: string | null
}

export function readRequirements(p: Pick<Program, 'requirements'>): ProgramRequirements {
  return (p.requirements ?? {}) as ProgramRequirements
}

export function readDeadlines(p: Pick<Program, 'deadlines'>): ProgramDeadlines {
  return (p.deadlines ?? {}) as ProgramDeadlines
}

/** ── 数据新鲜度(PRD 4.2 红线)────────────────────────────
 *
 * 超过 30 天未核对的字段前端标灰并提示;AI 采集未经人工核对的数据
 * 一律视为「待核实」,不得作为确定值展示。
 */
export const VERIFY_STALE_DAYS = 30

export type Freshness = 'fresh' | 'stale' | 'unverified'

export function programFreshness(p: {
  lastVerifiedAt: Date | null
  confidence: Confidence
}): Freshness {
  if (!p.lastVerifiedAt || p.confidence === 'ai_collected' || p.confidence === 'unknown') {
    return 'unverified'
  }
  const ageDays = (Date.now() - new Date(p.lastVerifiedAt).getTime()) / 86_400_000
  return ageDays > VERIFY_STALE_DAYS ? 'stale' : 'fresh'
}

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  fresh: '',
  stale: '数据超 30 天未核对,请以官网为准',
  unverified: '待核实 · 请以官网为准',
}

/** ── 展示用中文标签 ──────────────────────────────────── */

export const REGION_LABEL: Record<string, string> = {
  UK: '英国',
  HK: '中国香港',
  SG: '新加坡',
  AU: '澳大利亚',
  CA: '加拿大',
  MO: '中国澳门',
  JP: '日本',
  KR: '韩国',
  NZ: '新西兰',
  IE: '爱尔兰',
  NL: '荷兰',
  DE: '德国',
  FR: '法国',
  CH: '瑞士',
  US: '美国',
}

/**
 * 展示顺序 —— 按中国学生申请量排,不按字母序。
 * 选校表单和结果页都按这个顺序渲染。
 */
export const REGION_ORDER = [
  'UK', 'US', 'AU', 'HK', 'SG', 'CA', 'NZ', 'IE', 'NL', 'DE', 'JP', 'KR', 'MO', 'FR', 'CH',
] as const

export const DIRECTION_ORDER = [
  'finance',
  'accounting',
  'management',
  'marketing',
  'business_analytics',
  'economics',
  'international_business',
  'supply_chain',
  'hr',
  'computer_science',
  'data_science_ai',
  'engineering',
  'architecture',
  'mathematics_statistics',
  'natural_sciences',
  'life_sciences_medicine',
  'social_sciences',
  'media_communication',
  'law_public_policy',
  'education',
  'arts_design',
  'humanities',
  'environment_sustainability',
  'agriculture_food_science',
  'hospitality_tourism',
  'public_health',
  'other',
] as const

export const DIRECTION_LABEL: Record<string, string> = {
  finance: '金融',
  accounting: '会计',
  management: '管理',
  marketing: '市场营销',
  business_analytics: '商业分析',
  economics: '经济学',
  international_business: '国际商务',
  supply_chain: '供应链与运营',
  hr: '人力资源',
  computer_science: '计算机科学',
  data_science_ai: '数据科学与人工智能',
  engineering: '工程与技术',
  architecture: '建筑与建成环境',
  mathematics_statistics: '数学与统计',
  natural_sciences: '自然科学',
  life_sciences_medicine: '生命科学与医学',
  social_sciences: '社会科学',
  media_communication: '传媒与传播',
  law_public_policy: '法律与公共政策',
  education: '教育',
  arts_design: '艺术与设计',
  humanities: '人文',
  environment_sustainability: '环境与可持续发展',
  agriculture_food_science: '农业与食品科学',
  hospitality_tourism: '酒店与旅游管理',
  public_health: '公共卫生',
  other: '其他 / 跨学科',
}

export const UNDERGRAD_TIER_LABEL: Record<string, string> = {
  c985_211: '985 / 211',
  double_non_first: '双非一本',
  tier_two_other: '二本及其他',
  overseas: '海外本科',
}

export const TIER_TAG_LABEL: Record<string, string> = {
  reach: '冲刺',
  match: '匹配',
  safe: '保底',
}

export const APPLICATION_STATUS_LABEL: Record<string, string> = {
  not_started: '未开始',
  preparing_materials: '材料准备中',
  writing_essay: '文书中',
  ready_to_submit: '待递交',
  submitted: '已递交',
  interview_invited: '面试邀请',
  admitted: '录取',
  rejected: '拒绝',
  waitlisted: '候补',
}

export type ProgramWithSchool = Program & { school: School }

/**
 * 从「单项要求」原文里解析出最低单项分。
 *
 * ⚠️ 放在这里而不是某个引擎里:**测评和行动计划都要用它**。
 *    原来只有 lib/assessment/engine.ts 有,于是测评页说学生「单项不达标」,
 *    工作台的行动计划却一句不提 —— 因为那边只比总分。
 *    规则只有一份实现,才不会两个页面对同一个学生给出相反结论。
 *
 * 院校库里 61% 的项目写了这一项,常见写法(中英混杂):
 *   「单项不低于6.0」「各项不低于 6.5」「no subtest below 5.5」
 *   「No band below 6.5 (…)」「minimum 6.0 in each component」
 * 明确写「未列明」的返回 null —— 解析不出来时**不猜**,宁可不判。
 */
export function parseMinBandRequirement(subscores: string | null | undefined): number | null {
  if (!subscores) return null
  const t = subscores.toLowerCase()
  if (/未列明|not specified|no specific|未说明/.test(t)) return null

  const patterns = [
    /(?:no\s+(?:band|subtest|component|section)\s+(?:below|lower than)\s*)(\d(?:\.\d)?)/,
    /(?:minimum|min\.?|at least)\s*(?:of\s*)?(\d(?:\.\d)?)\s*(?:in\s+each|per\s+(?:band|component))/,
    /(?:单项|各项|各单项|每项)[^0-9]{0,6}(\d(?:\.\d)?)/,
    /(?:each\s+(?:band|component|subtest)[^0-9]{0,10})(\d(?:\.\d)?)/,
  ]
  for (const re of patterns) {
    const m = t.match(re)
    if (m) {
      const n = Number(m[1])
      // 雅思单项区间 4–9;超出范围说明匹配到了别的数字(如年份),丢弃
      if (Number.isFinite(n) && n >= 4 && n <= 9) return n
    }
  }
  return null
}

/**
 * 「这份申请已经递交出去了」—— 学生在这些状态下不该再被催交、
 * 不该被判成「本轮已过截止」、也不该被劝「早点交」。
 *
 * ⚠️ 这份名单**必须只有一处**。
 *
 *    此前它在四个地方各写了一遍,而且**两处漏了 interview_invited**:
 *
 *      dashboard「已递交」计数        5 个,齐
 *      planner 已过截止判定           5 个,齐
 *      planner 滚动录取提示           3 个,漏 interview_invited / waitlisted
 *      每日截止提醒的 SQL             4 个,漏 interview_invited
 *
 *    最后那处是**会发短信的**。deadline_3d 是 mandatory 短信,文案写着
 *    「{school} 申请将于 {date} 截止,请尽快递交」——
 *    于是一个已经递交、并且拿到面试邀请的学生,会收到催他赶紧递交的短信。
 *    2026-08-19 本地实测复现:四种「已递交及之后」的状态里,
 *    只有 interview_invited 那一条真的发了出去。
 *
 *    interview_invited 在枚举里排在 submitted **之后** —— 它的含义是
 *    「已经交了,而且学校约了面试」,不是「还没交」。漏掉它不是口径之争,是写错了。
 */
export const SUBMITTED_OR_LATER = [
  'submitted',
  'interview_invited',
  'admitted',
  'rejected',
  'waitlisted',
] as const satisfies readonly ApplicationStatus[]

/** 判断某个状态是否属于「已经递交出去了」 */
export function isSubmittedOrLater(status: string): boolean {
  return (SUBMITTED_OR_LATER as readonly string[]).includes(status)
}
