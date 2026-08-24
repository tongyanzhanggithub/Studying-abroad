import type { RefereeType } from '@prisma/client'

/**
 * 推荐人素材题库。
 *
 * ── 和行业表格的根本区别 ──────────────────────────────
 *
 * 通行的《推荐人信息表格》开头写着「请**以推荐人的口吻**回答以下问题」——
 * 也就是学生替教授把信写好,教授只负责签字。那是代写代签,
 * 院校一旦核实后果是撤销录取,我们不做。
 *
 * 但那份表格问的东西是对的:教了哪门课、什么学期、多少分、班里第几、
 * 带过什么项目、课堂上具体表现如何。**这些正是推荐人真正需要、
 * 但十有八九记不住的东西** —— 一位老师一学期教几百个学生,
 * 记不清某个人哪次作业做得好是完全正常的。
 *
 * 所以这里把同一批问题的**主语和用途**换掉:
 *   行业表格:以推荐人口吻回答 → 产出一封信
 *   这里    :以你自己的口吻回答 → 产出一份**给推荐人的素材**
 *
 * 这些答案存在学生自己这儿,用来在联系推荐人时想起该说什么。
 * 这是院校普遍鼓励的做法(官方指引都建议向推荐人提供 CV 与成绩说明),
 * 与代写有本质区别 —— 信仍然由推荐人自己写、自己签。
 */

export interface RefereeQuestion {
  id: string
  q: string
  hint?: string
  /** 计入进度。其余是补充题 */
  core?: boolean
  long?: boolean
}

export interface RefereeQuestionGroup {
  id: string
  title: string
  why: string
  /** 只对某一类推荐人显示;不给就是两类都要 */
  onlyFor?: RefereeType
  questions: RefereeQuestion[]
}

export const REFEREE_GROUPS: RefereeQuestionGroup[] = [
  {
    id: 'relation',
    title: '你们是怎么认识的',
    why: '推荐信开头必须交代「我以什么身份、认识他多久、在什么情境下了解他」。这段没有具体信息,整封信的可信度就打了折。',
    questions: [
      {
        id: 'relation.how',
        q: '你是在什么场合认识这位老师的?认识多久了?',
        hint: '哪门课、哪个学期开始、是不是导师或项目指导',
        core: true,
        long: true,
      },
      {
        id: 'relation.frequency',
        q: '你们平时接触多吗?都是什么样的接触?',
        hint: '课后提问、邮件请教、办公室答疑、一起做项目 —— 接触越具体,信越有说服力',
        core: true,
        long: true,
      },
    ],
  },
  {
    id: 'course',
    title: '课程与成绩',
    onlyFor: 'academic',
    why: '这是学术推荐信里最硬的证据。「成绩优秀」谁都能写,「某某课 88 分、全班第 3」才是招生官能采信的。',
    questions: [
      {
        id: 'course.which',
        q: '他教过你哪门课?什么学期?',
        hint: '写课程全名,中英文都写上更方便老师直接用',
        core: true,
      },
      {
        id: 'course.grade',
        q: '你这门课的分数和班级排名是多少?',
        hint: '有排名一定写。没有排名的话写「前 X%」也可以,但要是真实的',
        core: true,
      },
      {
        id: 'course.content',
        q: '这门课主要讲什么?对学生的什么能力要求最高?',
        hint: '让老师知道你希望他往哪个能力上写 —— 是建模、写作、还是实证分析',
        core: true,
        long: true,
      },
      {
        id: 'course.performance',
        q: '你在这门课上具体做过什么值得一提的事?',
        hint: '某次课堂展示、某篇课程论文的题目和结论、某次提问、某个小组作业里你负责的部分。**这一条最重要,也最容易被忽略** —— 老师记不住,你得替他想起来',
        core: true,
        long: true,
      },
      {
        id: 'course.relevance',
        q: '这门课和你要申请的方向有什么关系?',
        hint: '帮老师把「他学过什么」和「他要去学什么」连起来',
        long: true,
      },
    ],
  },
  {
    id: 'project',
    title: '一起做过的事',
    onlyFor: 'academic',
    why: '课程之外的共同经历——毕业论文、科研、竞赛、社会实践——往往是推荐信里最生动的部分。',
    questions: [
      {
        id: 'project.what',
        q: '有没有跟着他做过论文、课题、竞赛或调研?',
        hint: '题目是什么、你负责哪部分、他给过什么指导',
        long: true,
      },
      {
        id: 'project.outcome',
        q: '结果怎么样?有没有可量化的产出?',
        hint: '论文发表、竞赛名次、调研样本量、最终评分',
        long: true,
      },
    ],
  },
  {
    id: 'work',
    title: '工作中的表现',
    onlyFor: 'professional',
    why: '职业推荐信要回答的是「他在真实工作里做得怎么样」,而不是复述简历。',
    questions: [
      {
        id: 'work.relation',
        q: '他是你的直接上级吗?你们的汇报关系是什么样的?',
        hint: '直接上级的推荐分量最重。不是的话说明他通过什么了解你的工作',
        core: true,
        long: true,
      },
      {
        id: 'work.duty',
        q: '你在他手下负责什么?',
        hint: '岗位、主要职责、时间跨度',
        core: true,
        long: true,
      },
      {
        id: 'work.project',
        q: '你们一起做过的最重要的一件事是什么?',
        hint: '项目背景、你的角色、遇到的问题、你怎么处理的、结果如何',
        core: true,
        long: true,
      },
      {
        id: 'work.recognition',
        q: '有没有得到过正式的认可?',
        hint: '绩效评级、表彰、转正评价、加薪或晋升',
        long: true,
      },
    ],
  },
  {
    id: 'traits',
    title: '你希望他重点写什么',
    why: '推荐信不该和 PS 说一样的话。想清楚这封信要补足什么,再告诉推荐人。',
    questions: [
      {
        id: 'traits.focus',
        q: '你最希望这封信突出你的哪一两项能力?',
        hint: '和另一位推荐人错开 —— 一封写学术能力,一封写执行力和协作,覆盖面更完整',
        core: true,
        long: true,
      },
      {
        id: 'traits.evidence',
        q: '有什么具体的事能证明这项能力?',
        hint: '一定要是他亲眼见过的事,不然他写不出来,写了也不像真的',
        core: true,
        long: true,
      },
      {
        id: 'traits.concern',
        q: '你的申请材料里有什么需要解释的地方吗?',
        hint: '某学期成绩低、转专业、有间隔年。如果他了解原委,由他来说比你自己说有力得多',
        long: true,
      },
    ],
  },
]

/** 按推荐人类型过滤出该显示的分组 */
export function groupsFor(type: RefereeType): RefereeQuestionGroup[] {
  return REFEREE_GROUPS.filter((g) => !g.onlyFor || g.onlyFor === type)
}

/** 合法问题 id —— server action 的白名单 */
export const ALL_REFEREE_QUESTION_IDS: ReadonlySet<string> = new Set(
  REFEREE_GROUPS.flatMap((g) => g.questions.map((q) => q.id)),
)

/**
 * 推荐人题 → 素材库题的对应关系。
 *
 * ── 为什么要有 ────────────────────────────────────────
 *
 * ⚠️ 学生在素材库已经答过 12 道核心题(成绩、课程项目、优势……),
 *    走到推荐人这里又被问 8 道,内容大量重叠 —— 而这个产品全站都在讲
 *    「一份材料不用交八遍」「经历答一次,所有学校通用」。
 *    唯独这一处自己在让人重复填。
 *
 * ── 为什么是「提示」不是「自动填」──────────────────
 *
 * ⚠️ 两边的**颗粒度不一样**,直接搬会搬出错的事实:
 *
 *      素材库 academic.grades  问的是「整体成绩情况,有没有起伏」
 *      推荐人 course.grade     问的是「他这门课你考了多少、排第几」
 *
 *    把「专业排名前 10%」填进「这门课的排名」,再打包发给老师,
 *    等于让一位教授在信里写一个不准确的数字 —— 这是这个产品
 *    最不能犯的错。所以只做**提示 + 一键填入 + 可改**,
 *    由学生自己判断这条能不能用。
 *
 * ⚠️ 顺序有意义:第一个是最贴切的那条,UI 上优先展示。
 */
export const STORY_HINTS: Record<string, readonly string[]> = {
  'course.which': ['academic.best_courses'],
  'course.grade': ['academic.grades'],
  'course.content': ['academic.best_courses'],
  'course.performance': ['academic.project'],
  'course.relevance': ['motivation.why_program'],
  'project.what': ['academic.project'],
  'project.outcome': ['academic.project'],
  'work.relation': ['work.history'],
  'work.duty': ['work.history'],
  'work.project': ['work.achievement'],
  'work.recognition': ['work.achievement'],
  'traits.focus': ['personal.strength'],
  'traits.evidence': ['academic.project', 'practice.turning_point'],
  // 成绩起伏和转专业原因,素材库里都问过 —— 由老师来解释比学生自己说有力
  'traits.concern': ['academic.grades', 'switch.reason'],
}

/**
 * 明确「素材库里没有对应来源」的推荐人题。
 *
 * ⚠️ 存在的意义是**逼人表态**:新增一道推荐人题时,要么给它配来源,
 *    要么写进这里说明为什么没有。守卫会检查两者之和等于全部题目。
 *
 *    不这么做的话只有两个选择:要么守卫要求 100% 覆盖 ——
 *    那会逼着后来的人给一道本来就没有来源的题硬配一条,
 *    结果是学生把不相干的内容填进去;要么干脆不查,
 *    那新题就会静默地没有提示,而没人发现。
 */
export const NO_STORY_SOURCE: readonly string[] = [
  // 「怎么认识的」「平时接触多不多」是和某位老师绑定的,素材库里不该有
  'relation.how',
  'relation.frequency',
]

/** 某道推荐人题可以参考素材库里的哪几条 */
export function storyHintsFor(refereeQuestionId: string): readonly string[] {
  return STORY_HINTS[refereeQuestionId] ?? []
}

/**
 * 素材完成度。只算核心题,且只算该类型推荐人可见的。
 * (理由同素材库:一个填不满的进度条只会让人放弃。)
 */
export function refereeProgress(
  answers: Record<string, string>,
  type: RefereeType,
): { done: number; total: number; percent: number } {
  const core = groupsFor(type).flatMap((g) => g.questions.filter((q) => q.core))
  const done = core.filter((q) => (answers[q.id] ?? '').trim().length > 0).length
  return {
    done,
    total: core.length,
    percent: core.length ? Math.round((done / core.length) * 100) : 0,
  }
}
