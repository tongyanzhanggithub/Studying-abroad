import Link from 'next/link'
import { db } from '@/lib/db'
import { formatCents } from '@/lib/utils'
import { REGION_LABEL, REGION_ORDER } from '@/lib/programs/types'
import { unstable_cache } from 'next/cache'
import { readPublicRegionsFresh } from '@/lib/regions/gate'
import { CACHE_TAGS, MARKETING_CACHE_SECONDS } from '@/lib/cache-tags'
import { BrandLogo } from '@/components/BrandLogo'
import { getSession } from '@/lib/auth/session'
import { isAiAvailable } from '@/lib/llm/availability'

/**
 * 营销首页(PRD 3.1 `/`)。
 *
 * 文案红线(PRD 10.1 / 14):
 *   · 禁止「保录」「保offer」「100%成功」
 *   · 禁用「简单」「轻松保录」类词汇
 *   · 基调:透明、不许诺、把选择权交给学生
 *
 * ⚠️ 写文案时的两条自律:
 *   1. **不用内部黑话**。「去重」「分档」「留资」「核对日期」是我们的工程/运营用词,
 *      学生不这么说话。一律换成他们会说的话。
 *   2. **数据库可用时,所有数字实时取自数据库**。一个把「数据可信」当卖点的产品,
 *      自己首页上的数字更不能随意手写死。开发环境数据库未启动时只用保守兜底,避免首页打不开。
 */

type MarketingSchool = {
  nameZh: string | null
  nameEn: string
  shortName: string | null
  region: string
}

type MarketingPlan = {
  id: string
  name: string
  priceCents: number
  features: unknown
}

/**
 * 首页的亮点区 —— 「有些事我们不做」。
 *
 * ⚠️ 每一条都必须是**代码里真实成立**的事,不是文案。
 *    改动前先去确认那件事还是真的:
 *
 *      不存学校账号密码       → schema 里没有存密码的字段
 *      没核对过的地区不开放   → admin/regions 的核对率闸门
 *      不代写                 → 文书工作台刻意没有「一键生成全文」按钮
 *      不承诺录取             → 页脚 + FAQ + 评估结果页都写着
 *      不代办签证             → 所以 /app/profile 明确不问证件号和父母信息
 *
 *    这一节是全站唯一一处「竞品原样抄不走」的内容 ——
 *    因为抄了就得真做到。写虚一条,整节就废了。
 */
const DONT_DO = [
  {
    t: '不碰你的申请账号和密码',
    d: '申请邮箱、学校网申账号始终在你自己手里,我们不存、也不代登。想换个方式做,全部数据随时导出带走。',
  },
  {
    t: '不给你没核对过的数字',
    d: '每条录取要求旁边写着最后确认时间和官网链接,太久没确认的会标灰。一个地区的数据没核对达标,我们宁可先不开放 —— 你在评估页看到的,就是现在真能选的。',
  },
  {
    t: '不代写文书',
    d: '我们帮你把经历问清楚、把每所学校的题目和字数盯住,但每一个字都得是你自己写的。院校一旦核实代写,后果是撤销录取并可能通报。',
  },
  {
    t: '不承诺录取',
    d: '给你的是参考区间和它背后的依据 —— 哪条要求卡着你、差多少、还有没有别的路。采不采纳,你自己定。',
  },
  {
    t: '不代理申请、不做学科培训',
    d: '不替你点提交,也不卖语言班。这也是为什么我们不问你的身份证号和父母信息 —— 那些只有签证代办才需要,而我们不做那件事。',
  },
]

/**
 * ⚠️ FAQ 与工作台预览做成**按 AI 可用性变化**的函数,不是写死的常量。
 *
 *    这个文件里已经有两处专门撤过 AI 文案,还留了注释
 *    「讲一个还不能用的功能,等于卖不存在的东西」—— 但剩下两处漏了,
 *    也就是首页一直在宣传一个 LLM_PROVIDER=mock 时点下去会报
 *    「正在接入中」的功能。
 *
 *    靠人记得改是不可靠的:接上模型那天没人会想起来把话加回去,
 *    换回 mock 排查问题时更不会想起来撤下去。所以让文案跟着配置走。
 */
function faqs(aiReady: boolean) {
  return [
  {
    q: '和找中介有什么不一样?',
    a: '中介替你做,我们让你自己做得成。最实在的差别是账号 —— 中介通常拿着你的申请邮箱和学校账号,我们不碰,密码始终在你手里。价格上,中介一般三到八万。',
  },
  {
    q: '你们的学校信息准吗?',
    a: '每条信息都写明最后确认的时间,并附上官网原始页面的链接,你可以自己点开核。还没经人工确认的会标出来,太久没更新的会标灰。我们宁可写「待确认」,也不给你一个看着很确定、其实可能过期的数字。最终请以学校官网为准。',
  },
  aiReady
    ? {
        q: 'AI 能帮我把文书写出来吗?',
        a: '可以帮你把文书推进到更好的状态:追问细节帮你想起具体经历、给段落顺序提建议、逐句优化语法和表达。真正的故事和取舍仍然来自你,这样文书更有辨识度,也更经得起学校审核。',
      }
    : {
        // AI 还没接通时,如实说这一块在做什么、以及现在能用的是什么
        q: '文书这块能帮我做什么?',
        a: '现在能做的是把写作这件事拆开管好:素材库按学术背景、实践经历、申请动机几条线帮你把经历问清楚并存下来,答一次所有学校通用;文书按学校分开写,题目和字数各自记着;定稿前有合规检查。AI 辅助(素材追问、结构建议、逐句润色)还在接入中,接通前不会向你收取与它相关的费用。文字始终是你自己的。',
      },
  {
    q: '能保证录取吗?',
    a: '申请没有真正的保票,但定位可以更聪明。我们会根据公开要求和历史数据给出参考区间,把冲刺、匹配、保底拆清楚,帮你把预算、时间和精力放到更值得申请的项目上。',
  },
  {
    q: '买了觉得不合适怎么办?',
    a: '七天内无条件全额退,不问理由。超过之后按剩下的月份退。单买的人工服务:老师还没接单全额退,接了没做完退一半,做完了不退。这些写在付款页面上,不藏在协议里。',
  },
  {
    q: '覆盖哪些国家和专业?',
    /**
     * ⚠️ 这里刻意**不列地区清单**。
     *    原来写的是「覆盖美国之外的主流英语授课地区……美国暂时没做」,
     *    而地区是在后台按核对率逐个开放的 —— 清单写死在 FAQ 里,
     *    开一个地区就要记得回来改一次,漏改就是对外说错话。
     *    改成指向「评估页看到的就是当前能选的」,那一页是从数据渲染的,永远准。
     */
    a: '打开免费评估就能看到当前开放的目的地 —— 那一页列的就是现在真能选的,不是宣传口径。地区是逐个开放的:一个地区的数据核对达标了才会放出来,没达标的标成「即将开放」、点不了。专业方向按海外常见 subject area 归类,从商科、计算机、工程到教育、传媒、法律、艺术设计逐步收录。评估结果只用已经录入并有规则的数据,没把握的方向不会硬编结论。',
  },
  ]
}

const STORY_ITEMS = [
  { label: '测评', meta: '规则定位' },
  { label: '选校', meta: '名单管理' },
  { label: '材料', meta: '去重清单' },
  { label: '文书', meta: '素材/润色' },
  { label: '提醒', meta: '14/7/3/1天' },
]

/**
 * 「用起来大概是这样」的四步 —— 这是**两节合并**后的产物。
 *
 * ⚠️ 首页原来有两个整块在讲同一件事:
 *
 *      WORKSPACE PREVIEW「测完之后,不是只给你一张名单」→ 四张功能卡
 *      APPLICATION FEED 「用起来大概是这样」          → 四个步骤
 *
 *    两边都是「选校 / 材料 / 文书 / 截止日」这四件事,一个包装成功能、
 *    一个包装成步骤。再加上上面的圆环条和下面的「为什么值得托付」,
 *    同样四件事全页讲了**五遍**。用户翻到第三遍不会觉得全面,只会觉得啰嗦。
 *
 *    合并成一节:每一步既说「你做什么」,也说「系统给你什么」。
 *    信息一点没少,页面短了一整屏。
 *
 * ⚠️ 第 3 步的 rows 仍然按 aiReady 分叉 —— 见 lib/llm/availability.ts。
 *    模型没接通时不许出现「AI 问问题」这类说法。
 */
function applicationFlow(aiReady: boolean) {
  return [
  {
    n: '01',
    label: '选校定位',
    title: '先看看能申哪儿',
    body: '填本科学校、成绩、想去的地方,一分钟给你一份名单,并把每个项目放进冲刺 / 匹配 / 稳妥,附上地区、语言、GMAT/GRE 和截止日信号。',
    rows: ['冲刺 3 所', '匹配 3 所', '稳妥 3 所'],
  },
  {
    n: '02',
    label: '材料中心',
    title: '定下学校,材料清单自动出来',
    body: '名单可以随便加减,清单跟着重新合并。成绩单、CV 这类共用材料只出现一次,并标好它管哪几所 —— 不用对着八份重复清单发愁。',
    rows: ['成绩单 · 8 校共用', 'CV · 6 校共用', '护照 · 14 校共用'],
  },
  aiReady
    ? {
        n: '03',
        label: '文书工作台',
        title: '素材问清楚,文书按校分开写',
        body: '每样材料都写清楚去哪儿办、怎么办。文书这边做素材追问、结构建议、逐句润色和合规检查,不把代写风险转嫁给学生。',
        rows: ['素材访谈', '结构建议', '合规检查'],
      }
    : {
        n: '03',
        label: '素材库与文书',
        title: '经历答一次,所有学校通用',
        body: '每样材料都写清楚去哪儿办、怎么办。经历按学术背景、实践、动机几条线问清楚存下来,不用每所学校重答一遍;文书按学校分开写,题目和字数各自记着。',
        rows: ['素材库 · 各校通用', '文书 · 按校分开', '定稿前合规检查'],
      },
  {
    n: '04',
    label: '截止提醒',
    title: '别错过截止日',
    body: '选校单里的项目有截止日之后,系统按关键节点提前提醒你,材料没完成时优先提示风险。学校要求有变动,也会第一时间告诉你。',
    rows: ['14 天预备', '7 天补漏', '3/1 天强提醒'],
  },
  ]
}

const ADVISOR_GROUPS = [
  {
    label: '申请策略导师',
    title: '先把方向判断准',
    body: '从本科背景、成绩区间、目标地区和预算出发,帮你判断哪些学校值得冲、哪些应该稳住。',
    tags: ['定位', '选校', '节奏'],
  },
  {
    label: '文书表达导师',
    title: '把经历讲得更有辨识度',
    body: '不替你编故事,而是把真实经历里的动机、行动和结果挖出来,让文书更像你本人。',
    tags: ['素材', '结构', '表达'],
  },
  {
    label: '项目研究导师',
    title: '盯住要求和截止日',
    body: '围绕专业要求、语言小分、材料清单和截止日期做核对,减少临门一脚才发现不匹配。',
    tags: ['官网核对', '材料', '截止日'],
  },
]

/**
 * 首屏那句地区说明 —— **从真实开放的地区算出来**,不写死。
 *
 * ⚠️ 原来是写死的 '美国之外主流英语授课地区'。这句话散在四个地方
 *    (首屏、FAQ、评估页地区选择的 hint、actions.ts 的注释),
 *    美国一开放就要同步四处,漏一处就是对外说错话 ——
 *    而这一整轮修的正是这种「同一句话写好几遍,总有一份是错的」。
 *
 *    首屏那三个数字本来就是从已开放地区算的(openRegionCount),
 *    文案跟着同一份数据走,开了什么地区它自己就说什么,不需要有人记得改。
 */
function heroRegionCopy(openRegions: string[]): string {
  if (openRegions.length === 0) return '主流英语授课地区'
  const sorted = [...openRegions].sort(
    (a, b) =>
      REGION_ORDER.indexOf(a as never) - REGION_ORDER.indexOf(b as never),
  )
  const names = sorted.map((r) => REGION_LABEL[r as keyof typeof REGION_LABEL] ?? r)
  // 三个以内直接列全;再多就列前三 + 「等 N 个地区」,否则这一行会太长
  return names.length <= 3
    ? names.join(' · ')
    : `${names.slice(0, 3).join(' · ')} 等 ${names.length} 个地区`
}
const SUPPORTED_REGION_COUNT = REGION_ORDER.length

const FALLBACK_SCHOOLS: MarketingSchool[] = [
  { nameZh: '牛津大学', nameEn: 'University of Oxford', shortName: 'Oxford', region: 'UK' },
  { nameZh: '剑桥大学', nameEn: 'University of Cambridge', shortName: 'Cambridge', region: 'UK' },
  { nameZh: '伦敦政治经济学院', nameEn: 'London School of Economics', shortName: 'LSE', region: 'UK' },
  { nameZh: '帝国理工学院', nameEn: 'Imperial College London', shortName: 'Imperial', region: 'UK' },
  { nameZh: '伦敦大学学院', nameEn: 'University College London', shortName: 'UCL', region: 'UK' },
  { nameZh: '华威大学', nameEn: 'University of Warwick', shortName: 'Warwick', region: 'UK' },
  { nameZh: '曼彻斯特大学', nameEn: 'University of Manchester', shortName: 'Manchester', region: 'UK' },
  { nameZh: '香港大学', nameEn: 'The University of Hong Kong', shortName: 'HKU', region: 'HK' },
  { nameZh: '香港中文大学', nameEn: 'The Chinese University of Hong Kong', shortName: 'CUHK', region: 'HK' },
  { nameZh: '香港科技大学', nameEn: 'The Hong Kong University of Science and Technology', shortName: 'HKUST', region: 'HK' },
  { nameZh: '新加坡国立大学', nameEn: 'National University of Singapore', shortName: 'NUS', region: 'SG' },
  { nameZh: '南洋理工大学', nameEn: 'Nanyang Technological University', shortName: 'NTU', region: 'SG' },
  { nameZh: '墨尔本大学', nameEn: 'University of Melbourne', shortName: 'Melbourne', region: 'AU' },
  { nameZh: '悉尼大学', nameEn: 'University of Sydney', shortName: 'Sydney', region: 'AU' },
  { nameZh: '新南威尔士大学', nameEn: 'University of New South Wales', shortName: 'UNSW', region: 'AU' },
  { nameZh: '多伦多大学', nameEn: 'University of Toronto', shortName: 'UofT', region: 'CA' },
  { nameZh: '麦吉尔大学', nameEn: 'McGill University', shortName: 'McGill', region: 'CA' },
  { nameZh: '不列颠哥伦比亚大学', nameEn: 'University of British Columbia', shortName: 'UBC', region: 'CA' },
  { nameZh: '澳门大学', nameEn: 'University of Macau', shortName: 'UM', region: 'MO' },
  { nameZh: '东京大学', nameEn: 'University of Tokyo', shortName: 'UTokyo', region: 'JP' },
  { nameZh: '早稻田大学', nameEn: 'Waseda University', shortName: 'Waseda', region: 'JP' },
  { nameZh: '首尔大学', nameEn: 'Seoul National University', shortName: 'SNU', region: 'KR' },
  { nameZh: '韩国科学技术院', nameEn: 'KAIST', shortName: 'KAIST', region: 'KR' },
  { nameZh: '奥克兰大学', nameEn: 'University of Auckland', shortName: 'Auckland', region: 'NZ' },
  { nameZh: '都柏林圣三一大学', nameEn: 'Trinity College Dublin', shortName: 'TCD', region: 'IE' },
  { nameZh: '都柏林大学学院', nameEn: 'University College Dublin', shortName: 'UCD', region: 'IE' },
  { nameZh: '阿姆斯特丹大学', nameEn: 'University of Amsterdam', shortName: 'UvA', region: 'NL' },
  { nameZh: '鹿特丹伊拉斯姆斯大学', nameEn: 'Erasmus University Rotterdam', shortName: 'Erasmus', region: 'NL' },
  { nameZh: '慕尼黑工业大学', nameEn: 'Technical University of Munich', shortName: 'TUM', region: 'DE' },
  { nameZh: '慕尼黑大学', nameEn: 'LMU Munich', shortName: 'LMU', region: 'DE' },
  { nameZh: '巴黎高等商学院', nameEn: 'HEC Paris', shortName: 'HEC', region: 'FR' },
  { nameZh: 'ESSEC 商学院', nameEn: 'ESSEC Business School', shortName: 'ESSEC', region: 'FR' },
  { nameZh: '苏黎世联邦理工学院', nameEn: 'ETH Zurich', shortName: 'ETH', region: 'CH' },
  { nameZh: '圣加仑大学', nameEn: 'University of St. Gallen', shortName: 'HSG', region: 'CH' },
]


/**
 * ⚠️ 这一段套了跨请求缓存(unstable_cache),整个文件里只有它。
 *
 *    首页是漏斗最顶端、匿名流量最大的一页,而它读的东西 —— 已开放地区、
 *    院校列表(美国扩完之后好几百行)、项目总数、起价 —— 是**月级别**才变一次的。
 *    原来每个划过首页的人都实打实打一次 RDS,在小规格实例上是最不值的一笔开销。
 *
 *    页面本身依然是动态的(下面要读 session 换按钮文案),缓存的只是这几条查询。
 *
 * ⚠️ 失效有两条路,缺一不可:
 *      · 后台改套餐 / 开关地区 → revalidateTag,立即生效
 *      · 命令行导入(data:import / schools:import)跑在 Next 进程外,
 *        调不到 revalidateTag → 靠 MARKETING_CACHE_SECONDS 兜底
 *
 * ⚠️ try/catch 必须留在**缓存外层**。数据库连不上时不能把兜底数据
 *    当成正常结果缓存 5 分钟 —— 那样数据库恢复了首页还在显示假数字。
 */
const readMarketingData = unstable_cache(
  async (): Promise<{
    programCount: number
    schools: MarketingSchool[]
    plans: MarketingPlan[]
  }> => {
    /**
     * ⚠️ 首页只统计**已开放地区**。
     *
     * 否则会出现:首页宣称覆盖 310 个项目、31 所学校,用户点进评估
     * 却只能选英国 —— 这是拿还没核对的数据给自己撑门面。
     */
    /**
     * ⚠️ 这里用直读版本,不用 getPublicRegions。
     *    后者是 React cache() 包的,作用域是**单次请求**;而这个 callback 跑在
     *    跨请求缓存边界里,那儿没有「当前请求」可言 —— 请求内记忆化在这里
     *    既没有意义,语义上也不该依赖。直读一次,结果由外层缓存持有。
     */
    const publicRegions = await readPublicRegionsFresh()

    const [programCount, schools, plans] = await Promise.all([
      db.program.count({ where: { active: true, region: { in: publicRegions } } }),
      db.school.findMany({
        where: { region: { in: publicRegions } },
        select: { nameZh: true, nameEn: true, shortName: true, region: true },
        orderBy: { region: 'asc' },
      }),
      db.plan.findMany({ where: { active: true }, orderBy: { sort: 'asc' } }),
    ])

    return { programCount, schools, plans }
  },
  ['marketing-data'],
  { tags: [CACHE_TAGS.publicCatalog, CACHE_TAGS.plans], revalidate: MARKETING_CACHE_SECONDS },
)

/**
 * ⚠️ 数据库不可用时,首页**一个数字都不报**。
 *
 *    原来的兜底是这样的:
 *      programCount: 566 —— 写死的,真实值是 143
 *      FALLBACK_PLANS   —— 「申请季通行证 ¥1,999」,而真实起价是月票 ¥30
 *
 *    也就是说库一断,首页就会告诉访客「566 个项目、覆盖 14 个国家/地区、
 *    ¥1,999 起」,而这三个数**没有一个是真的**,价格还错了 66 倍
 *    (收尾 CTA 那句「再考虑要不要花 ¥1,999」也跟着一起错)。
 *
 *    兜底的目的是「库断了页面还能打开」,不是「库断了就编一套数据顶上」。
 *    对一个把「每条信息都能点开官网核对」当卖点的产品,这是最不能出的错。
 *
 *    所以降级后:
 *      · 院校墙照常显示(那是视觉展示,不是数据主张)
 *      · 三个统计数字整块隐藏
 *      · 地区那行退回中性说法(heroRegionCopy 对空数组已有这个分支)
 *      · 套餐返回空数组 —— 价格区和 CTA 里的价格都已经是条件渲染,自动消失
 */
async function getMarketingData(): Promise<{
  programCount: number
  schools: MarketingSchool[]
  plans: MarketingPlan[]
  degraded: boolean
}> {
  try {
    return { ...(await readMarketingData()), degraded: false }
  } catch (error) {
    console.warn('Marketing homepage is using fallback data because the database is unavailable.', error)
    return {
      programCount: 0,
      schools: FALLBACK_SCHOOLS,
      plans: [],
      degraded: true,
    }
  }
}

export default async function HomePage() {
  const { programCount, schools, plans, degraded } = await getMarketingData()
  // 已登录就把「登录/注册」换成「进入工作台」—— 否则登录用户点进来还得再找一次入口
  const session = await getSession()
  /**
   * ⚠️ 首页讲不讲 AI 文书,由**实际配置**决定,不写死。
   *    见 lib/llm/availability.ts —— 判定和 getLlmProvider() 的行为一致,
   *    避免出现「首页说有、点进去说没有」。
   */
  const aiReady = await isAiAvailable()

  const entryPrice = plans[0]?.priceCents
  /**
   * 已开放的地区 —— 由 schools 反推,和上面的项目数、院校数同源。
   * ⚠️ 降级时必须当成「不知道」,否则会拿兜底院校表反推出 14 个地区,
   *    而实际开放的可能只有一个。
   */
  const openRegions = degraded ? [] : [...new Set(schools.map((s) => s.region))]
  const openRegionCount = openRegions.length
  const regionCopy = heroRegionCopy(openRegions)

  return (
    <div className="marketing-page min-h-screen bg-insta-surface text-ink-800">
      {/* ── 导航 ───────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-white/60 bg-white/75 shadow-[0_1px_28px_rgba(193,53,132,0.08)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <BrandLogo className="text-lg" />
          <nav className="-mr-2 flex items-center gap-1 text-sm text-ink-600 sm:gap-2">
            <Link
              href="/pricing"
              className="inline-flex min-h-11 items-center rounded-lg px-3 transition-colors hover:bg-white/80 hover:text-ink-900"
            >
              价格
            </Link>
            {session ? (
              <Link
                href="/app/dashboard"
                className="insta-button ml-1 inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-white"
              >
                进入工作台
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="inline-flex min-h-11 items-center rounded-lg px-3 transition-colors hover:bg-white/80 hover:text-ink-900"
                >
                  登录 / 注册
                </Link>
                <Link
                  href="/assess"
                  className="insta-button ml-1 inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-white"
                >
                  免费测一测
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* ── 首屏 ───────────────────────────────────── */}
      <section className="hero-stage relative overflow-hidden border-b border-white/70">
        {/*
          首屏背景 —— 这是整个漏斗最顶端那一页的 LCP 元素,它多大就等于
          新访客盯着空白 hero 多久。

          ⚠️ 原来直接引 1.9 MB 的 PNG。转成 WebP(q82)之后是 125 KB,**省 94%**,
             肉眼看不出区别。国内移动网络下这是好几秒的差别。
             重新生成命令(项目里已有 sharp):
               npx -y --package=sharp node -e "require('sharp')('public/images/instagram-study-hero.png').webp({quality:82}).toFile('public/images/instagram-study-hero.webp')"

          ⚠️ PNG 作为 <picture> 的兜底留着 —— WebP 在 iOS 14 以下不支持,
             那部分用户虽然少,但让他们看到一个**没有背景图的首屏**不值当。
             现代浏览器一律只下 WebP,兜底文件不会被请求到。

          用 <img> 而不是 next/image:这是张满幅背景图,尺寸固定、不需要响应式
          多档,而服务器只有 2 vCPU —— 让它在运行时反复转码不划算,
          不如构建前一次性压好。
        */}
        <picture>
          <source srcSet="/images/instagram-study-hero.webp" type="image/webp" />
          <img
            src="/images/instagram-study-hero.png"
            alt=""
            fetchPriority="high"
            decoding="async"
            className="hero-bg absolute inset-0 h-full w-full object-cover"
          />
        </picture>
        <div className="hero-overlay absolute inset-0" />

        <div className="relative z-10 mx-auto max-w-6xl px-5 py-14 sm:py-20">
          <div className="glass-chip inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-ink-700">
            <span className="h-2 w-2 rounded-full bg-insta-pink shadow-[0_0_0_4px_rgba(225,48,108,0.14)]" />
            {regionCopy} · 硕士申请
          </div>

          <h1 className="display-heading mt-6 max-w-3xl text-4xl font-semibold text-ink-900 sm:text-6xl">
            60 秒看清
            <br />
            你能冲哪些学校
          </h1>

          {/*
            首屏副标 —— 承接标题往下推一层,不是把标题换个说法再说一遍。

            这一版走的是「重构问题」:标题许诺一份名单,副标立刻说明
            名单本身解决不了申请季 —— 顺势把真正的价值(全程管到提交)推出去。

            ⚠️ 两条改稿时容易丢的东西:
              1. 三个短句必须**对应真功能**:材料清单 / 文书按学校分开管 / 截止日倒计时。
                 换措辞可以,换成做不到的事不行(PRD 10.1)。
              2. 「不承诺录取结果」的立场不靠这句话扛 —— 它在页脚,
                 「每条信息都能点开官网核对」在下面的信任区。副标这里可以放开写。
          */}
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-700">
            一份选校名单,解决不了申请季。材料齐没齐、文书写到第几稿、最近一个截止日还剩几天
            —— 打开就有答案,不用再翻聊天记录。
          </p>

          <div className="mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <Link
              href="/assess"
              className="insta-button inline-flex justify-center rounded-full px-7 py-4 text-base font-medium text-white sm:py-3.5"
            >
              免费测一下我能申哪些学校
            </Link>
            <span className="text-center text-sm text-ink-600 sm:text-left">
              一分钟,不用注册
            </span>
          </div>

          {/* ⚠️ 降级时整块隐藏 —— 宁可少三个数字,也不报三个假的。见 getMarketingData */}
          {!degraded && (
          <div className="mt-9 grid max-w-xl grid-cols-3 gap-2">
            {[
              { value: programCount, label: '硕士项目' },
              { value: schools.length, label: '收录院校' },
              // 用**已开放**的地区数,不是枚举支持的地区数 ——
              // 否则会出现「14 个国家/地区 / 0 个项目」这种自相矛盾的展示
              //
              // ⚠️ 措辞必须是「国家/地区」,不能简写成「国家」。
              //    这个计数里包含 HK 和 MO,而 REGION_LABEL 里它们写的就是
              //    「中国香港」「中国澳门」—— 把它们数进「N 个国家」是硬伤,
              //    对一个面向国内学生的产品尤其不能出这种错。
              //    「国家/地区」是中文产品处理这件事的通行写法。
              { value: openRegionCount, label: '国家/地区' },
            ].map((item) => (
              <div key={item.label} className="glass-chip rounded-lg px-4 py-3">
                <p className="text-2xl font-semibold text-ink-900">{item.value}</p>
                <p className="mt-1 text-xs text-ink-500">{item.label}</p>
              </div>
            ))}
          </div>
          )}
        </div>
      </section>

      <section className="border-b border-white/70 bg-white/80">
        <div className="mx-auto max-w-6xl px-5 py-5">
          <div className="story-strip flex gap-4 overflow-x-auto pb-1">
            {STORY_ITEMS.map((item) => (
              <div key={item.label} className="shrink-0 text-center">
                <div className="story-ring mx-auto grid h-16 w-16 place-items-center rounded-full p-[2px]">
                  <span className="grid h-full w-full place-items-center rounded-full bg-white text-sm font-semibold text-ink-900">
                    {item.label}
                  </span>
                </div>
                <p className="mt-2 text-xs text-ink-500">{item.meta}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 用起来大概是这样(原「工作台预览」+「怎么用」合并)──── */}
      <section className="border-t border-white/70 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
          <div className="max-w-2xl">
            <p className="gradient-text text-sm font-semibold">HOW IT WORKS</p>
            <h2 className="display-heading mt-2 text-2xl font-semibold text-ink-900 sm:text-3xl">
              用起来大概是这样
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-600">
              从不知道能申哪儿,到把材料按时交出去。每一步你做什么、系统给你什么,都在下面。
            </p>
          </div>

          <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {applicationFlow(aiReady).map((item) => (
              <li
                key={item.n}
                className="feed-card overflow-hidden p-0 shadow-[0_12px_30px_rgba(35,42,53,0.05)]"
              >
                <div className="px-4 py-4">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-sm text-insta-pink">{item.n}</span>
                    <span className="text-xs font-semibold text-ink-400">{item.label}</span>
                  </div>
                  <h3 className="mt-2 text-base font-medium leading-snug text-ink-900">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-xs leading-relaxed text-ink-500">{item.body}</p>
                </div>
                <div className="space-y-1.5 border-t border-ink-100 bg-ink-50/50 px-4 py-3">
                  {item.rows.slice(0, 2).map((row, index) => (
                    <div
                      key={row}
                      className="flex items-center justify-between rounded-lg bg-white px-2.5 py-2 text-xs"
                    >
                      <span className="text-ink-700">{row}</span>
                      <span className="text-xs text-ink-400">{index === 0 ? '优先' : '进行中'}</span>
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── 名师团队 ─────────────────────────────── */}
      <section className="border-t border-white/70 bg-[linear-gradient(180deg,#fff_0%,#fff7fb_100%)]">
        <div className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <p className="gradient-text text-sm font-semibold">MENTOR PANEL</p>
              <h2 className="display-heading mt-2 text-2xl font-semibold text-ink-900 sm:text-3xl">
                名师团队,关键判断有人把关
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-600">
                AI 负责整理信息和提醒节点,真正需要取舍的地方,由懂地区、懂专业、懂文书的老师帮你把关。
              </p>
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-ink-500">
              重要选择不靠感觉,也不被模板牵着走。你会看到建议背后的理由,再决定要不要采纳。
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {ADVISOR_GROUPS.map((advisor, index) => (
              <article key={advisor.label} className="feed-card p-5">
                <div className="flex items-start gap-3">
                  <span className="story-ring grid h-11 w-11 shrink-0 place-items-center rounded-full p-[2px] text-sm font-semibold">
                    <span className="grid h-full w-full place-items-center rounded-full bg-white text-ink-900">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-insta-pink">{advisor.label}</p>
                    <h3 className="mt-1 text-lg font-medium text-ink-900">{advisor.title}</h3>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-ink-600">{advisor.body}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {advisor.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-brand-100 bg-white px-3 py-1 text-xs text-ink-500">
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/*
        ── 有些事我们不做 ────────────────────────────

        这一节替掉了原来的两节:
          「几个我们比较较真的地方」(TRUST NOTES,浅色四张卡)
          「为什么值得托付」        (WHY COMPASS,深色三条)

        ⚠️ 后者是前者换成收益名词再说一遍,而且写得更差 ——
           「要的就是确定感」「少被信息差牵着走」这种话任何 SaaS 都能贴上去,
           却占着全页最强的视觉位置(整块深色 + 紧跟价格)。
           前者里的「文书按学校分开管」「一份材料不用交八遍」
           又和上面「用起来大概是这样」的卡片重复。

        真正独一份的只有两条:账号在你手里、每条数据能点开官网核对 ——
        而它们原来挂在「几个我们比较较真的地方」这个刻意压低的标题下。
        全站最有杀伤力的牌,被自己藏起来了。

        ⚠️ 为什么写成「不做什么」而不是「中介 vs 我们」对比表:
           对比表要拿中介的报价当参照,而那个数字我们举证不了
           (《广告法》第 28 条),拿别人的价格衬自己便宜也和
           「每条数据都能点开核对」的立场拧着。
           写自己不做什么,读者自己会做那道减法,我们一个字都没说别人。

        ⚠️ 五条**每一条都在代码里真实成立**,不是话术:
             不存学校账号密码 · 地区按核对率逐个开放(admin/regions) ·
             Deliverer.showOnSite 默认 false · 网申信息页明确不问证件号和父母信息 ·
             页脚写明不代理申请、不做学科培训。
           改这里之前先确认那件事还是真的,否则就是虚假宣传。
      */}
      <section className="border-y border-ink-900 bg-ink-900 text-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <p className="text-sm font-semibold text-white/60">WHERE WE STOP</p>
          <h2 className="display-heading mt-2 text-2xl font-semibold sm:text-3xl">
            有些事我们不做
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/60">
            留学这行最容易出事的地方,恰恰是「替你做」做得太多。下面几条是我们的边界 ——
            也是你判断该不该把一个申请季交给它的依据。
          </p>

          <ul className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {DONT_DO.map((x) => (
              <li key={x.t} className="border-t border-white/15 pt-5">
                <h3 className="font-medium">{x.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">{x.d}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>


      {/* ── 价格 ───────────────────────────────────── */}
      {plans.length > 0 && (
        <section className="soft-section border-t border-white/70">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="gradient-text text-sm font-semibold">SEASON PASS</p>
                <h2 className="display-heading mt-2 text-2xl font-semibold text-ink-900 sm:text-3xl">
                  一张通行证,管完整个申请季
                </h2>
                <p className="mt-3 max-w-xl text-ink-600">
                  从选校名单到材料清单、文书打磨和截止提醒一次解锁。需要老师精修时,再按需加购人工服务。
                </p>
              </div>
              <Link
                href="/pricing"
                className="inline-flex min-h-11 items-center text-sm font-medium text-insta-pink underline-offset-4 hover:underline"
              >
                看完整价格和退款规则 →
              </Link>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {plans.map((plan, i) => {
                const features = (plan.features as { items?: string[] })?.items ?? []
                return (
                  <article
                    key={plan.id}
                    className={
                      i === 0
                        ? 'feed-card border-insta-pink bg-white p-6 shadow-[0_18px_45px_rgba(225,48,108,0.14)]'
                        : 'feed-card p-6'
                    }
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-medium text-ink-900">{plan.name}</h3>
                      {i === 0 && (
                        <span className="insta-gradient rounded-full px-2.5 py-0.5 text-xs text-white">
                          推荐
                        </span>
                      )}
                    </div>
                    <p className="mt-3 text-4xl font-semibold tracking-tight text-ink-900">
                      {formatCents(plan.priceCents)}
                      <span className="ml-1.5 text-sm font-normal text-ink-400">
                        / 申请季
                      </span>
                    </p>
                    <ul className="mt-5 space-y-2 text-sm text-ink-600">
                      {features.slice(0, 5).map((f) => (
                        <li key={f} className="flex gap-2">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-insta-pink" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </article>
                )
              })}
            </div>
          </div>
        </section>
      )}
      {/* ── 常见问题 ───────────────────────────────── */}
      <section className="border-t border-white/70 bg-white">
        <div className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
          <p className="gradient-text text-sm font-semibold">FAQ</p>
          <h2 className="display-heading mt-2 text-2xl font-semibold text-ink-900 sm:text-3xl">
            你可能想问
          </h2>

          <div className="mt-10 divide-y divide-ink-100 border-y border-ink-100">
            {faqs(aiReady).map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex min-h-11 items-center justify-between gap-4 text-left">
                  <span className="font-medium text-ink-900">{f.q}</span>
                  <span aria-hidden className="shrink-0 text-xl leading-none text-ink-400">
                    <span className="group-open:hidden">+</span>
                    <span className="hidden group-open:inline">−</span>
                  </span>
                </summary>
                <p className="mt-3 pr-8 text-sm leading-relaxed text-ink-600">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── 收尾 CTA ───────────────────────────────── */}
      <section className="cta-band border-t border-white/70">
        <div className="mx-auto max-w-6xl px-5 py-20 text-center sm:py-28">
          <h2 className="display-heading text-3xl font-semibold text-ink-900 sm:text-4xl">
            先看看你能申哪些学校
          </h2>
          <p className="mx-auto mt-4 max-w-md text-ink-600">
            不用注册,不用付钱,一分钟就有结果。
            {entryPrice ? `觉得有用,再考虑要不要花 ${formatCents(entryPrice)}。` : ''}
          </p>
          <Link
            href="/assess"
            className="insta-button mt-8 inline-block rounded-full px-8 py-4 text-base font-medium text-white"
          >
            免费测一测
          </Link>
        </div>
      </section>

      {/* ── 页脚 ───────────────────────────────────── */}
      <footer className="border-t border-white/70 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <BrandLogo href="" />
              <p className="mt-2 max-w-md text-xs leading-relaxed text-ink-400">
                Compass 提供留学信息服务与申请管理工具,不做学科培训,不代理申请,
                不承诺录取结果。
              </p>
            </div>
            <nav className="flex flex-wrap items-center gap-x-1 text-xs text-ink-400">
              <Link href="/pricing" className="inline-flex min-h-11 items-center px-2 hover:text-ink-700">
                价格
              </Link>
              <Link href="/legal/terms" className="inline-flex min-h-11 items-center px-2 hover:text-ink-700">
                用户协议
              </Link>
              <Link href="/legal/privacy" className="inline-flex min-h-11 items-center px-2 hover:text-ink-700">
                隐私政策
              </Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  )
}
