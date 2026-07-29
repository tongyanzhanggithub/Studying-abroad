/**
 * 源码文本扫描的小工具 —— 只给测试用。
 *
 * ── 为什么需要 ────────────────────────────────────────
 *
 * 这个项目里有一批「结构性守卫」测试:读源码文本,断言某个模式在或不在
 * (比如「每个改 Program 的 action 都要调 revalidateTag」「不许手写 openGraph」
 * 「只认 X-Real-IP」)。这类断言很有用,但有一个固定的坑:
 *
 *   **注释里往往正好写着那个反例。**
 *
 * 已经踩到三次:
 *   1. CI 的敏感词扫描,匹配到注释里的「禁止保录」和法律条文
 *   2. 导出完整性测试,匹配到注释里作为反例的 `versions: true`
 *   3. 限流测试,匹配到注释里解释「不认 X-Forwarded-For」的那句话
 *
 * 三次都是同一个形状:注释写得越清楚,越容易被自己的测试当成违规。
 * 所以统一走这里,别再各写各的。
 */

/**
 * 去掉注释行,只留代码。
 *
 * 处理的是**整行注释**(`//`、`/*`、块注释里以 `*` 开头的续行),
 * 这已经覆盖了上面三种情况。刻意不做完整的词法分析 ——
 * 那需要真正的解析器,而这里只是让守卫测试别被自己的说明文字绊倒。
 *
 * ⚠️ 行尾注释(`const a = 1 // 说明`)保留。要断言的模式如果可能出现在行尾注释里,
 *    就不该用文本扫描,应该断言运行时行为。
 */
export function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n')
}

/** 找出第一行包含某个片段的**代码**行(跳过注释) */
export function findCodeLine(src: string, needle: string): string | undefined {
  return codeOnly(src)
    .split('\n')
    .find((l) => l.includes(needle))
}
