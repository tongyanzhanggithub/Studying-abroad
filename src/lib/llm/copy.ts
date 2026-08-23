/**
 * 工作台里所有「AI 能帮你做什么」的文案 —— 按模型接没接通分叉。
 *
 * ── 为什么要有这个文件 ────────────────────────────────
 *
 * `lib/llm/availability.ts` 就是为了解决「宣传了一个还不能用的功能」而写的,
 * 它的注释里写着:
 *
 *     「首页曾经在宣传『AI 问问题、素材追问、逐句润色』,而 LLM_PROVIDER=mock ——
 *       用户付了钱点进去,拿到的是『AI 助手正在接入中,暂时不可用』。」
 *
 * ⚠️ 但那次只修了**营销首页**。isAiAvailable() 全项目只有 src/app/page.tsx 一处调用,
 *    而工作台 —— 也就是用户**真正付了钱才能进的地方** —— 三处照旧无条件宣传:
 *
 *      1. /app/dashboard 新手四步的第 3 步
 *      2. /app/essays 页头
 *      3. /app/essay/[id] 文书工作台里的三个 AI 入口
 *
 *    实测:在文书里发一句话,拿到的是
 *      「[MOCK 响应 · 未配置真实 LLM] 请在 .env 中配置 LLM_PROVIDER 与对应 API key 后重试。」
 *    —— 一句开发者报错,原样展示给付费用户。
 *
 *    比首页那次更严重:首页只是话说大了,这里是**收了钱之后**没兑现。
 *
 * ⚠️ 这个文件**不能 import 'server-only'**。Workbench 是 'use client' 组件,
 *    要从这里取「不可用」那段提示;而 dashboard / essays 是 server component。
 *    所以这里只放纯字符串和纯函数,一个副作用都不许有。
 *    (反过来也别把这些文案写进客户端组件再让 server component import ——
 *     那样拿到的是 client reference,属性访问全是 undefined,
 *     类型检查和构建都不报错。lib/auth/roles.ts 的注释里记着这个坑。)
 */

/** 模型没接通时,统一的一句解释。三处共用,改一次就够。 */
export const AI_OFF_NOTE =
  'AI 辅助(素材追问、结构建议、逐句润色)还在接入中,接通前不会向你收取与它相关的费用。'

/** 新手四步的第 3 步「写文书」 */
export function essayStepDesc(aiReady: boolean): string {
  return aiReady
    ? 'AI 通过提问帮你挖素材、给结构建议、逐句改语法 —— 文字得是你自己的'
    : '按学校分开写,题目和字数各自记着;定稿前有合规检查。AI 辅助还在接入中'
}

/** /app/essays 页头 */
export function essayIntro(aiReady: boolean): string {
  return aiReady
    ? '这里的 AI 是你的写作工具,不是代笔。它会通过提问帮你挖出素材、给结构建议、逐句改语法 —— 但文字必须是你自己的。'
    : `每所学校的题目和字数要求不一样,这里按学校分开写,写到哪一步一目了然;定稿前有合规检查。${AI_OFF_NOTE}`
}

/**
 * 文书工作台里三个 AI 标签页的说明。
 *
 * ⚠️ 「合规」那一页**不受影响** —— checkCompliance 是规则检查,不调模型,
 *    现在就能用。把它一起灰掉等于白白关掉一个能用的功能。
 */
export function interviewHint(aiReady: boolean): string {
  return aiReady
    ? 'AI 会一次问一个问题,帮你把经历讲具体。它不会替你写文书 —— 要求它写整段会被拒绝。'
    : AI_OFF_NOTE
}
