/**
 * 个人素材题库。
 *
 * ── 这份题库从哪儿来、又改了什么 ────────────────────────
 *
 * 结构参考了留学行业通行的「PS 素材问题集」——那类表格通常是一份 Word,
 * 学生填完邮件发给顾问,顾问据此写文书。它的问题设计本身是有价值的:
 * 按时间线和维度铺开,逼学生把笼统印象落到具体事例上。
 *
 * 但作为产品,有四处必须改:
 *
 *   1. **答案跟人走,不跟文书走。** 高中、大学、家庭、性格、工作履历
 *      对一个人只有一份;申 8 所学校填 8 遍是没有道理的。
 *      只有「为什么申这个专业/这所学校」跟项目走,那部分留在文书工作台里问。
 *
 *   2. **不收集与文书无关的个人信息。** 原表格问「父母的工作和职位分别是什么」。
 *      这是明确的个人信息,而它对一篇英国硕士 PS 的实际价值很低 ——
 *      招生官关心的是你的学术准备,不是你父母在哪儿上班。
 *      这里只保留「家人对你专业选择的影响」这一层,不问职业、不问收入、不问职位。
 *      收集个人信息要有必要性,这是底线,不是可选项。
 *
 *   3. **该跳过的要真的跳过。** 原表格第七部分写着「对于有工作经历的申请人」,
 *      但纸质表格没法跳,学生得自己判断。这里用 `showIf` 让它真的不出现。
 *
 *   4. **明确哪些不必答。** 原表格说「请务必认真详细回答适合你的每一个问题」,
 *      于是学生对着 35 个问题不知道从哪儿下手。这里区分核心题与补充题,
 *      并且只用核心题算进度 —— 让人能开始,比让人填完更重要。
 */

export interface StoryQuestion {
  /** 一经发布不要改 —— StoryAnswer 靠它关联,改了等于丢答案 */
  id: string
  q: string
  /** 括号里的提示,帮学生知道该往哪个方向想 */
  hint?: string
  /**
   * 核心题:计入进度。
   * 其余是补充题 —— 答了更好,不答不拦着往下走。
   */
  core?: boolean
  /** 多行输入(长回答) */
  long?: boolean
}

export interface StorySection {
  id: string
  title: string
  /** 这一节为什么值得答 —— 不写理由的话,很多问题看起来像在查户口 */
  why: string
  questions: StoryQuestion[]
  /**
   * 何时显示。不给就是一直显示。
   *   hasWorkExperience —— 已毕业,或自述有全职工作经历
   *   isMajorSwitch     —— 转专业申请
   */
  showIf?: 'hasWorkExperience' | 'isMajorSwitch'
}

export const STORY_SECTIONS: StorySection[] = [
  {
    id: 'academic',
    title: '学术背景',
    why: '这是文书里最硬的部分。招生官首先要判断的是你能不能读下来这个项目,而依据就是你已经学过什么、学得怎么样。',
    questions: [
      {
        id: 'academic.why_major',
        q: '当初为什么选了现在这个本科专业?',
        hint: '如果是调剂或家里定的,如实写 —— 后来怎么看待它,反而是更好的素材',
        core: true,
        long: true,
      },
      {
        id: 'academic.best_courses',
        q: '哪几门专业课你学得最投入?具体是什么内容吸引你?',
        hint: '写课程名和具体内容,不要只写「很有兴趣」。最好能说出某个概念或方法让你有什么新认识',
        core: true,
        long: true,
      },
      {
        id: 'academic.grades',
        q: '你的成绩情况怎么样?有没有某个阶段明显起伏?',
        hint: '专业排名、某几门的高分、或者某个学期的低谷及原因。有起伏不是坏事,能解释清楚反而显得诚实',
        core: true,
        long: true,
      },
      {
        id: 'academic.project',
        q: '做过的课程论文、课题或毕业设计里,哪一个最能代表你的能力?',
        hint: '题目是什么、你负责哪部分、用了什么方法、结论是什么、遇到的最大困难怎么解决的',
        core: true,
        long: true,
      },
      {
        id: 'academic.self_study',
        q: '有没有在课堂之外自己学过与专业相关的东西?',
        hint: '读的书或论文、上的网课、参加的讲座或竞赛。写清楚它让你想明白了什么',
        long: true,
      },
      {
        id: 'academic.second_major',
        q: '有辅修、双学位或跨学科课程吗?为什么选它?',
        long: true,
      },
    ],
  },
  {
    id: 'practice',
    title: '实践与经历',
    why: '实习、科研、社团这些经历本身不加分,能说清楚「你从中学到什么、和你要申请的方向有什么关系」才加分。',
    questions: [
      {
        id: 'practice.internship',
        q: '实习或工作里,哪一段对你影响最大?',
        hint: '单位、岗位、你具体做什么。尽量有可量化的部分 —— 处理了多少数据、跟进了几个项目、做出什么结果',
        core: true,
        long: true,
      },
      {
        id: 'practice.turning_point',
        q: '有没有某件具体的事,让你改变了对这个行业或专业的看法?',
        hint: '这类「转折点」是文书里最有说服力的材料,因为它无法编造',
        core: true,
        long: true,
      },
      {
        id: 'practice.difficulty',
        q: '哪一次是你觉得最难、但最后做成了的?',
        hint: '难在哪里、你当时怎么判断、做了什么、结果如何。没做成也可以写,写清楚你从中学到什么',
        core: true,
        long: true,
      },
      {
        id: 'practice.teamwork',
        q: '团队合作里你通常承担什么角色?举一个具体例子。',
        long: true,
      },
      {
        id: 'practice.extracurricular',
        q: '社团、志愿服务、竞赛或其他课外投入?',
        hint: '和申请方向无关也可以写,它反映你怎么安排时间和精力',
        long: true,
      },
    ],
  },
  {
    id: 'motivation',
    title: '申请动机与规划',
    why: '几乎每所学校的文书题目都会问到这一块。这里答的是通用版本,具体到某所学校的理由在文书工作台里单独写。',
    questions: [
      {
        id: 'motivation.why_program',
        q: '为什么要读这个方向的硕士?',
        hint: '避免「提升自己」「深造」这类谁都能写的话。具体到你想解决什么问题、补上哪块能力',
        core: true,
        long: true,
      },
      {
        id: 'motivation.why_abroad',
        q: '为什么选择去海外读,而不是在国内?',
        hint: '课程设置、研究方向、行业环境、某位学者的工作 —— 越具体越好',
        core: true,
        long: true,
      },
      {
        id: 'motivation.career',
        q: '毕业后想做什么?五年内的打算是什么?',
        hint: '行业、岗位类型、想具备什么能力。不确定也可以写,写清楚你在权衡什么',
        core: true,
        long: true,
      },
      {
        id: 'motivation.gap',
        q: '你觉得自己目前最欠缺什么?打算怎么补?',
        hint: '文书里承认短板并给出应对,比通篇优点更可信',
        core: true,
        long: true,
      },
      {
        id: 'motivation.contribution',
        q: '你能给这个项目的课堂带来什么别人没有的东西?',
        hint: '不同的本科背景、行业经验、跨文化经历、某项技能都算',
        long: true,
      },
    ],
  },
  {
    id: 'switch',
    title: '转专业说明',
    showIf: 'isMajorSwitch',
    why: '跨专业申请时,这一节是招生官最想看到答案的地方 —— 他要确认你不是一时冲动,而且跟得上课程。',
    questions: [
      {
        id: 'switch.reason',
        q: '为什么要换方向?',
        hint: '什么时候开始有这个想法、由什么事促成的',
        core: true,
        long: true,
      },
      {
        id: 'switch.bridge',
        q: '你原来的专业在哪些地方为新方向做了准备?',
        hint: '共通的方法论、工具、思维方式、修过的相关课程',
        core: true,
        long: true,
      },
      {
        id: 'switch.preparation',
        q: '为了转过去,你已经做了什么?',
        hint: '自学的课程、考的证书、做过的项目、相关实习。这一条最能证明你是认真的',
        core: true,
        long: true,
      },
    ],
  },
  {
    id: 'work',
    title: '工作经历',
    showIf: 'hasWorkExperience',
    why: '有工作经验的申请人,这一节的分量往往超过在校成绩 —— 它是你和应届生最大的区别。',
    questions: [
      {
        id: 'work.history',
        q: '按时间顺序说一下你的工作履历。',
        hint: '单位、职位、时间段、主要职责',
        core: true,
        long: true,
      },
      {
        id: 'work.achievement',
        q: '工作中最拿得出手的成果是什么?',
        hint: '尽量量化。带过多大的团队、做成多大的项目、指标改善了多少',
        core: true,
        long: true,
      },
      {
        id: 'work.why_now',
        q: '为什么现在选择回学校读书?',
        hint: '工作中遇到的哪个瓶颈是靠继续工作解决不了的',
        core: true,
        long: true,
      },
    ],
  },
  {
    id: 'personal',
    title: '你这个人',
    why: '文书最后要让人记住的是一个具体的人。这一节的答案未必直接写进去,但决定了整篇文书的语气。',
    questions: [
      {
        id: 'personal.strength',
        q: '你觉得自己最突出的特点是什么?用一件具体的事说明。',
        hint: '只写形容词没有说服力,一定要配事例',
        core: true,
        long: true,
      },
      {
        id: 'personal.weakness',
        q: '你的短板是什么?它给你造成过什么麻烦?',
        hint: '真实的短板比包装过的「我太追求完美」有用得多',
        long: true,
      },
      {
        id: 'personal.influence',
        q: '有没有哪个人对你的专业选择影响很大?',
        hint: '老师、同学、家人、某个从业者都可以。写清楚是怎么影响的',
        long: true,
      },
      {
        id: 'personal.interest',
        q: '专业之外,你长期在做的事情是什么?',
        hint: '爱好、副业、长期坚持的习惯。坚持本身就是一种说明',
        long: true,
      },
    ],
  },
]

/** 上下文,决定哪些小节要显示 */
export interface StoryContext {
  hasWorkExperience: boolean
  isMajorSwitch: boolean
}

/** 按上下文过滤出该显示的小节 */
export function visibleSections(ctx: StoryContext): StorySection[] {
  return STORY_SECTIONS.filter((s) => {
    if (!s.showIf) return true
    if (s.showIf === 'hasWorkExperience') return ctx.hasWorkExperience
    if (s.showIf === 'isMajorSwitch') return ctx.isMajorSwitch
    return true
  })
}

/**
 * 进度。
 *
 * ⚠️ 只算**核心题**,而且只算当前可见小节里的。
 *    把补充题也算进去的话,一份认真答完的素材库也就到 60% ——
 *    而一个怎么都填不满的进度条只会让人放弃。
 *    (材料中心的可选材料是同一个道理。)
 */
export function storyProgress(
  answers: Record<string, string>,
  ctx: StoryContext,
): { done: number; total: number; percent: number } {
  const core = visibleSections(ctx).flatMap((s) => s.questions.filter((q) => q.core))
  const done = core.filter((q) => (answers[q.id] ?? '').trim().length > 0).length
  return {
    done,
    total: core.length,
    percent: core.length ? Math.round((done / core.length) * 100) : 0,
  }
}

/** 题库里所有合法的问题 id —— 用于拒绝伪造的 questionId */
export const ALL_QUESTION_IDS: ReadonlySet<string> = new Set(
  STORY_SECTIONS.flatMap((s) => s.questions.map((q) => q.id)),
)

/**
 * 把已有答案整理成给模型看的文本。
 *
 * ⚠️ 只带**答过的**题。把空题也列出去,等于告诉模型「这些他没答」,
 *    模型就会挨个补问 —— 而素材访谈的价值在于**顺着已有的往下深挖**,
 *    不是把表格再念一遍。
 */
export function formatAnswersForPrompt(answers: Record<string, string>): string {
  const lines: string[] = []
  for (const section of STORY_SECTIONS) {
    const answered = section.questions.filter((q) => (answers[q.id] ?? '').trim())
    if (!answered.length) continue
    lines.push(`【${section.title}】`)
    for (const q of answered) {
      lines.push(`Q: ${q.q}`)
      lines.push(`A: ${answers[q.id].trim()}`)
    }
    lines.push('')
  }
  return lines.join('\n').trim() || '(学生还没有填写素材库)'
}
