import type { Confidence, Program, School } from '@prisma/client'

/**
 * 本科学科门类选项。
 *
 * ⚠️ 评估流程和「我的背景」表单共用这一份 —— 早先只写在 assess/page.tsx 里,
 *    背景表单要用就得复制一份,两边迟早会不一致(而这个值会存进 Profile
 *    并参与方向推荐,不一致就意味着推荐错)。
 */
export const UNDERGRAD_MAJOR_OPTIONS = [
  { value: 'Business & Management', label: 'Business & Management', description: '商科 / 管理' },
  { value: 'Economics & Finance', label: 'Economics & Finance', description: '经济 / 金融' },
  { value: 'Accounting & Quantitative Finance', label: 'Accounting & Quant Finance', description: '会计 / 量化金融' },
  { value: 'Computer Science & Data', label: 'Computer Science & Data', description: '计算机 / 数据科学 / AI' },
  { value: 'Engineering & Technology', label: 'Engineering & Technology', description: '工程 / 技术' },
  { value: 'Mathematics & Statistics', label: 'Mathematics & Statistics', description: '数学 / 统计 / 运筹' },
  { value: 'Natural Sciences', label: 'Natural Sciences', description: '物理 / 化学 / 地球科学' },
  { value: 'Life Sciences & Medicine', label: 'Life Sciences & Medicine', description: '生命科学 / 医学 / 健康' },
  { value: 'Architecture & Built Environment', label: 'Architecture & Built Env.', description: '建筑 / 城市 / 房地产' },
  { value: 'Social Sciences', label: 'Social Sciences', description: '社会学 / 心理 / 政治' },
  { value: 'Media & Communication', label: 'Media & Communication', description: '传媒 / 新闻 / 公关' },
  { value: 'Law & Public Policy', label: 'Law & Public Policy', description: '法律 / 公共政策' },
  { value: 'Education', label: 'Education', description: '教育 / TESOL' },
  { value: 'Arts & Design', label: 'Arts & Design', description: '艺术 / 设计 / 时尚' },
  { value: 'Humanities', label: 'Humanities', description: '语言 / 历史 / 哲学' },
  { value: 'Environment & Agriculture', label: 'Environment & Agriculture', description: '环境 / 农业 / 可持续' },
  { value: 'Hospitality & Tourism', label: 'Hospitality & Tourism', description: '酒店 / 旅游 / 会展' },
  { value: 'Other / Interdisciplinary', label: 'Other / Interdisciplinary', description: '其他 / 跨学科' },
]

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
}

/**
 * 展示顺序 —— 按中国学生申请量排,不按字母序。
 * 选校表单和结果页都按这个顺序渲染。
 */
export const REGION_ORDER = [
  'UK', 'AU', 'HK', 'SG', 'CA', 'NZ', 'IE', 'NL', 'DE', 'JP', 'KR', 'MO', 'FR', 'CH',
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
