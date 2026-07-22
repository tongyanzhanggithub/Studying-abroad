import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
  type ScryptOptions,
} from 'node:crypto'

/**
 * promisify 只会挑 scrypt 的 3 参数重载,带 options 的那个签名会丢,
 * 所以这里手写一层,而不是 promisify(scryptCb)。
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
}

/**
 * 后台密码哈希。
 *
 * ── 为什么不是 sha256 ────────────────────────────────────
 * 之前用的是裸 sha256:无盐、无迭代、单次运算。现代 GPU 每秒能算几百亿次,
 * 这种哈希拖库之后基本等于明文 —— 常见密码几秒就能撞出来,
 * 而且无盐意味着两个人用同一个密码会得到同一个哈希,一撞全撞。
 *
 * 这里用 Node 内置的 scrypt:每个密码独立随机盐,而且是**内存硬**的 ——
 * 攻击者没法靠堆 GPU 来线性加速。不引第三方依赖(bcryptjs / argon2)
 * 是因为 scrypt 由 Node 官方维护,少一个供应链面。
 *
 * 存储格式:scrypt$N$r$p$salt_b64$hash_b64,把参数写进去,
 * 以后调强参数时旧密码仍然验得过。
 */

// N=16384 约 16MB 内存 / 次,登录场景下耗时几十毫秒,可接受
const N = 16_384
const R = 8
const P = 1
const KEY_LEN = 64

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(plain.normalize('NFKC'), salt, KEY_LEN, {
    N,
    r: R,
    p: P,
    // Node 默认 maxmem 32MB,N=16384 时刚好够;显式给足避免 ERR_CRYPTO_INVALID_SCRYPT_PARAMS
    maxmem: 64 * 1024 * 1024,
  })
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$')
}

/**
 * 校验密码。
 *
 * 兼容旧的裸 sha256 哈希(seed 里那个开发账号),校验通过后由调用方
 * 负责升级 —— 见 src/app/admin/login/actions.ts。不这么做的话,
 * 换了算法之后所有存量账号会直接登不上。
 */
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (!stored) return { ok: false, needsUpgrade: false }

  if (stored.startsWith('scrypt$')) {
    const [, nStr, rStr, pStr, saltB64, hashB64] = stored.split('$')
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(hashB64, 'base64')
    let key: Buffer
    try {
      key = await scrypt(plain.normalize('NFKC'), salt, expected.length, {
        N: Number(nStr),
        r: Number(rStr),
        p: Number(pStr),
        maxmem: 256 * 1024 * 1024,
      })
    } catch {
      return { ok: false, needsUpgrade: false }
    }
    // 定长比较用 timingSafeEqual,避免按字节提前返回泄露信息
    const ok = key.length === expected.length && timingSafeEqual(key, expected)
    return { ok, needsUpgrade: ok && Number(nStr) < N }
  }

  // ── legacy:裸 sha256(仅存量开发账号)────────────────
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    const legacy = createHash('sha256').update(plain).digest('hex')
    const a = Buffer.from(legacy, 'hex')
    const b = Buffer.from(stored, 'hex')
    const ok = a.length === b.length && timingSafeEqual(a, b)
    return { ok, needsUpgrade: ok }
  }

  return { ok: false, needsUpgrade: false }
}

/**
 * 密码强度校验。
 *
 * 只拦真正危险的:太短、纯数字、以及一眼就在字典里的那几个。
 * 不做「必须含大小写+符号」那种规则 —— 它逼出来的是 Passw0rd! 这种
 * 既难记又好猜的密码,长度才是真正有用的维度。
 */
const WEAK = [
  'password', '12345678', 'admin123', 'compass', 'qwerty', 'abc123',
  'letmein', 'admin888', '11111111', '88888888',
]

export function checkPasswordStrength(pwd: string): string | null {
  if (pwd.length < 12) return '密码至少 12 位。长度比复杂度管用得多。'
  if (/^\d+$/.test(pwd)) return '不要用纯数字。'
  const lower = pwd.toLowerCase()
  if (WEAK.some((w) => lower.includes(w))) return '包含了常见弱口令片段,换一个。'
  return null
}

/** 生成一个足够强、还能手抄的随机密码 */
export function generatePassword(): string {
  // 去掉 0/O/1/l/I 这些抄错率高的字符
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(20)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 15)}-${out.slice(15, 20)}`
}
