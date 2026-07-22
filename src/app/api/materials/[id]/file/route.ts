import { NextResponse, type NextRequest } from 'next/server'
import { extname } from 'node:path'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/session'
import { getAdminSession } from '@/lib/auth/session'
import { getStorage } from '@/lib/storage'

/** 签名 URL 的有效期:够浏览器发起一次请求即可,不留长尾 */
const SIGNED_URL_TTL_SECONDS = 120

/**
 * 取回学生上传的材料文件。
 *
 * ⚠️ 这个接口以前不存在。上传写到磁盘、`fileUrl` 存成 `/uploads/...`,
 *    但 Next 只静态服务 public/,那个地址永远 404 ——
 *    学生传了成绩单,他自己打不开,运营也看不到。上传功能是个黑洞。
 *
 * ── 为什么按材料 ID 取而不是按路径 ──────────────────────
 * 如果直接把 uploads 目录暴露成静态资源,`/uploads/<别人的userId>/...`
 * 就能翻到别人的护照和身份证扫描件 —— 只要猜到 id。
 * 这类越权(IDOR)在上传功能里是最常见的一种。
 *
 * 所以走这条路由:先认人,再查这条材料归谁,不是本人(或管理员)一律 404。
 * 返回 404 而不是 403 —— 403 等于告诉对方「这个 id 是存在的」。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const material = await db.userMaterial.findUnique({
    where: { id },
    include: { template: { select: { name: true } } },
  })
  if (!material || !material.fileUrl) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const user = await getCurrentUser()
  const isOwner = user?.id === material.userId

  // 运营需要能看学生材料来做交付,但这是敏感数据,只给 operator 及以上
  const admin = isOwner ? null : await getAdminSession()
  const isStaff = admin !== null && admin.role !== 'data_entry'

  if (!isOwner && !isStaff) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const storage = getStorage()

  /**
   * 对象存储:签发一个短时效 URL 让浏览器直连拉文件,不经过应用服务器。
   *
   * ⚠️ 归属校验(上面那几步)已经过了才走到这里 —— 签名 URL 只在确认是本人/
   *    运营之后才发,且有效期 120 秒。桶本身是私有的,没有签名谁都拉不到。
   */
  const signed = await storage.signedUrl(material.fileUrl, SIGNED_URL_TTL_SECONDS)
  if (signed) {
    return NextResponse.redirect(signed, {
      headers: { 'cache-control': 'private, no-store, max-age=0' },
    })
  }

  // 本地存储:经应用流式返回(存储层负责解密)
  const buf = await storage.get(material.fileUrl)
  if (!buf) {
    // 数据库有记录但文件没了 —— 换过机器、或者部署时没把 uploads 带过来
    return NextResponse.json(
      { error: '文件在服务器上找不到了,请重新上传' },
      { status: 410 },
    )
  }

  const ext = extname(material.fileName ?? '').toLowerCase()
  const type =
    ext === '.pdf'
      ? 'application/pdf'
      : ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : 'application/octet-stream'

  const filename = encodeURIComponent(material.fileName ?? `${material.template.name}${ext}`)

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'content-type': type,
      // inline:PDF/图片直接在浏览器里看,不强制下载
      'content-disposition': `inline; filename*=UTF-8''${filename}`,
      // 个人敏感材料,任何一层都不许缓存
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  })
}
