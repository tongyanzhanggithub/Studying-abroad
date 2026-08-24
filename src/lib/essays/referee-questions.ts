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
 * 输出是 buildRefereePacket() 生成的一页纸,学生连同 CV 一起发给老师。
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

/**
 * 生成发给推荐人的素材包(纯文本,方便直接粘进邮件)。
 *
 * ── 为什么是中英混排 ──────────────────────────────────
 *
 * ⚠️ 原来整份是中文的,而**推荐信本身必须是英文的** —— 信是写给英国/美国
 *    院校看的。老师拿到一份纯中文材料,等于把「翻译 + 查官方英文名」
 *    这两件苦力活原样甩回给他。国内老师一学期带几百人,这种材料
 *    大概率的下场是被搁置,而推荐信是全流程里最不能拖的一环。
 *
 *    所以分成三块:
 *      一、固定信息 —— 全英文,可直接照抄(姓名、项目官方英文名、截止日)
 *      二、英文信的常规结构 —— 骨架 + 占位,老师往里填
 *      三、事实与经历 —— 中文,老师用来核对和取用
 *
 * ── 关于「给个模板让老师改」──────────────────────────
 *
 * ⚠️ 国内的实际做法确实是学生给一份稿子、老师改。这里给的是**结构**,
 *    不是成稿:每一处评价性的话都是 [ ] 占位,必须由老师自己填 ——
 *    排第几、有多推荐、哪一点最突出,这些是信的全部价值所在,
 *    也只有老师说了才算数。院校一旦核实信是学生代拟的,后果是撤销录取。
 *
 *    换句话说:苦力活(格式、英文名、结构、截止日)我们包掉,
 *    判断留给老师。这也是这个模块从一开始就写在页面上的立场。
 *
 * ⚠️ 姓名必须用**护照拼音**,不能用中文名或自己拼的。
 *    schema 里 passportSurname 的注释点名列了推荐信:
 *    「成绩单、在读证明、推荐信、网申账号如果拼法不一致,
 *      学校会认为是不同的人,轻则要求补件、重则影响签证。」
 *    而这个函数原来传的是 user.name(中文名)—— 正好踩了那句话。
 */
export function buildRefereePacket(params: {
  /** 护照拼音,如 "ZHANG San"。没填时给 null,输出里会明确要求补 */
  passportName: string | null
  /** 中文名,只用在落款和称呼上 */
  studentName: string
  referee: { name: string; title: string | null; type: RefereeType }
  /** 项目的**官方英文名** —— 信里要用的就是这个 */
  targetPrograms: Array<{ program: string; school: string }>
  /**
   * 最早的截止日。⚠️ 传 ISO(2027-01-15),不要传「2027年1月15日」——
   * 它印在全英文那一块里,中文日期在那儿既突兀,老师照抄进英文信也不合适。
   */
  deadline: string | null
  answers: Record<string, string>
}): string {
  const { passportName, studentName, referee, targetPrograms, deadline, answers } = params
  const out: string[] = []
  const rule = '─'.repeat(46)

  const salutation = referee.title ? `${referee.name}${referee.title}` : `${referee.name}老师`
  out.push(`致 ${salutation}:`)
  out.push('')
  out.push(
    '这是我整理的一份推荐信材料。学校只收英文推荐信,所以我把姓名、项目官方英文名、' +
      '截止日期和信的常规结构都按英文格式整理好了,您可以直接取用。',
  )
  out.push(
    '第三部分是我这边的事实和经历,供您核对取用。信里的评价和措辞完全由您决定 —— ' +
      '我不会代拟,也不会替您签字。',
  )
  out.push('')

  // ── 一、固定信息:全英文,照抄即可 ──────────────────
  out.push(rule)
  out.push('一、写信时要用到的固定信息(可直接照抄)')
  out.push(rule)
  out.push('')
  out.push(
    passportName
      ? `Applicant name (exactly as on passport):  ${passportName}`
      : 'Applicant name:  ⚠️ 我还没填护照拼音 —— 我补好后再发给您,' +
        '因为它必须和成绩单、在读证明上的拼法完全一致。',
  )
  out.push('')
  if (targetPrograms.length) {
    out.push('Programmes applied for:')
    for (const t of targetPrograms) out.push(`  · ${t.program} — ${t.school}`)
    out.push('')
  }
  if (deadline) {
    out.push(`Earliest deadline:  ${deadline}`)
    out.push('')
  }
  out.push('Language:    English(学校不接受中文推荐信,也不接受译文)')
  out.push('Letterhead:  请打印在带学院/单位全称的抬头信笺纸上,并亲笔签名')
  out.push('')

  // ── 二、英文信的常规结构 ────────────────────────────
  out.push(rule)
  out.push('二、英文推荐信的常规结构(方括号处需要您来判断)')
  out.push(rule)
  out.push('')
  for (const line of letterSkeleton(referee.type)) out.push(line)
  out.push('')

  // ── 三、事实与经历 ──────────────────────────────────
  out.push(rule)
  out.push('三、我这边的事实和经历(中文,供您核对和取用)')
  out.push(rule)
  out.push('')
  let any = false
  for (const g of groupsFor(referee.type)) {
    const answered = g.questions.filter((q) => (answers[q.id] ?? '').trim())
    if (!answered.length) continue
    any = true
    out.push(`【${g.title}】`)
    for (const q of answered) {
      out.push(`${q.q}`)
      out.push(`  ${answers[q.id].trim().replace(/\n/g, '\n  ')}`)
    }
    out.push('')
  }
  if (!any) {
    out.push('(我还没填完这部分,补齐后会再发您一版。)')
    out.push('')
  }

  out.push('如果还需要别的材料(成绩单、简历、课程论文),请随时告诉我。')
  out.push('')
  out.push(`${studentName}`)

  return out.join('\n')
}

/**
 * 英文推荐信的骨架。
 *
 * ⚠️ 刻意**只给结构和连接句**,不给评价。
 *    每一处需要判断的地方都是 [ ] —— 认识多久、排第几、有多推荐,
 *    这些是一封推荐信的全部价值,只有推荐人自己说了才算数。
 *    如果这里预填了「top 5%」,那这封信就不再是他的评价,而是我们的。
 *
 * 学术 / 职业两种推荐人的结构不一样:前者围绕课程与研究,
 * 后者围绕岗位与业绩,连称谓和结尾都不同。
 */
function letterSkeleton(type: RefereeType): string[] {
  const common = {
    open: 'To the Admissions Committee,',
    close: [
      '[您的姓名 / Your name]',
      '[职称 / Title], [院系或部门 / Department]',
      '[单位全称 / Institution]',
      '[学校或单位邮箱 / Institutional email]',
    ],
  }

  if (type === 'professional') {
    return [
      common.open,
      '',
      '1) 关系与背景 / How you know the applicant',
      '   I am [职称] at [单位], where I have worked with [Applicant] since [年月]',
      '   as [他/她的直接上级 或 项目负责人]. 参考第三部分「工作中的表现」。',
      '',
      '2) 岗位与职责 / What they were responsible for',
      '   [具体岗位、团队规模、汇报关系]',
      '',
      '3) 一件具体的事 / One concrete example',
      '   [项目背景 → 他/她做了什么 → 结果,尽量带数字]',
      '   —— 第三部分里我写了一件,您也可以换成您印象更深的。',
      '',
      '4) 与同侪的比较 / How they compare',
      '   Among the [N] people I have supervised, [Applicant] is [您的判断].',
      '   ⚠️ 这一段招生官最看重,也最需要您本人的判断。',
      '',
      '5) 推荐结论 / Recommendation',
      '   [您的结论 —— 常见写法:I recommend… / I strongly recommend… /',
      '    I recommend… without reservation。用哪一档由您定,我不预设]',
      '   Please feel free to contact me if further information is required.',
      '',
      ...common.close,
    ]
  }

  return [
    common.open,
    '',
    '1) 关系与背景 / How you know the applicant',
    '   I am [职称] in [院系] at [学校英文全称]. I have known [Applicant]',
    '   since [年月], when they took my course [课程英文名]. 参考第三部分「你们是怎么认识的」。',
    '',
    '2) 课堂表现与成绩 / Academic performance',
    '   [课程内容与难度] · [分数与排名 —— 第三部分有我的数字,请您核对]',
    '',
    '3) 一件具体的事 / One concrete example',
    '   [论文、课题、竞赛或课堂上的某次表现:背景 → 他/她做了什么 → 结果]',
    '   —— 第三部分里我写了几件,您可以挑一件,也可以换成您印象更深的。',
    '',
    '4) 与同侪的比较 / How they compare',
    '   Among the students I have taught, [Applicant] is [您的判断].',
    '   ⚠️ 这一段招生官最看重,也最需要您本人的判断,我这边给不了。',
    '',
    '5) 推荐结论 / Recommendation',
    '   [您的结论 —— 常见写法:I recommend… / I strongly recommend… /',
    '    I recommend… without reservation。用哪一档由您定,我不预设]',
    '   Please feel free to contact me if further information is required.',
    '',
    ...common.close,
  ]
}
