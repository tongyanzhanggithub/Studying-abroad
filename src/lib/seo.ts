import type { Metadata } from 'next'

/**
 * 页面级 metadata 的统一出口。
 *
 * ⚠️ 存在的理由是一个**很容易踩、而且不会报错**的坑:
 *
 *    Next 的 metadata 是**浅合并**的。子页面只要写了 `openGraph`,
 *    父级(root layout)那份就被**整个替换**掉,不是逐字段合并 ——
 *    于是只写了 title/description 的子页面会把 og:image 一起弄丢,
 *    `twitter.card` 也会从 summary_large_image 掉回 summary(小图)。
 *
 *    而这件事在页面上完全看不出来:标题是对的、描述是对的,只有真的分享到
 *    微信才会发现缩略图没了 —— 也就是说要等到功能已经上线、用户已经在分享了,
 *    才可能有人注意到。所以别在各页面手写 openGraph,一律走这里。
 *
 *    (这个坑不是推理出来的:第一版就是各页面自己写 openGraph,
 *     检查构建产物的 HTML 时才发现 /assess 的 og:image 真的不见了。)
 */

const SITE_NAME = 'Compass'

/**
 * 分享卡片图。
 *
 * ⚠️ og:image 只认**绝对 URL**,由 root layout 的 metadataBase 拼出来,
 *    而 metadataBase 取自 NEXT_PUBLIC_SITE_URL。静态预渲染的页面(/assess 等)
 *    是在 **build 时**定下这个地址的 —— 也就是说 `npm run build` 那一刻
 *    .env 里的 NEXT_PUBLIC_SITE_URL 必须已经是真实域名,
 *    否则线上分享卡里的图片地址会是 localhost。
 *    deploy.sh 是在 .env 就位之后才构建的,正常流程下没问题。
 */
export const OG_IMAGE = {
  url: '/images/og-cover.webp',
  width: 1200,
  height: 630,
  alt: SITE_NAME,
} as const

export function pageMetadata(params: { title: string; description: string }): Metadata {
  // og:title 要带品牌名 —— 分享卡片是脱离站点单独出现的,只写「价格」没人知道是谁的
  const shareTitle = `${params.title} · ${SITE_NAME}`

  return {
    title: params.title,
    description: params.description,
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'zh_CN',
      title: shareTitle,
      description: params.description,
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: shareTitle,
      description: params.description,
      images: [OG_IMAGE.url],
    },
  }
}
