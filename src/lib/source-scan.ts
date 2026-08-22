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
 * 已经踩到五次:
 *   1. CI 的敏感词扫描,匹配到注释里的「禁止保录」和法律条文
 *   2. 导出完整性测试,匹配到注释里作为反例的 `versions: true`
 *   3. 限流测试,匹配到注释里解释「不认 X-Forwarded-For」的那句话
 *   4. 我自己写的 Python 守卫,匹配到注释里提到的 lib/source-scan.ts
 *   5. 评估页文案守卫,匹配到 JSX 注释里引用的那句被删掉的旧文案 ——
 *      新形态:JSX 注释的续行以中文开头,逐行过滤拦不住。为此补了区间剥离。
 *
 * 五次都是同一个形状:注释写得越清楚,越容易被自己的测试当成违规。
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
  const out: string[] = []
  /**
   * JSX 注释块要按**区间**剥,不能按行首。
   *
   * ⚠️ 第五次踩这个坑,而且是新形态。JSX 注释的续行以中文开头,
   *    行首既不是 // 也不是 *,老的逐行过滤一行都拦不住:
   *
   *        \{ 斜杠星
   *          ⚠️ 这句原来写的是「换个地区或方向再算一次」
   *        星斜杠 \}
   *
   *    于是「页面上不该再出现这句话」的守卫,被解释这句话为什么被删掉的
   *    注释本身判红。改注释的措辞能绕过去,但下一个人还会踩 —— 补工具。
   */
  let inJsxComment = false
  for (const line of src.split('\n')) {
    if (inJsxComment) {
      if (/\*\/\s*\}/.test(line)) inJsxComment = false
      continue
    }
    // 单行的 JSX 注释直接丢掉;没闭合的进入块状态
    if (/^\s*\{\s*\/\*/.test(line)) {
      if (!/\*\/\s*\}/.test(line)) inJsxComment = true
      continue
    }
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue
    out.push(line)
  }
  return out.join('\n')
}

/** 找出第一行包含某个片段的**代码**行(跳过注释) */
export function findCodeLine(src: string, needle: string): string | undefined {
  return codeOnly(src)
    .split('\n')
    .find((l) => l.includes(needle))
}
