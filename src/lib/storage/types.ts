import 'server-only'

/**
 * 存储 provider 接口。local 与 oss 都实现它,业务代码只依赖这里。
 */
export interface StorageProvider {
  readonly kind: 'local' | 'oss'

  /** 写入。contentType 用于对象存储回传正确的 Content-Type。 */
  put(key: string, bytes: Buffer, contentType: string): Promise<void>

  /**
   * 读回明文字节。找不到返回 null(不是抛错)——
   * 「数据库有记录但文件没了」是个要区分对待的正常情况。
   */
  get(key: string): Promise<Buffer | null>

  /** 删除。用于敏感材料到期清理(PIPL:不该无限期留着护照)。 */
  remove(key: string): Promise<void>

  /**
   * 带过期时间的直读 URL。
   *
   * 对象存储返回一个几分钟有效的签名 URL,让浏览器直连 OSS 拉文件,
   * 不经过应用服务器(省带宽)。**调用方必须在生成前先做归属校验** ——
   * 签名 URL 一旦发出,在有效期内谁拿到都能访问。
   *
   * 本地磁盘没有这个能力,返回 null;调用方据此降级为经应用流式返回。
   */
  signedUrl(key: string, ttlSeconds: number): Promise<string | null>
}
