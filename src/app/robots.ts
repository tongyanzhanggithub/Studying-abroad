import type { MetadataRoute } from 'next'

/**
 * 爬虫规则。
 *
 * 为什么需要:免费评估结果页(/assess/result/[leadId])是公开可访问的,
 * 里面有具体的院校定位结论;学生工作台 /app 和后台 /admin 虽然有登录墙,
 * 但路径本身不该被搜索引擎收录、拿去做站点地图。
 *
 * 只挡收录,不挡访问 —— robots 不是访问控制,真正的门是登录态。
 * 这里的作用是:别让评估结论和后台路径出现在搜索结果里。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      // 首页、定价、法律页可以被收录;其余一律不收
      allow: ['/'],
      disallow: ['/app/', '/admin/', '/advisor/', '/assess/result/', '/pay/', '/api/', '/r/'],
    },
  }
}
