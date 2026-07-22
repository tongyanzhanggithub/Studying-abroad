# Compass · AI 留学申请系统

按 `PRD-AI留学申请系统.md` 实现的 Web 端 P0 全链路。当前定位:**美国之外主流英语授课地区 × 硕士申请**。

---

## 快速开始

```bash
npm install

# 1. 配置环境变量
cp .env.example .env
#    把 DATABASE_URL 改成你的 Postgres 连接串(见下方「数据库」)

# 2. 建表 + 种子数据 + 导入院校数据
npm run db:push
npm run db:seed
npm run data:import

# 3. 建超级账号(后台 + 用户端)
ADMIN_EMAIL=你的邮箱 ADMIN_PHONE=你的手机号 npm run admin:create
#    密码只打印一次,不写进任何文件

# 4. 启动
npm run start:local  # 数据库 + 网站一起起,Ctrl+C 一起停
#    已有独立 Postgres 的话直接 npm run dev
```

要自己点着测,看 **[docs/本地测试.md](docs/本地测试.md)** —— 有测试顺序、账号、
以及一份「已知问题」清单(免得你把我已经知道的又报一遍)。

### 改完代码必须跑

```bash
npm run check        # typecheck + 生产构建
```

> ⚠️ **只跑 `typecheck` 不够。** 这个项目已经四次栽在「tsc 通过但 `next build` 失败」上:
> `'use server'` 文件导出非 async 函数、`export interface`、客户端组件引用了标了
> `server-only` 的模块、`useSearchParams()` 没包 Suspense。这些 tsc 一个都查不出来,
> 而部署脚本里跑的正是 `next build` —— 漏掉就是部署当场失败。

验证核心流程是否真的跑得通:

```bash
# 主转化漏斗:评估 → 线索 → 注册 → 支付 → 选校 → 材料 → 文书合规 → 推荐卡 → 数据变更推送
# 顺带验证支付幂等、金额篡改拦截、推荐卡冷却期
npx tsx --tsconfig scripts/tsconfig.json scripts/e2e-smoke.ts

# 分享裂变:A 分享 → B 完成评估 → A 解锁附加院校;含自分享防刷、无效码兜底
npx tsx --tsconfig scripts/tsconfig.json scripts/verify-referral.ts

# 交付闭环与月结分成:48h 自动确认、异议拦截、分成锁定、结算幂等
npx tsx --tsconfig scripts/tsconfig.json scripts/verify-settlement.ts

# 地区分批开放闸门:未开放地区对用户不可见、达标才能开放、撤下立即生效
npx tsx --tsconfig scripts/tsconfig.json scripts/verify-region-gate.ts
```

AI 采集的防编造规则(无 evidence 的字段必须丢弃)只有开发自检路由,不需要真实 LLM key:

```bash
curl -X POST -H "x-cron-secret: $AUTH_SECRET" localhost:3000/api/dev/verify-collect
```

任何一步失败都会非零退出。

> 这些脚本需要能**并发连接**的 Postgres。本地若用 PGlite 应急方案会连不上
> (它每进程只接受一次连接),此时可改用等价的开发自检路由 —— 它们跑在 dev server
> 进程内,复用已建立的那条连接(仅开发环境可用,生产返回 404):
>
> ```bash
> curl -X POST -H "x-cron-secret: $AUTH_SECRET" localhost:3000/api/dev/verify-settlement
> curl -X POST -H "x-cron-secret: $AUTH_SECRET" localhost:3000/api/dev/verify-region-gate
> ```

---

## 部署到服务器

单机部署(应用 + PostgreSQL + Nginx 一台机器)见 **[deploy/README.md](deploy/README.md)**,
三条命令跑完。针对 2GB 小内存做了 swap 与构建内存限制处理。

---

## 数据库

需要一个 **PostgreSQL 14+**。schema 用到了 enum、`String[]`、`Json`,SQLite 跑不了。

### 生产:必须用国内云

> ⚠️ **PRD 10.7 合规红线:用户数据存境内。**
> 阿里云 RDS PostgreSQL 或腾讯云 PostgreSQL。这条与 ICP 备案同属关键路径,
> 第 1 天就要启动申请,不要等开发完再办。

```
DATABASE_URL="postgresql://用户:密码@rm-xxxx.pg.rds.aliyuncs.com:5432/compass?schema=public&sslmode=require"
```

### 开发:任选其一

| 方案 | 说明 |
|---|---|
| 云端免费额度(Neon / Supabase) | 最省事,但**在境外**,只能用于开发,不能接真实用户 |
| 本机安装 PostgreSQL | `winget install PostgreSQL.PostgreSQL.17`,与生产行为最一致 |
| Docker | `docker run -d -p 5433:5432 -e POSTGRES_PASSWORD=x -e POSTGRES_DB=compass postgres:16` |

`scripts/db-local.ts`(`npm run db:start`)是一个基于 PGlite 的零安装应急选项,
本次就是用它完成建表与数据导入的。但**它每个服务进程只接受一次客户端连接** ——
跑完一条命令就要重启一次,dev server 连上后脚本更是完全连不上。
只适合应急,**不要用于日常开发**,请按上表任选一个真实 Postgres。

---

## 外部依赖的接入状态

全部走适配器,没接的用 mock 顶着,**不阻塞开发**:

| 依赖 | 当前 | 接入方式 |
|---|---|---|
| 微信支付 | `PAYMENT_PROVIDER=mock`,点击即支付成功 | 商户号下来后实现 `src/lib/payment/` 里的 wechat provider,`fulfillPayment` 复用不用改 |
| LLM | `LLM_PROVIDER=mock` | 后台 `/admin/settings` 直接填 key(加密存库,优先于 `.env`);也可继续用 `.env`。**PRD 10.4 要求境内合规模型** |
| 短信 | `SMS_PROVIDER=mock`,验证码打在服务端日志 | 阿里云短信,需营业执照 |
| 对象存储 | `STORAGE_PROVIDER=local`,存 `./uploads` | 换成 OSS/COS,**必须开启存储加密 + 签名 URL 访问** |
| 微信小程序订阅消息 | 未接,通知落库为 `pending` | 小程序类目资质下来后接入 |

---

## 定时任务(部署时必须配)

两个任务都用 `AUTH_SECRET` 做共享密钥保护,漏配会导致功能静默失效:

| 任务 | 建议频率 | 端点 | 不配的后果 |
|---|---|---|---|
| 截止日期提醒 | 每日 1 次(建议早 9 点) | `POST /api/cron/deadline-reminders` | 用户收不到 14/7/3/1 天提醒 |
| 服务订单自动确认 | 每日 1 次 | `POST /api/cron/auto-confirm` | 已交付订单永远停在待验收,交付人拿不到结算 |

```bash
curl -X POST -H "x-cron-secret: $AUTH_SECRET" https://你的域名/api/cron/auto-confirm
```

两者在有失败项时返回 **500**,便于监控告警。按 PRD 11.3,截止提醒任务失败需立即人工电话兜底。

## 目录结构

```
src/
  app/
    page.tsx              营销首页
    assess/               免费评估(3步表单 → 结果页)
    pricing/              定价 + 下单
    pay/mock/             模拟支付确认页
    login/                手机号验证码登录
    legal/                用户协议 / 隐私政策
    app/                  付费工作台(需登录 + 有效季票)
      onboarding/         首次引导:确认背景 → 选校单初稿 → 材料清单
      dashboard/          总览:行动引擎 + 提前预警 + 进度倒计时
      assessments/        我的评估方案:多份并排对比 + 按当前资料重算看变化
      schools/ school/    院校库检索 / 选校单 / 院校详情
      materials/          材料中心(自动合并去重)
      essays/ essay/      文书工作台
      services/           增值服务市场
      orders/             订单与退款
      settings/           资料 / 数据导出 / 账号注销
    advisor/              顾问工作台:只看派给自己的单(进不了运营后台)
    admin/                运营后台
      programs/           院校库 + 待核对工作队列(可编辑,保存即核对)
      collect/            AI 采集 + 待审队列(抽取结果强制人工审核后才进库)
      services/           人工服务目录(新增 / 改价 / 上下架 / 删除)
      pricing/            季票价格
      dispatch/           服务派单(状态机 + 异议处理)
      deliverers/         交付人档案
      accounts/           员工账号与角色(四种角色,只有超管能进)
      notifications/      待发送通知队列(渠道未接通前的人工兜底出口)
      settlement/         月结分成
      metrics/            数据看板(含 PRD 11.3 红线告警)
      leads/              线索表 + CSV 导出
      settings/           AI 服务配置(API key 加密存库)
    api/cron/             每日截止提醒 / 订单自动确认
    api/materials/[id]/file  材料下载(按归属校验,不按路径暴露)
  lib/
    assessment/           定位规则引擎(不用模型,规则表驱动)
    planner/              行动引擎:算「现在最该做的三件事」+ 提前预警
    recommendation/       情境化推荐引擎(规则表驱动 + 频次约束)
    collect/              AI 采集:抓取(含 SSRF 防护)+ 抽取(强制原文出处)
    services/dispatch.ts  服务订单状态机(服务端强制,不靠前端藏按钮)
    auth/password.ts      scrypt 密码哈希 + 强度校验
    storage/local.ts      本地文件 key 与路径逃逸校验
    essays/compliance.ts  文书合规检查器
    materials/generate.ts 材料清单合并去重 + 申请状态机
    payment/              支付适配器 + 履约(幂等 + 金额校验)
    notifications/        通知中心 + 数据变更推送
    llm/                  LLM 网关(多供应商可切换 + 每日配额)
data/raw/                 采集到的院校原始数据(310 条)
scripts/
  dev-all.ts              一条命令起数据库 + 网站(npm run start:local)
  create-admin.ts         建超级账号(npm run admin:create,密码只打印一次)
  import-programs.ts      院校数据导入(字段归一化 + 过期周期兜底)
  e2e-smoke.ts            主漏斗端到端冒烟
```

---

## 院校数据

`data/raw/` 下的商科项目数据已导入数据库;当前产品口径扩展到美国之外主流英语授课目的地。

### 地区分批开放(投放前必读)

PRD 11.3 规定未核对数据 >10% 就该暂停投放。地区一多,「全部核对完才能上线」
等于永远上不了线。所以闸门下放到地区:**哪个地区核对达标就先开哪个**。

- 后台 `/admin/regions` 是唯一的开放开关
- **默认全部关闭** —— 新导入的地区不会自动对用户可见
- 未开放地区在首页、免费评估、选校库里**完全不出现**(不是灰掉)
- 达标(默认核对率 ≥90% 且项目数 ≥25)只是显示「可以开放了」,**仍需人工点一下**
- 发现问题可随时「撤下」,不设门槛

### AI 采集(后台 `/admin/collect`)

补数据可以让 AI 从官网页面抽,但**抽出来的东西不算数**:

```
学校列表页 → 发现候选项目链接 → 人工勾选 → AI 逐个抽取
                                              ↓
                              ProgramDraft 表(待审)
                                              ↓
                                    人工逐字段审核 → Program 表
```

三种入口:

| 入口 | 用在什么时候 |
|---|---|
| **按学校采集** | 补一整所学校。给学院的授课型硕士总览页,自动列出候选项目让你勾 |
| 按链接采集 | 已经知道具体是哪几个项目页 |
| 粘贴正文采集 | 官网前端渲染 / 抓不到 / 信息在 PDF 里。国内服务器抓国外官网经常不通,这条是主力路径 |

「按学校采集」拆成两步而不是一键到底:**查找**只抓一个页面 + 正则,不调模型、基本不花钱;
**抽取**每条一次模型调用。所以默认**一条都不勾**(早先版本默认全勾,PolyU 那种列表页
一次就是 144 条,误点一下钱就出去了),单批上限 40 条。

中间那一步是硬性的,没有任何代码路径能跳过。几条关键设计:

- **强制原文出处** —— prompt 要求每个字段附一段页面原文;拿不出出处的值在
  `normalize()` 里直接丢成 null,并在审核页标红。这是防「一本正经地编」最有效的一招。
- **采纳 ≠ 已核对** —— 采纳默认写成 `ai_collected`(进待核对队列)。
  要标 `verified` 得审核人自己勾,因为「扫一眼没发现问题」不等于「对照官网核对过」。
- **没有 key 时功能直接不可用**,不退回 mock —— mock 的假数据混进待审队列比功能不可用危险得多。
- 抓取做了 SSRF 防护(拒绝私有地址、云元数据地址、非 http(s)、逐跳校验跳转)——
  URL 是从输入框来的,不挡的话填 `100.100.100.200` 就能让服务器把云凭据抓回来显示。
- 链接发现**只收同域链接**。列表页上必然有外链,放开域名等于让「页面上写了什么」
  决定服务器去抓什么,而页面内容是不可信输入。

**全部标记为 `ai_collected` / `lastVerifiedAt = null`,即「待人工核对」。**

这是 PRD 4.2 的红线要求。具体表现:

- 前端展示时带「待核实」标记,并提示以官网为准
- 院校详情页列出全部官方来源链接,供核对
- 后台 `/admin/programs` 有待核对工作队列,逐条核对后点「标记为已核对」
- 未核对/超 30 天占比 >10% 时,后台看板与院校库页会告警,提示**暂停投放**

其中 **48 条**采集到的是上一届(已截止)的申请周期,导入脚本已自动把过期日期置空并存档到
`deadlines.notes` —— 过期日期比没有日期更危险,用户会照着它规划。
另有 **2 条**被识别为纯线上项目(不支持学生签证),已标记 `isOnlineOnly`。

数据覆盖(共 310 条,11 个地区):

| 地区 | 条数 | 距离开放门槛(≥25 条) |
|---|---|---|
| 英国 | 139 | 够 |
| 中国香港 | 51 | 够 |
| 新加坡 | 34 | 够 |
| 加拿大 | 20 | 差 5 |
| 澳大利亚 | 17 | 差 8 |
| 中国澳门 | 12 | 差 13 |
| 荷兰 | 12 | 差 13 |
| 德国 | 9 | 差 16 |
| 韩国 | 7 | 差 18 |
| 爱尔兰 | 6 | 差 19 |
| 日本 | 3 | 差 22 |

条数够只是**能不能开放**的前提,还要核对率 ≥90%。目前 11 个地区核对率都是 0%。

---

## 已知缺口

诚实列出,不要当成已完成:

1. **数据 100% 未经人工核对** —— 310 条全部是 AI 采集,`confidence = ai_collected`。
   这是最大的一条风险,也是 PRD 11.3 明确的投放前置条件:
   未核对占比降到 10% 以下之前不应开始投放。
2. **定位规则表是初始估值** —— `prisma/seed.ts` 里 1080 条 `AdmissionRule` 的概率区间来自
   公开录取数据的经验区间,**不是统计结果**。必须用真实录取案例校准,否则评估结果的可信度撑不住。
3. **法律文本未过审** —— `/legal/terms` 与 `/legal/privacy` 是与产品实际行为对齐的技术草稿,
   页面顶部有醒目提示。上线前必须经执业律师依《个人信息保护法》审核定稿。
4. **通知一条都发不出去** —— 微信订阅消息 / 短信 / 邮件渠道都没接,
   所有通知停在 `pending`,靠 `/admin/notifications` 人工兜底。
   接渠道需要小程序教育类目资质与营业执照,在备案那条串行路径上。
5. **退款只改状态,钱没真退** —— 支付适配器是 mock。
   「转退款」把订单置为 `refunding` 就结束了,接微信支付商户号时要一起打通。
6. **上传的材料明文存本机磁盘** —— 只有应用层权限校验(`/api/materials/[id]/file` 验归属)。
   正式接用户前应换 OSS/COS:存储侧加密 + 带过期时间的签名 URL。备份文件同样含明文材料。
7. **小程序端未开发** —— PRD 定位为获客前端,Web 交付跑通后再做。
   分享裂变目前是**链接分享**;PRD 9 描述的「图片卡片 + 小程序码」需要小程序资质到位后再补。
8. **推荐信管理 / AI 模拟面试 / 支付宝** —— 按 PRD 12 裁剪表属 P1,本次未做。
9. **院校只分两级** —— `inferSchoolTier` 目前只区分 t1/t2,导致同一用户看到的概率只有两个值
   (牛津、剑桥、LSE 显示相同概率),也是「保底档常年为 0」的根因。
   要提高区分度需要 3-4 级分档,但哪所学校算哪级是编辑判断,
   建议由运营在后台 `competitiveness` 字段逐校标注。

---

## 非开发的关键路径(创始人办)

PRD 2.3 已点明,但没进里程碑表,这里再列一次 —— 这条线是串行的,**第 1 天就要启动**:

```
注册公司 → 营业执照 → ICP 备案(2-3周) → 微信支付商户号(约1周) → 小程序教育类目资质
                    ↘ 国内云 Postgres(数据境内,PRD 10.7)
```

开发第 8 周做完但备案没下来,一样上不了线。

---

## 常用命令

```bash
npm run start:local  # 数据库 + 网站一起起(本地用这个)
npm run dev          # 只起网站(已有独立 Postgres 时用)
npm run check        # typecheck + 生产构建 —— 改完代码跑这个,别只跑 typecheck
npm run build        # 生产构建
npm run typecheck    # 只查类型(查不出 Next 编译期的问题)
npm run db:push      # 同步 schema 到数据库
npm run db:seed      # 写入种子数据(套餐/材料模板/SKU/推荐规则/prompt/定位规则)
npm run db:studio    # Prisma Studio 可视化查看数据
npm run data:import  # 导入 data/raw/ 下的院校数据
npm run admin:create # 建超级账号(密码只打印一次,不写进任何文件)
```

**员工登录入口只有一个** `/admin/login`,登录后按角色分流:运营进后台,交付顾问进 `/advisor`。

开发环境会自带一个 `admin@compass.local` / `compass-dev` 的超管账号;
`NODE_ENV=production` 时种子脚本会跳过它,部署脚本已带上这个变量。
