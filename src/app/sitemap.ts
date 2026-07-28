import type { MetadataRoute } from 'next'
import { env } from '@/lib/env'

/**
 * 站点地图。
 *
 * ⚠️ 只列**公开且希望被收录**的页面,和 robots.ts 的 disallow 严格对应 ——
 *    两份清单打架的话(sitemap 提交了一个 robots 又禁掉的地址)是给搜索引擎
 *    发矛盾信号,反而拖累收录。
 *
 *    所以这里刻意**不列**:
 *      · /assess/result/[leadId] —— 公开可访问,但里面是具体的院校定位结论,
 *        属于用户自己的东西,不该出现在搜索结果里
 *      · /r/[shareCode]         —— 分享跳转,收录它没有意义
 *      · /app /admin /advisor /pay /api —— 登录墙后面
 *
 * ⚠️ 这是一份**手写的静态清单**,不从数据库生成。院校库页面在登录墙后面,
 *    没有可收录的动态页;等以后真做了公开的院校详情页,再在这里加。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = env.siteUrl.replace(/\/$/, '')
  const now = new Date()

  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/assess`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${base}/pricing`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/legal/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/legal/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ]
}
