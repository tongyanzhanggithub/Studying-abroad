import type { Direction } from '@prisma/client'

/**
 * 申请方向(Direction) → QS 学科榜的学科。
 *
 * ── 为什么需要这张表 ────────────────────────────────────
 * QS 学科排名(QS World University Rankings by Subject)是按「大学 × 学科」发布的,
 * 而我们的项目是按 Direction 分类的。两边不是一一对应:
 *   · 一个学科对应多个方向 —— 管理、商业分析、国际商务、供应链、人力资源
 *     在 QS 榜上都归 Business & Management Studies
 *   · 有些方向 QS 只有**大类**(broad faculty area)没有细分学科,
 *     如工程、自然科学、人文
 *
 * 有了这张表,项目不用逐个挂排名:按它自己的 direction 去查所在学校的学科排名即可。
 *
 * ── 诚实展示 ────────────────────────────────────────────
 * ⚠️ `broad: true` 表示这一档取的是 QS 的**大类**名次,不是细分学科名次。
 *    两者精度差别很大(「工程与技术」大类第 20 ≠ 「机械工程」第 20),
 *    页面上必须能区分,不能都写成「专业排名」糊弄过去。
 *
 * ⚠️ `subject` 存的是 QS 榜单上的英文原文,和 SchoolSubjectRanking.subject 对齐 ——
 *    榜单怎么写就怎么存,核对来源时能直接对上。中文名只用于展示。
 */
export interface QsSubject {
  /** QS 榜单上的英文学科名,与 SchoolSubjectRanking.subject 一致 */
  subject: string
  /** 展示用中文名 */
  label: string
  /** true = 这是 QS 的大类(faculty area),不是细分学科 */
  broad: boolean
}

/** null = 这个方向在 QS 学科榜上没有对得上的学科,不显示学科排名(见 other) */
export const DIRECTION_QS_SUBJECT: Record<Direction, QsSubject | null> = {
  finance: { subject: 'Accounting & Finance', label: '会计与金融', broad: false },
  accounting: { subject: 'Accounting & Finance', label: '会计与金融', broad: false },
  management: { subject: 'Business & Management Studies', label: '商科与管理', broad: false },
  marketing: { subject: 'Marketing', label: '市场营销', broad: false },
  business_analytics: {
    subject: 'Business & Management Studies',
    label: '商科与管理',
    broad: false,
  },
  economics: { subject: 'Economics & Econometrics', label: '经济学与计量经济学', broad: false },
  international_business: {
    subject: 'Business & Management Studies',
    label: '商科与管理',
    broad: false,
  },
  supply_chain: { subject: 'Business & Management Studies', label: '商科与管理', broad: false },
  hr: { subject: 'Business & Management Studies', label: '商科与管理', broad: false },
  computer_science: {
    subject: 'Computer Science & Information Systems',
    label: '计算机科学与信息系统',
    broad: false,
  },
  data_science_ai: {
    subject: 'Data Science & Artificial Intelligence',
    label: '数据科学与人工智能',
    broad: false,
  },
  engineering: { subject: 'Engineering & Technology', label: '工程与技术', broad: true },
  architecture: {
    subject: 'Architecture & Built Environment',
    label: '建筑与建成环境',
    broad: false,
  },
  mathematics_statistics: { subject: 'Mathematics', label: '数学', broad: false },
  natural_sciences: { subject: 'Natural Sciences', label: '自然科学', broad: true },
  life_sciences_medicine: { subject: 'Life Sciences & Medicine', label: '生命科学与医学', broad: true },
  social_sciences: {
    subject: 'Social Sciences & Management',
    label: '社会科学与管理',
    broad: true,
  },
  media_communication: {
    subject: 'Communication & Media Studies',
    label: '传媒与传播',
    broad: false,
  },
  law_public_policy: { subject: 'Law & Legal Studies', label: '法律', broad: false },
  education: { subject: 'Education & Training', label: '教育', broad: false },
  arts_design: { subject: 'Art & Design', label: '艺术与设计', broad: false },
  humanities: { subject: 'Arts & Humanities', label: '人文与艺术', broad: true },
  environment_sustainability: {
    subject: 'Environmental Sciences',
    label: '环境科学',
    broad: false,
  },
  agriculture_food_science: {
    subject: 'Agriculture & Forestry',
    label: '农业与林业',
    broad: false,
  },
  hospitality_tourism: {
    subject: 'Hospitality & Leisure Management',
    label: '酒店与休闲管理',
    broad: false,
  },
  public_health: { subject: 'Public Health', label: '公共卫生', broad: false },
  /**
   * ⚠️ other 刻意留空。
   *    「其它方向」是个兜底分类,里面什么都可能有 —— 随便挂一个学科名次上去,
   *    等于给用户一个和他项目无关的数字。宁可不显示学科排名。
   */
  other: null,
}

/** 该方向在 QS 学科榜上对应的学科;方向不认识时返回 null,不猜 */
export function qsSubjectOf(direction: Direction | string): QsSubject | null {
  return DIRECTION_QS_SUBJECT[direction as Direction] ?? null
}

/** 库里可能出现的全部学科名(去重),导入脚本用来校验拼写 */
const ALL_SUBJECTS = Object.values(DIRECTION_QS_SUBJECT).filter(
  (s): s is QsSubject => s !== null,
)

export const KNOWN_QS_SUBJECTS: string[] = [
  ...new Set(ALL_SUBJECTS.map((s) => s.subject)),
].sort()

/** 按 QS 原文学科名反查展示信息;库里出现表外的学科时返回 null(原样显示英文) */
export function qsSubjectByName(subject: string): QsSubject | null {
  return ALL_SUBJECTS.find((s) => s.subject === subject) ?? null
}
