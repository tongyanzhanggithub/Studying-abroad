/**
 * 种子数据
 *   npm run db:seed
 *
 * 内容:套餐档位、材料模板库、增值服务 SKU、推荐规则、通知模板、
 *       prompt 模板、定位规则系数表、后台账号。
 *
 * 这些全部是**运营可在后台修改的配置**,种子只提供一份合理初值。
 */

import {
  PrismaClient,
  type Direction,
  type EnrollmentStatus,
  type Region,
  type UndergradTier,
} from '@prisma/client'
import { hashPassword } from '../src/lib/auth/password'

const db = new PrismaClient()

async function seedPlans() {
  /**
   * 三档只有**时长**不同,功能完全一样 —— 买得久单价更低。
   *
   * 定价:月票 ¥30/月;申请季票 = 30×9 打 9 折;年票 = 30×12 打 8.5 折。
   * 不再区分「基础版 / Pro」:在 ¥30 这个价位再分两档,差价小到没有意义,
   * 却要用户多做一次选择,还得琢磨「Pro 那些权益我用不用得上」。
   */
  /**
   * ⚠️ 这里**刻意不写 AI 文书**那一条。
   *
   *    LLM 还没接(LLM_PROVIDER=mock),把一个还不能用的能力写进付费权益,
   *    等于卖一个不存在的东西 —— 用户付了钱点进去发现是占位内容,
   *    这是最容易招退款和投诉的一类文案。真正接上并跑通之后再加回来。
   */
  const FEATURES = [
    '看全部学校的完整要求,自己组选校名单',
    '材料清单自动列好,交没交一眼看清',
    '快截止了提前提醒你',
    '学校要求有变,第一时间告诉你',
  ]

  const plans = [
    {
      code: 'monthly',
      name: '月票',
      priceCents: 3000, // ¥30 / 月
      durationMonths: 1,
      aiDailyQuota: 30,
      sort: 1,
      // 面向学生的说法,不用「院校库」「工作台」这类内部用词
      features: { items: [...FEATURES, '按月付,随时不续'] },
    },
    {
      code: 'season',
      name: '申请季票 · 9 个月',
      priceCents: 24300, // 30×9=270,9 折 → ¥243
      durationMonths: 9,
      aiDailyQuota: 30,
      sort: 2,
      features: {
        items: [...FEATURES, '覆盖一个完整申请季', '相当于每月 ¥27,比月付省 ¥27'],
      },
    },
    {
      code: 'annual',
      name: '年票 · 12 个月',
      priceCents: 30600, // 30×12=360,8.5 折 → ¥306
      durationMonths: 12,
      aiDailyQuota: 30,
      sort: 3,
      features: {
        items: [...FEATURES, '够跨两个申请季', '相当于每月 ¥25.5,比月付省 ¥54'],
      },
    },
  ]

  for (const p of plans) {
    await db.plan.upsert({
      where: { code: p.code },
      create: p,
      update: {
        name: p.name,
        priceCents: p.priceCents,
        features: p.features,
        aiDailyQuota: p.aiDailyQuota,
        durationMonths: p.durationMonths,
        sort: p.sort,
      },
    })
  }
  /**
   * 停用已下架的旧套餐(basic / pro)。
   *
   * ⚠️ 不能删:已有订阅通过外键指向它们,删了会让老用户的订阅记录断链,
   *    「我买的是什么」这个问题就再也答不上来了。停用即可 ——
   *    active=false 的套餐不出现在定价页,但历史订阅照常可查。
   */
  const retired = await db.plan.updateMany({
    where: { code: { notIn: plans.map((p) => p.code) }, active: true },
    data: { active: false },
  })
  if (retired.count > 0) console.log(`· 已停用 ${retired.count} 个旧套餐(历史订阅不受影响)`)

  console.log(`✓ 套餐 ${plans.length} 个`)
}

async function seedMaterialTemplates() {
  /**
   * 材料模板。
   *
   * ── 每个字段的意义 ──────────────────────────────────────
   *   leadTimeDays   从开始办到拿到手要多久,是「提前预警」的唯一依据
   *   copiesRequired 要几份纸质原件 —— 只开一份、到寄材料时才发现不够,
   *                  就得再跑一趟教务处,而教务处不是随时能办的
   *   issuedBy       谁开、盖什么章 —— 学生去办事时唯一要记住的那句话
   *   optional       有则加分、没有不影响申请。不计入完成度
   *   forEnrollment  只在「在读」或「已毕业」时出现(两者互斥)
   *
   * ⚠️ guideMd 里凡是涉及**费用、时限、办事地点**的,一律写通行规则并注明
   *    「以当地公布为准」。写死一个城市一个价格,过一年就是错的,
   *    而学生会照着它真的跑一趟。
   */
  const templates = [
    {
      code: 'transcript', name: '成绩单', sort: 1, sharedAcrossPrograms: true, leadTimeDays: 7,
      copiesRequired: 2,
      issuedBy: '本科教务处开具,加盖教务处公章(红章)',
      description: '本科阶段全部课程成绩,需中英文对照并加盖教务处公章',
      guideMd: [
        '找本科教务处开具中英文对照成绩单,通常 3-5 个工作日。',
        '',
        '**为什么要两份以上**:多数学校要求纸质原件密封邮寄,寄出去就不退。',
        '一次多开 3-5 份备用,比事后再跑一趟省事得多 —— 尤其你已经离校的话。',
        '',
        '**学校出不了英文版怎么办**:',
        '1. 找有资质的翻译机构翻译(要有翻译专用章)',
        '2. 把译件带回教务处,请他们在**译件上**也盖章',
        '3. 中英文两份一起装进密封信封,骑缝处盖章',
        '',
        '⚠️ 只有翻译章、没有学校章的成绩单,不少学校不认。',
      ].join('\n'),
    },
    {
      code: 'enrollment_certificate', name: '在读证明', sort: 2, sharedAcrossPrograms: true,
      leadTimeDays: 7, copiesRequired: 2, forEnrollment: 'enrolled',
      issuedBy: '学院或教务处开具,加盖公章',
      description: '在读学生用。需写明入学时间、年级、专业、学制与预计毕业时间',
      guideMd: [
        '在读证明要**中英文各一份**,内容必须包含:',
        '',
        '- 姓名、性别、出生日期(与护照一致)',
        '- 入学时间、现读年级、学制',
        '- 院系与专业全称',
        '- 预计毕业时间',
        '',
        '**打印在哪儿**:有学校全称抬头的信笺纸(暗格或空白均可)。',
        '普通 A4 白纸打出来盖个章,不少学校会退回重开。',
        '',
        '**学校没有英文模板时**:可以自己按上面的要素拟一份中英对照的,',
        '拿去请教务处审核盖章 —— 大多数学校接受这种做法。',
        '',
        '⚠️ 姓名拼音必须和护照上完全一致,不要用自己习惯的拼法。',
      ].join('\n'),
    },
    {
      code: 'degree_certificate', name: '学位证 / 毕业证', sort: 3, sharedAcrossPrograms: true,
      leadTimeDays: 7, forEnrollment: 'graduated',
      issuedBy: '原件扫描;翻译件由翻译机构出具并加盖翻译专用章',
      description: '已毕业学生用。学位证 + 毕业证两证都要,中英文对照',
      guideMd: [
        '**两证都要**:毕业证(学历)和学位证(学位)在国内是两份不同的证书,',
        '只交一份经常会被要求补件。',
        '',
        '原件扫描成彩色 PDF,连同翻译件一起提交。翻译件需有翻译机构的翻译专用章。',
        '',
        '**建议同时准备**:学信网《教育部学历证书电子注册备案表》中英文版,',
        '可在学信网自助打印。越来越多学校用它来核验学历真伪,',
        '而且免费、当场就能出。',
      ].join('\n'),
    },
    {
      code: 'cv', name: '简历(CV)', sort: 4, sharedAcrossPrograms: true, leadTimeDays: 5,
      description: '1 页 A4,学术与实习经历为主',
      guideMd: [
        '学术申请的 CV 和求职简历不是一回事:',
        '',
        '- **教育背景放最前**,写明 GPA 与核心课程(求职简历通常放后面)',
        '- 实习/科研经历用**量化成果**描述,不要写岗位职责',
        '- 相关的课程论文、项目报告可以单列一节',
        '- 控制在 1 页;有科研发表的可以到 2 页',
        '',
        '⚠️ CV 上的每一段经历都要能对应上材料 —— 写了实习就要有实习证明,',
        '写了获奖就要有证书。写了却拿不出证明的经历,反而是风险。',
      ].join('\n'),
    },
    {
      // PS 要写好几稿,而且每校不同,不是一两天的事
      code: 'personal_statement', name: '个人陈述(PS)', sort: 5, sharedAcrossPrograms: false,
      leadTimeDays: 21, fileRequired: false,
      description: '各校题目与字数要求不同,需针对性撰写',
      guideMd: [
        '在「文书工作台」中撰写。每所学校的题目和字数限制不同,不要直接复用。',
        '',
        '**动手前先把素材问清楚**:工作台的素材访谈会按高中、大学、申请动机、',
        '实践经历、职业规划几条线追问,你答得越具体,后面越好写。',
        '大多数人卡住不是不会写,是没想清楚要写什么。',
        '',
        '⚠️ 文字必须是你自己的。部分院校对 AI 辅助写作零容忍,',
        '工作台会在这些学校的文书上显著标注。',
      ].join('\n'),
    },
    {
      // 推荐人不是你能催的,官方建议就是提前 4-6 周
      code: 'reference', name: '推荐信', sort: 6, sharedAcrossPrograms: false, leadTimeDays: 42,
      copiesRequired: 2,
      issuedBy: '推荐人本人出具并签字;学术推荐信打印在学校抬头信笺纸上',
      description: '通常 2 封,学术推荐人优先',
      guideMd: [
        '主流英语授课硕士项目通常要求 2 封,其中至少 1 封更适合来自学术推荐人。',
        '',
        '**提前 4-6 周联系推荐人**,并同时提供:',
        '- 你的 CV',
        '- 目标专业与院校清单',
        '- 你在他课上的具体表现(哪门课、哪个学期、分数、做过什么作业或项目)',
        '',
        '最后一项最容易被忽略。老师一学期教几百人,记不住细节很正常;',
        '你把细节递到他手上,写出来的推荐信才有具体事例,而不是一堆形容词。',
        '',
        '**推荐人怎么选**:教过你的课任老师即可,不必是专业课;',
        '通常要求副教授及以上。给你打过高分、带过你做项目的优先。',
        '',
        '⚠️ **推荐信必须由推荐人本人出具、本人签字。**',
        '找人代写代签是学术诚信问题 —— 院校一旦核实,后果是撤销录取并可能通报,',
        '影响远超这一次申请。我们不提供也不协助任何形式的代签。',
      ].join('\n'),
    },
    {
      // 报名 → 考试 → 出分 → 送分,两个月是保守估计
      code: 'english_test', name: '语言成绩(雅思/托福)', sort: 7, sharedAcrossPrograms: true,
      leadTimeDays: 60,
      description: '需在成绩有效期内(通常 2 年)',
      guideMd: [
        '雅思/托福成绩单需在官网送分给目标院校。',
        '',
        '**注意小分**:总分够但单项不够同样会被拒,这是最常见的踩坑点。',
        '',
        '**可以后补**:多数学校允许先递交申请、后补语言成绩,拿到的是',
        '有条件录取(Conditional Offer)。但要留意两个时间点 ——',
        '',
        '- 想配语言班的,通常要在入学当年**春季**就有达标分数,否则名额没了',
        '- 换无条件录取(Unconditional)的截止时间一般在入学当年**年中**',
        '',
        '具体日期各校不同,以录取信上写的为准。',
      ].join('\n'),
    },
    {
      code: 'gmat_gre', name: 'GMAT / GRE 成绩', sort: 8, sharedAcrossPrograms: true,
      leadTimeDays: 60, fileRequired: false,
      description: '部分商科项目要求或强烈建议提交',
      guideMd: [
        '新加坡、法国高商等部分商科项目会要求或强烈建议提交 GMAT/GRE;',
        '其他地区多为可选加分项。成绩有效期通常 5 年。',
        '',
        '系统会按项目官网写明的要求,只在**确实需要**的项目上列出这一项 ——',
        '不要求的学校不会让你白准备。',
      ].join('\n'),
    },
    {
      code: 'passport', name: '护照', sort: 9, sharedAcrossPrograms: true, leadTimeDays: 14,
      issuedBy: '户籍地或居住地公安机关出入境管理部门,须本人到场',
      description: '信息页扫描件。有效期需覆盖入学后至少 6 个月',
      guideMd: [
        '**为什么要早办**:不少学校在**递交申请时**就要填护照号码,',
        '而不是拿到录取之后才要。没有护照会卡住网申。',
        '',
        '**怎么办**:',
        '1. 本人到出入境管理部门(**不能代办**),带身份证原件及复印件',
        '2. 现场领表填写,或提前网上预约',
        '3. 交照片(不合要求的可在现场照相点重拍)',
        '4. 缴费,拿回执',
        '5. 按回执上的时间去领,或选择邮寄到家',
        '',
        '**普通护照工本费 120 元**,法定办理时限 10 个工作日,多数地方更快。',
        '2019 年起全国范围内**异地可办**,不必回户籍地 ——',
        '老攻略里「外地户口要回原籍、时间更长」的说法已经过时。',
        '',
        '⚠️ 具体费用、时限与预约方式以**当地出入境管理部门公布**为准。',
        '',
        '**已有护照的**:检查有效期,必须覆盖到入学后至少 6 个月,',
        '不够的话现在就去换发。',
      ].join('\n'),
    },
    {
      code: 'id_document', name: '身份证', sort: 10, sharedAcrossPrograms: true, leadTimeDays: 1,
      description: '正反面扫描件',
      guideMd: '港澳院校申请通常需要身份证扫描件。正反面扫在同一页,彩色。',
    },
    {
      code: 'internship_certificate', name: '实习 / 工作证明', sort: 11, sharedAcrossPrograms: true,
      leadTimeDays: 14,
      issuedBy: '实习或工作单位人事部门开具,加盖单位公章',
      description: 'CV 上写了的实习或工作经历,都应当有对应证明',
      guideMd: [
        '**在读学生**开实习证明,**已毕业**的开在职或离职证明。',
        '',
        '内容要包含:姓名、部门、职位、起止时间、主要工作内容,',
        '最后由单位签字盖章。打印在有单位抬头的纸上最好。',
        '',
        '**为什么重要**:CV 和 PS 里提到的每段经历,都可能被要求提供佐证。',
        '写了却拿不出证明,比不写更糟。',
        '',
        '**建议实习结束时就开**:等到申请季再回去找前公司,',
        '经手人可能已经离职,盖章会变得很麻烦。这是最常见的后悔项之一。',
      ].join('\n'),
    },
    {
      code: 'award_certificate', name: '获奖 / 奖学金证书', sort: 12, sharedAcrossPrograms: true,
      leadTimeDays: 3, optional: true, fileRequired: false,
      description: '加分项。奖学金、竞赛获奖、荣誉称号、职业资格证书等',
      guideMd: [
        '有就交,没有不影响申请 —— 这一项**不计入材料完成度**。',
        '',
        '值得交的:专业相关竞赛获奖、国家/校级奖学金、职业资格证书',
        '(CFA、ACCA、法律职业资格等)、语言类以外的技能证书。',
        '',
        '**不必凑数**:交一堆「优秀班干部」不会加分,反而稀释真正有含金量的那几项。',
        '中文证书需附翻译件。',
      ].join('\n'),
    },
    {
      code: 'research_output', name: '论文 / 项目报告', sort: 13, sharedAcrossPrograms: true,
      leadTimeDays: 3, optional: true, fileRequired: false,
      description: '加分项。已发表论文、课程论文、研究项目报告、毕业设计等',
      guideMd: [
        '有就交,没有不影响申请 —— 这一项**不计入材料完成度**。',
        '',
        '研究型项目(MRes / MPhil / PhD)或对学术背景要求高的专业,这一项权重明显更高。',
        '',
        '没有正式发表也可以交课程论文或项目报告,选**和申请方向最相关**的一篇,',
        '附一段中英文摘要,说明研究问题和你自己的贡献。',
      ].join('\n'),
    },
    {
      code: 'letterhead_paper', name: '学校抬头信笺纸', sort: 14, sharedAcrossPrograms: true,
      leadTimeDays: 7, fileRequired: false,
      issuedBy: '院系办公室或教务处领取',
      description: '准备事项。在读证明与学术推荐信都需打印在带学校全称的信笺纸上',
      guideMd: [
        '这不是要上传的文件,是**要提前去领的东西**。',
        '',
        '在读证明和学术推荐信都需要打印在有学校全称抬头的信笺纸上',
        '(暗格或空白均可)。普通 A4 白纸经常被退回重开。',
        '',
        '**一次多领几张**:推荐信两封、在读证明两份,再算上写错重打的,',
        '建议至少领 10 张。你还在校时领很容易,离校之后就麻烦了。',
      ].join('\n'),
    },
    {
      code: 'intl_credit_card', name: '国际信用卡(Visa / Mastercard)', sort: 15,
      sharedAcrossPrograms: true, leadTimeDays: 21, fileRequired: false,
      description: '准备事项。用于支付申请费、留位费、住宿定金等外币支出',
      guideMd: [
        '这不是要上传的文件,是**要提前办好的东西**。',
        '',
        '申请季会有几笔必须刷外币卡的支出:',
        '- 申请费(部分学校收,每所几十到一百多英镑)',
        '- **留位费**(收到录取后交,通常上千英镑)',
        '- 宿舍定金',
        '',
        '⚠️ 留位费是有**截止日期**的,过期录取会被取消。',
        '而办卡从申请到拿到手通常要两三周 —— 等收到录取再去办,时间往往不够。',
        '',
        '本人办不下来的,可以用父母的附属卡,或提前确认学校是否支持电汇。',
      ].join('\n'),
    },
  ]

  for (const t of templates) {
    const data = {
      code: t.code,
      name: t.name,
      description: t.description,
      guideMd: t.guideMd,
      sort: t.sort,
      leadTimeDays: t.leadTimeDays,
      sharedAcrossPrograms: t.sharedAcrossPrograms ?? true,
      copiesRequired: t.copiesRequired ?? 1,
      issuedBy: t.issuedBy ?? null,
      optional: t.optional ?? false,
      fileRequired: t.fileRequired ?? true,
      forEnrollment: (t.forEnrollment ?? null) as EnrollmentStatus | null,
    }
    await db.materialTemplate.upsert({
      where: { code: t.code },
      create: data,
      /**
       * ⚠️ update 必须把**每一个**字段都列上。
       *    漏掉的字段在已有数据的库上永远不会被刷新 —— 表现是
       *    「代码里改了、线上还是旧的」,而且不报错、不报警,
       *    只有有人恰好去看那条材料才会发现。
       */
      update: data,
    })
  }
  console.log(`✓ 材料模板 ${templates.length} 个`)
}

async function seedServiceSkus() {
  const skus = [
    {
      code: 'strategy_consult', name: '1对1选校规划课 60min', priceCents: 120000,
      delivererRole: '选校规划老师', deliveryForm: '视频会议(腾讯会议)', slaHours: 72, sort: 1,
      description: '选校规划老师结合你的背景与目标,梳理冲刺/匹配/保底梯度,给出可执行的选校方案。',
    },
    {
      code: 'essay_review', name: '文书老师深度终审(单篇)', priceCents: 150000,
      delivererRole: '文书老师', deliveryForm: '批注文档回传 + 15min 语音讲解', slaHours: 48, sort: 2,
      description: '招生官视角的结构与说服力审阅,逐段批注修改建议。不代写,只给判断。',
    },
    {
      code: 'mock_interview', name: '真人模拟面试', priceCents: 100000,
      delivererRole: '面试老师', deliveryForm: '视频面试 45min + 书面反馈', slaHours: 72, sort: 3,
      description: '目标院校在读学生模拟真实面试流程,面后给出书面改进建议。',
    },
    {
      code: 'hard_case', name: '疑难背景会诊课', priceCents: 200000,
      delivererRole: '资深规划老师', deliveryForm: '视频 60min + 书面方案', slaHours: 72, sort: 4,
      description: '资深规划老师针对低 GPA、转专业、跨度大、gap year 等背景,给出申请策略。',
    },
    {
      code: 'full_service', name: '全程主理老师陪跑', priceCents: 1280000,
      delivererRole: '主理老师', deliveryForm: '全季跟进', slaHours: 72, sort: 5,
      description: '整个申请季由主理老师一对一跟进。已购单点服务可抵扣升级差价。',
    },
  ]

  for (const s of skus) {
    await db.serviceSku.upsert({
      where: { code: s.code },
      create: s,
      update: { name: s.name, priceCents: s.priceCents, description: s.description, slaHours: s.slaHours },
    })
  }
  console.log(`✓ 服务 SKU ${skus.length} 个`)
}

/**
 * 推荐规则(PRD 4.7 表格)。
 * 文案刻意保守 —— 不制造焦虑,不虚构统计数字({pct} 样本不足时会渲染为 0 并被隐藏)。
 */
async function seedRecommendationRules() {
  const skuMap = Object.fromEntries(
    (await db.serviceSku.findMany()).map((s) => [s.code, s.id]),
  )

  const rules = [
    {
      code: 'reach_heavy', name: '冲刺档过多 → 选校咨询',
      skuId: skuMap.strategy_consult, placement: 'schools_top', priority: 10,
      trigger: { op: 'all', conditions: [{ type: 'school_tier_count', tier: 'reach', gte: 2 }] },
      copyTemplate: '你的选校单里有 {n} 所属于冲刺档。如果想再确认一遍梯度是否合理,可以约一次 1v1 选校咨询。',
    },
    {
      code: 'essay_third_round', name: '文书第3轮润色 → 人工终审',
      skuId: skuMap.essay_review, placement: 'essay_sidebar', priority: 10,
      trigger: { op: 'any', conditions: [
        { type: 'essay_polish_round', gte: 3 },
        { type: 'deadline_approaching', withinDays: 14, essayNotFinal: true },
      ] },
      copyTemplate: 'AI 能保证语言质量,但「招生官会不会被说服」是另一回事。需要的话可以加购一次人工终审。',
    },
    {
      code: 'interview_invited', name: '收到面试邀请 → 模拟面试',
      skuId: skuMap.mock_interview, placement: 'dashboard_school_row', priority: 20,
      trigger: { op: 'all', conditions: [{ type: 'application_status', status: 'interview_invited' }] },
      copyTemplate: '{school} 给了面试。可以约一位该校在读学长学姐做一次模拟面试。',
    },
    {
      code: 'difficult_case', name: '低GPA或转专业 → 疑难会诊',
      skuId: skuMap.hard_case, placement: 'assess_result', priority: 10,
      trigger: { op: 'any', conditions: [
        { type: 'gpa_below', value: 80 },
        { type: 'major_switch' },
      ] },
      copyTemplate: '你的背景有一些需要特别策略的地方。如果想听听资深规划老师怎么看,可以约一次会诊。',
    },
    {
      code: 'upgrade_bundle', name: '已购2项 → 陪跑包升级',
      skuId: skuMap.full_service, placement: 'services_top', priority: 5,
      trigger: { op: 'all', conditions: [{ type: 'purchased_service_count', gte: 2 }] },
      copyTemplate: '你已经买过 {n} 项单点服务。升级到全程陪跑包的话,已付金额可以抵扣。',
    },
  ]

  for (const r of rules) {
    if (!r.skuId) continue
    await db.recommendationRule.upsert({
      where: { code: r.code },
      create: r as never,
      update: { copyTemplate: r.copyTemplate, trigger: r.trigger as object, placement: r.placement },
    })
  }
  console.log(`✓ 推荐规则 ${rules.length} 条`)
}

async function seedNotificationTemplates() {
  const templates = [
    {
      code: 'deadline_14d', channel: 'wechat_subscribe' as const, mandatory: true,
      title: '还有 14 天截止', bodyTpl: '{school} {program} 将于 {date} 截止申请,你还有 {pending} 项材料未完成。',
    },
    {
      code: 'deadline_7d', channel: 'wechat_subscribe' as const, mandatory: true,
      title: '还有 7 天截止', bodyTpl: '{school} {program} 将于 {date} 截止,请尽快完成剩余材料。',
    },
    {
      code: 'deadline_3d', channel: 'sms' as const, mandatory: true,
      title: '还有 3 天截止', bodyTpl: '【Compass】{school} 申请将于 {date} 截止,请尽快递交。',
    },
    {
      code: 'deadline_1d', channel: 'sms' as const, mandatory: true,
      title: '明天截止', bodyTpl: '【Compass】{school} 申请明天截止,请立即检查递交状态。',
    },
    {
      code: 'program_changed', channel: 'wechat_subscribe' as const, mandatory: false,
      title: '你申请的项目有变动', bodyTpl: '{school} {program} 的 {field} 有更新:{summary}。点击查看影响与建议。',
    },
    {
      code: 'weekly_digest', channel: 'email' as const, mandatory: false,
      title: '本周申请进展', bodyTpl: '本周你完成了 {done} 项待办,下周有 {upcoming} 个截止日期临近。',
    },
    // 服务交付发生在系统之外,不通知的话学生从付款到收货之间是完全黑的
    {
      code: 'service_assigned', channel: 'wechat_subscribe' as const, mandatory: true,
      title: '你的服务已安排交付人',
      bodyTpl: '「{service}」已安排给 {deliverer}({role}),承诺 {sla} 小时内交付。对方会主动联系你。',
    },
    {
      code: 'service_delivered', channel: 'wechat_subscribe' as const, mandatory: true,
      title: '你的服务已交付,请验收',
      bodyTpl: '「{service}」已交付:{note}。请在订单页确认;48 小时无异议将自动确认。有问题请点「提出异议」。',
    },
  ]

  for (const t of templates) {
    await db.notificationTemplate.upsert({
      where: { code: t.code },
      create: t,
      update: { title: t.title, bodyTpl: t.bodyTpl },
    })
  }
  console.log(`✓ 通知模板 ${templates.length} 个`)
}

/**
 * AI prompt 模板(PRD 4.5)。
 *
 * ⚠️ 合规红线:苏格拉底式追问,**禁止直接生成整段文书**。
 *    每个 prompt 里都显式写入这条约束,防止模型越界。
 */
async function seedPromptTemplates() {
  const prompts = [
    {
      code: 'essay_interview', version: 1,
      system: `你是一位留学文书辅导老师,正在帮助学生挖掘个人素材。

【绝对约束 —— 违反即为失职】
1. 你**永远不能**替学生写出可以直接使用的文书段落或整篇文书。
2. 你的任务是**提问**,不是**代笔**。学生的经历只有学生自己知道。
3. 如果学生要求你「直接帮我写一段」,你要礼貌拒绝,并解释:代写在多数院校属于学术不诚信,而且招生官能看出来。然后继续用提问帮他自己写出来。

【你的工作方式】
- 一次只问一个问题,像真人对话
- 用苏格拉底式追问:学生给出笼统回答时,追问具体的时间、数字、冲突、转折、他当时的判断
- 重点挖掘四类素材:相关经历、真实动机、可量化的成果、与目标项目的具体匹配点
- 学生说「我做过一个项目」时,追问:项目多大规模?你具体负责什么?遇到的最大障碍是什么?你怎么解决的?结果用数字怎么描述?

【语气】
平实、有耐心。不要过度赞美,不要说「太棒了」。学生需要的是把话说清楚,不是被夸。`,
      userTpl: `学生正在申请:{school} {program}
文书题目:{prompt}

已收集到的素材卡片:
{cards}

对话历史:
{history}

请提出下一个问题。如果素材已经足够充分(四类素材都有具体内容),就总结成结构化素材卡片,并告诉学生可以进入下一步了。`,
    },
    {
      code: 'essay_outline', version: 1,
      system: `你是留学文书辅导老师,基于学生已有的素材给出**结构建议**。

【绝对约束】
1. 只输出**要点式大纲**,不输出成文的句子或段落。
2. 每个要点写「这一段应该讲什么、为什么放这里」,而不是「这一段可以这样写:……」。
3. 不要提供任何可以直接复制粘贴进文书的完整句子。

【输出格式】
按段落列出,每段包含:
- 段落作用(如「建立动机」「证明能力」)
- 该用哪张素材卡片
- 需要注意的点(如「这里要具体到数字,否则说服力不足」)`,
      userTpl: `目标院校:{school} {program}
文书题目:{prompt}
字数限制:{wordLimit}

学生的素材卡片:
{cards}

请给出段落结构建议。`,
    },
    {
      code: 'essay_polish', version: 1,
      system: `你是英文写作编辑,对学生的文书做**逐句润色**。

【绝对约束】
1. 只做语法修正和表达优化,**不改变学生的原意、不替换他的经历、不添加他没写过的内容**。
2. 逐句输出修改建议,让学生能逐条接受或拒绝。
3. 如果某句已经没问题,明确说「无需修改」,不要为改而改。
4. 不要把学生朴实的表达改成华丽的套话 —— 招生官读过太多套话了。

【输出格式】
严格返回 JSON 数组,每个元素:
{"original": "原句", "suggestion": "修改后", "reason": "改动理由(一句话,中文)", "type": "grammar|clarity|concision|tone"}
如果某句无需修改,不要放进数组。`,
      userTpl: `学生的语言成绩:{languageLevel}
(如果学生雅思写作只有 6.0,但文书语言像母语者,这本身就是风险 —— 润色时保持在合理水平)

需要润色的文本:
{text}

请逐句给出修改建议。`,
    },
  ]

  for (const p of prompts) {
    await db.promptTemplate.upsert({
      where: { code_version: { code: p.code, version: p.version } },
      create: p,
      update: { system: p.system, userTpl: p.userTpl },
    })
  }
  console.log(`✓ prompt 模板 ${prompts.length} 个`)
}

/**
 * 定位规则系数表(PRD 4.1)。
 *
 * ⚠️ 这是**初始估值,必须由运营根据真实录取案例校准**。
 *    数字来自公开录取数据的经验区间,不是精确统计。
 *    评估结果页已强制展示「预估」字样与免责声明。
 */
async function seedAdmissionRules() {
  /**
   * 全部目的地都建规则,否则新增地区的项目会因为查不到规则而
   * 直接不进评估结果(引擎的策略是「查不到就不猜」)。
   *
   * ⚠️ 各地区目前共用同一套概率估值 —— 这是**明显偏粗**的近似。
   *    实际上澳洲、加拿大、欧陆等目的地的录取难度分布差别很大,
   *    必须由运营用各地区真实录取案例分别校准。
   */
  const regions: Region[] = [
    'UK', 'HK', 'SG', 'AU', 'CA', 'MO', 'JP', 'KR', 'NZ', 'IE', 'NL', 'DE', 'FR', 'CH',
  ]
  const directions: Direction[] = [
    'finance', 'accounting', 'management', 'marketing',
    'business_analytics', 'economics', 'international_business', 'supply_chain', 'hr',
    'computer_science', 'data_science_ai', 'engineering', 'architecture',
    'mathematics_statistics', 'natural_sciences', 'life_sciences_medicine',
    'social_sciences', 'media_communication', 'law_public_policy', 'education',
    'arts_design', 'humanities', 'environment_sustainability',
    'agriculture_food_science', 'hospitality_tourism', 'public_health', 'other',
  ]
  const tiers: UndergradTier[] = ['c985_211', 'double_non_first', 'tier_two_other', 'overseas']

  /**
   * GPA 分档。**上界为开区间** —— 查询用 `gpaMin <= gpa AND gpaMax > gpa`。
   *
   * 曾经用闭区间导致 85 分同时命中 [80,85] 和 [85,90] 两档,
   * 查到哪条取决于返回顺序,同一个人刷新两次可能得到不同定位。
   * 最高档上界取 101,保证 100 分也能落进去。
   */
  const bands: Array<{ min: number; max: number }> = [
    { min: 90, max: 101 },
    { min: 85, max: 90 },
    { min: 80, max: 85 },
    { min: 75, max: 80 },
    { min: 0, max: 75 },
  ]

  /** 基准概率:[t1, t2],按本科层级 × GPA 档 */
  const table: Record<UndergradTier, Array<[number, number, number, number]>> = {
    // 每行 = 一个 GPA 档:[t1低, t1高, t2低, t2高]
    c985_211: [
      [45, 65, 75, 90],
      [30, 50, 65, 82],
      [15, 32, 50, 70],
      [6, 18, 32, 52],
      [2, 8, 15, 30],
    ],
    double_non_first: [
      [22, 40, 60, 78],
      [12, 28, 48, 68],
      [5, 15, 32, 52],
      [2, 8, 18, 35],
      [1, 4, 8, 18],
    ],
    tier_two_other: [
      [8, 20, 38, 58],
      [4, 12, 26, 45],
      [2, 6, 15, 30],
      [1, 3, 8, 18],
      [0, 2, 4, 10],
    ],
    overseas: [
      [40, 60, 72, 88],
      [26, 45, 60, 78],
      [12, 28, 45, 65],
      [5, 15, 28, 48],
      [2, 6, 12, 26],
    ],
  }

  let count = 0
  for (const region of regions) {
    for (const direction of directions) {
      for (const tier of tiers) {
        for (let i = 0; i < bands.length; i++) {
          const band = bands[i]
          const [t1lo, t1hi, t2lo, t2hi] = table[tier][i]
          for (const [schoolTier, lo, hi] of [
            ['t1', t1lo, t1hi] as const,
            ['t2', t2lo, t2hi] as const,
          ]) {
            await db.admissionRule.upsert({
              where: {
                region_direction_schoolTier_undergradTier_gpaMin: {
                  region, direction, schoolTier, undergradTier: tier, gpaMin: band.min,
                },
              },
              create: {
                region, direction, schoolTier, undergradTier: tier,
                gpaMin: band.min, gpaMax: band.max,
                probabilityLow: lo, probabilityHigh: hi,
              },
              update: { probabilityLow: lo, probabilityHigh: hi, gpaMax: band.max },
            })
            count++
          }
        }
      }
    }
  }
  console.log(`✓ 定位规则 ${count} 条(⚠️ 初始估值,需运营用真实录取案例校准)`)
}

/**
 * 开发用后台账号。
 *
 * ⚠️ 只在开发环境创建。`NODE_ENV=production` 时跳过 ——
 *    种子脚本在部署时也会跑,一个人尽皆知的弱口令账号跟着上生产,
 *    等于后台没有密码。生产账号用 `npm run admin:create` 单独建。
 */
async function seedAdmin() {
  if (process.env.NODE_ENV === 'production') {
    console.log('· 跳过开发后台账号(生产环境)。用 npm run admin:create 建正式账号。')
    return
  }
  await db.adminUser.upsert({
    where: { email: 'admin@compass.local' },
    create: {
      email: 'admin@compass.local',
      name: '开发管理员',
      passwordHash: await hashPassword('compass-dev'),
      role: 'super_admin',
    },
    update: {},
  })
  console.log('✓ 后台账号 admin@compass.local / compass-dev(仅开发环境)')
}

async function main() {
  await seedPlans()
  await seedMaterialTemplates()
  await seedServiceSkus()
  await seedRecommendationRules()
  await seedNotificationTemplates()
  await seedPromptTemplates()
  await seedAdmissionRules()
  await seedAdmin()
  console.log('\n种子数据写入完成。接下来运行 npm run data:import 导入院校数据。')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
