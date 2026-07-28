import type { Metadata } from 'next'
import { env } from '@/lib/env'
import './globals.css'

const TITLE = 'Compass · 留学申请 AI 操作系统'
const DESCRIPTION =
  '自己完成留学申请的 AI 工具:选校定位、材料管理、文书素材与润色、截止日期追踪。账号与材料 100% 归你所有。'

/**
 * 全站 metadata 基线。子页面覆盖 title/description,openGraph 自动继承。
 *
 * ⚠️ 为什么要有 openGraph:PRD 9 把分享裂变列为 P0,产品里也确实做齐了 ——
 *    结果页的分享卡、/r/[shareCode] 跳转、assess_share 埋点、看板上的裂变漏斗。
 *    但在这之前**全站一处 og 标签都没有**,分享进微信只有一行标题、没有缩略图。
 *    带图的卡片和不带图的点击率差着量级 —— 等于把已经做好的功能自己废掉一半。
 *
 * ⚠️ metadataBase 必须给,否则 Next 拼不出绝对 URL,而 og:image **只认绝对地址**,
 *    相对路径在微信里的表现就是不显示图。它取自 NEXT_PUBLIC_SITE_URL,
 *    所以域名配好之前分享卡不会有图 —— 这是预期内的,不是 bug。
 */
export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: {
    default: TITLE,
    // 子页面只写自己那一段,品牌名统一在这里接
    template: '%s · Compass',
  },
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: 'Compass',
    locale: 'zh_CN',
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: '/images/og-cover.webp', width: 1200, height: 630, alt: 'Compass' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/images/og-cover.webp'],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
