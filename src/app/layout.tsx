import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Compass · 留学申请 AI 操作系统',
  description:
    '自己完成留学申请的 AI 工具:选校定位、材料管理、文书素材与润色、截止日期追踪。账号与材料 100% 归你所有。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
