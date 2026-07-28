import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pageMetadata, OG_IMAGE } from '@/lib/seo'

/**
 * 分享卡片的元数据。
 *
 * 这里防的是一个**页面上完全看不出来**的退化:Next 的 metadata 是浅合并的,
 * 子页面只要自己写 `openGraph`,root layout 那份就被整个替换,og:image 随之消失。
 * 标题描述都还是对的,只有真分享到微信才发现没有缩略图 ——
 * 而那时候功能早就上线、用户早就在分享了。
 *
 * 所以两道:pageMetadata 自己必须带全字段;各页面必须走 pageMetadata。
 */

const SRC = join(process.cwd(), 'src')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

describe('pageMetadata 产出的字段是齐的', () => {
  const meta = pageMetadata({ title: '价格', description: '描述文字' })

  it('带 og:image —— 这是整件事的重点', () => {
    expect(meta.openGraph?.images).toEqual([OG_IMAGE])
  })

  it('twitter 卡片是大图,不是默认的 summary 小图', () => {
    expect((meta.twitter as { card?: string })?.card).toBe('summary_large_image')
    expect((meta.twitter as { images?: unknown })?.images).toEqual([OG_IMAGE.url])
  })

  it('og:title 带品牌名 —— 分享卡是脱离站点单独出现的', () => {
    expect(meta.openGraph?.title).toBe('价格 · Compass')
    // 页面 <title> 走 root layout 的 template,这里不重复拼
    expect(meta.title).toBe('价格')
  })

  it('og 描述与页面描述一致', () => {
    expect(meta.openGraph?.description).toBe('描述文字')
    expect(meta.description).toBe('描述文字')
  })

  it('og:image 用相对路径 —— 由 metadataBase 拼成绝对地址', () => {
    // 写死绝对域名的话,换域名 / 多环境就全错了
    expect(OG_IMAGE.url.startsWith('/')).toBe(true)
    expect(OG_IMAGE.width).toBe(1200)
    expect(OG_IMAGE.height).toBe(630)
  })
})

describe('各页面必须走 pageMetadata,不许手写 openGraph', () => {
  const PAGES = ['app/assess/layout.tsx', 'app/pricing/page.tsx']

  it.each(PAGES)('%s 用的是 pageMetadata', (rel) => {
    expect(read(rel)).toContain('pageMetadata')
  })

  it.each(PAGES)('%s 没有手写 openGraph(会覆盖掉 og:image)', (rel) => {
    expect(read(rel)).not.toContain('openGraph')
  })

  it('root layout 声明了 metadataBase,否则 og:image 拼不出绝对地址', () => {
    const layout = read('app/layout.tsx')
    expect(layout).toContain('metadataBase')
    expect(layout).toContain('openGraph')
  })
})
