/**
 * 种子数据
 *   npm run db:seed
 *
 * 内容:套餐档位、材料模板库、增值服务 SKU、推荐规则、通知模板、
 *       prompt 模板、定位规则系数表、后台账号。
 *
 * 这些全部是**运营可在后台修改的配置**,种子只提供一份合理初值。
 */

import { PrismaClient, type Direction, type Region, type UndergradTier } from '@prisma/client'
import { hashPassword } from '../src/lib/auth/password'

const db = new PrismaClient()

async function seedPlans() {
  const plans = [
    {
      code: 'basic',
      name: '基础版季票',
      priceCents: 199900, // ¥1,999
      aiDailyQuota: 30,
      sort: 1,
      // 面向学生的说法,不用「院校库」「工作台」这类内部用词
      features: {
        items: [
          '看全部学校的完整要求,自己组选校名单',
          '材料清单自动列好,交没交一眼看清',
          'AI 陪你聊出文书素材、逐句改语法',
          '快截止了提前提醒你',
          '学校要求有变,第一时间告诉你',
          '每天可以用 30 次 AI',
        ],
      },
    },
    {
      code: 'pro',
      name: 'Pro 季票',
      priceCents: 499900, // ¥4,999
      aiDailyQuota: 100,
      sort: 2,
      features: {
        items: [
          '基础版的全部功能',
          '每天可以用 100 次 AI',
          '单买人工服务打 9 折',
          '客服优先回你',
        ],
      },
    },
  ]

  for (const p of plans) {
    await db.plan.upsert({
      where: { code: p.code },
      create: p,
      update: { name: p.name, priceCents: p.priceCents, features: p.features, aiDailyQuota: p.aiDailyQuota },
    })
  }
  console.log(`✓ 套餐 ${plans.length} 个`)
}

async function seedMaterialTemplates() {
  const templates = [
    // leadTimeDays = 从开始办到拿到手要多久,是「提前预警」的依据
    {
      code: 'transcript', name: '成绩单', sort: 1, sharedAcrossPrograms: true, leadTimeDays: 7,
      description: '本科阶段全部课程成绩,需中英文对照并加盖教务处公章',
      guideMd: '找本科教务处开具中英文成绩单,通常需 3-5 个工作日。\n\n注意:\n- 需加盖学校公章(红章)\n- 部分学校要求密封信封\n- 建议一次多开 3-5 份备用',
    },
    {
      code: 'degree_certificate', name: '学位证 / 毕业证', sort: 2, sharedAcrossPrograms: true, leadTimeDays: 7,
      description: '已毕业提供学位证+毕业证扫描件;在读提供在读证明',
      guideMd: '**已毕业**:学位证 + 毕业证中英文扫描件。\n\n**在读**:向教务处申请「预毕业证明」/「在读证明」,需说明预计毕业时间。',
    },
    {
      code: 'cv', name: '简历(CV)', sort: 3, sharedAcrossPrograms: true, leadTimeDays: 5,
      description: '1 页 A4,学术与实习经历为主',
      guideMd: '学术申请的 CV 与求职简历不同:\n- 教育背景放最前,写明 GPA 与核心课程\n- 实习/科研经历用量化成果描述\n- 控制在 1 页',
    },
    {
      // PS 要写好几稿,而且每校不同,不是一两天的事
      code: 'personal_statement', name: '个人陈述(PS)', sort: 4, sharedAcrossPrograms: false, leadTimeDays: 21,
      description: '各校题目与字数要求不同,需针对性撰写',
      guideMd: '在「文书工作台」中撰写。每所学校的题目和字数限制不同,不要直接复用。',
      fileRequired: false,
    },
    {
      // 推荐人不是你能催的,官方建议就是提前 4-6 周
      code: 'reference', name: '推荐信', sort: 5, sharedAcrossPrograms: false, leadTimeDays: 42,
      description: '通常 2 封,学术推荐人优先',
      guideMd: '主流英语授课硕士项目通常要求 2 封推荐信,其中至少 1 封更适合来自学术推荐人。\n\n提前 4-6 周联系推荐人,并提供你的 CV 和申请方向说明。',
    },
    {
      // 报名 → 考试 → 出分 → 送分,两个月是保守估计
      code: 'english_test', name: '语言成绩(雅思/托福)', sort: 6, sharedAcrossPrograms: true, leadTimeDays: 60,
      description: '需在成绩有效期内(通常 2 年)',
      guideMd: '雅思/托福成绩单需在官网送分给目标院校。\n\n注意各校对小分的要求 —— 总分够但小分不够同样会被拒。',
    },
    {
      code: 'gmat_gre', name: 'GMAT / GRE 成绩', sort: 7, sharedAcrossPrograms: true, leadTimeDays: 60,
      description: '部分商科项目要求或强烈建议提交',
      guideMd: '新加坡、法国高商等部分商科项目会要求或强烈建议提交 GMAT/GRE;其他地区多为可选加分项。\n\n成绩有效期通常 5 年。',
      fileRequired: false,
    },
    {
      code: 'passport', name: '护照', sort: 8, sharedAcrossPrograms: true, leadTimeDays: 14,
      description: '信息页扫描件,有效期需覆盖入学后至少 6 个月',
      guideMd: '如护照即将过期或尚未办理,尽早去出入境管理局办理,通常 7-10 个工作日。',
    },
    {
      code: 'id_document', name: '身份证', sort: 9, sharedAcrossPrograms: true, leadTimeDays: 1,
      description: '正反面扫描件',
      guideMd: '港校申请通常需要身份证扫描件。',
    },
  ]

  for (const t of templates) {
    await db.materialTemplate.upsert({
      where: { code: t.code },
      create: t,
      update: {
        name: t.name,
        description: t.description,
        guideMd: t.guideMd,
        sort: t.sort,
        leadTimeDays: t.leadTimeDays,
      },
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
