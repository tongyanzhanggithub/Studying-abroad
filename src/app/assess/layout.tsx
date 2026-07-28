import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

/**
 * 评估页自己的 metadata。
 *
 * ⚠️ 只能放在 layout 里 —— page.tsx 是 `'use client'`,客户端组件不能导出 metadata。
 *
 * 这一页是**分享链接的落地页**(/r/[shareCode] 最终跳到这里),
 * 所以它的标题和描述直接决定别人在微信里看到的那张卡片写什么。
 * 文案按 PRD 10.1 的红线来:不出现「保录」「100%」这类词。
 */
export const metadata: Metadata = pageMetadata({
  title: '免费测一测:你能申哪些学校',
  description:
    '填本科背景、成绩和目标地区,一分钟得到一份分冲刺 / 匹配 / 保底三档的院校名单。基于公开录取要求的预估参考,不承诺录取。',
})

export default function AssessLayout({ children }: { children: React.ReactNode }) {
  return children
}
