# 部署到阿里云 ECS(Ubuntu 24.04)

面向单机部署:应用 + PostgreSQL + Nginx 全在一台机器上。
适合先跑通、做演示。正式接真实用户前请看最后一节。

> 🔒 **上云之后的安全加固(安全组/SSH/RAM/OSS/WAF/监控/合规)是单独一份清单:
> [`deploy/云上安全.md`](云上安全.md)。** 这份 README 讲怎么把它跑起来,
> 那份讲怎么让它安全地接真实用户 —— 接用户前 P0 项必须全绿。

---

## 一、上传代码

在**本地**执行(Windows 用 Git Bash / WSL,或用 WinSCP 之类的工具):

```bash
# 打包时排除本地产物,只传源码和数据
tar --exclude=node_modules --exclude=.next --exclude=.git --exclude=.pgdata \
    -czf compass.tar.gz .

scp compass.tar.gz root@8.208.125.209:/tmp/
ssh root@8.208.125.209
```

在**服务器**上:

```bash
mkdir -p /opt/compass && cd /opt/compass
tar -xzf /tmp/compass.tar.gz
```

> ⚠️ `data/raw/*.json`(310 条院校数据)在 `.gitignore` 里。
> 如果你是用 `git clone` 而不是上面的 tar 包,这些文件不会带过去,
> 需要单独传:`scp -r data/raw root@8.208.125.209:/opt/compass/data/`

---

## 二、三条命令跑完

```bash
cd /opt/compass

sudo bash deploy/setup-server.sh   # 加 swap、装 Postgres/Node/Nginx、开防火墙
sudo bash deploy/setup-db.sh       # 建库建账号、生成 .env(密码随机)
sudo bash deploy/deploy.sh         # 装依赖、建表、导数据、构建、起服务
```

**第四步:建你自己的账号**(脚本跑完会提醒你,不建的话进不去后台)

```bash
ADMIN_EMAIL=你的邮箱 ADMIN_PHONE=你的手机号 npm run admin:create
```

密码**只打印一次**,当场存进密码管理器。`ADMIN_PHONE` 会顺带开一个带 Pro 季票的
前台账号,方便你自己走一遍用户流程。

跑完访问 `http://8.208.125.209`。

**别忘了在阿里云控制台的安全组里放行 80 端口** —— 脚本只能配服务器自己的防火墙,
云厂商那层安全组得你在控制台点。

> **部署完前台是空的,这是对的。**
> 所有地区默认关闭(数据没核对完就不该放出去),首页会显示 0 个项目,
> 免费评估会提示「暂无可选地区」。去 `/admin/regions` 核对达标后才能开放。

---

## 三、为什么先加 swap

这台机器只有 2 GiB 内存,Next.js 生产构建峰值能吃到 1.5–2 GB。
不加 swap 大概率在 `npm run build` 时被 OOM Killer 杀掉,而且报错通常只有一行
`Killed` —— 很难一眼看出是内存问题,容易白折腾半天。

`setup-server.sh` 会加 4GB swap 并把 `vm.swappiness` 调到 30。
`deploy.sh` 还会给 Node 设 `--max-old-space-size=1536`,让它在撑爆系统前先自己回收。

---

## 四、日常操作

```bash
# 只更新代码(跳过种子和院校数据导入,快很多)
sudo SKIP_DATA=1 bash deploy/deploy.sh

journalctl -u compass -f          # 实时日志
systemctl restart compass         # 重启
systemctl status compass          # 状态

# 数据库
sudo -u postgres psql compass
npx prisma studio                 # 可视化查数据(需在 /opt/compass 下)
```

定时任务已写入 `/etc/cron.d/compass`(每天 9:00 发截止提醒、9:10 自动确认订单),
执行日志在 `/var/log/compass-cron.log`。

> **`SKIP_DATA=1` 跳过的是种子和院校数据导入,不跳过 `prisma db push`** ——
> schema 有变更时照样会同步。如果 push 提示可能丢数据,它会**停下来**而不是硬改,
> 这时要人看一眼再决定,不要无脑加 `--accept-data-loss`。
>
> 重新部署**不会动 `uploads/`**(学生传的材料)。

---

## 四点五、员工账号与角色

后台 `/admin/accounts`(只有超级管理员进得去)。四种角色:

| 角色 | 能做什么 |
|---|---|
| 超级管理员 | 全部,含价格、AI key、账号管理 |
| 运营 | 派单、核对数据、处理异议、通知队列、线索 |
| 数据录入 | 只能核对院校数据 |
| 交付顾问 | **只看派给自己的单**,进不了运营后台任何一页 |

顾问和运营用**同一个登录入口** `/admin/login`,登录后按角色自动分流 ——
顾问进 `/advisor`,手打 admin 地址会被弹回去。

顾问账号必须关联一个交付人档案(先去 `/admin/deliverers` 建档)。
档案管「分成比例、联系方式、接单记录」,账号管「能不能登录、看得到什么」——
有些交付人只是偶尔接单,没必要给登录权限。

**学生不在这里。** 学生用手机号登录、走另一套体系。

---

## 五、绑域名 + HTTPS

域名解析到 `8.208.125.209` 之后:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名
```

certbot 会自动申请证书、改 Nginx 配置、配好 80 → 443 跳转。

**改完记得同步改 `.env`**:

```
NEXT_PUBLIC_SITE_URL="https://你的域名"
```

分享裂变的链接是拿这个变量拼的,不改会一直生成旧的 http 地址。改完 `systemctl restart compass`。

---

## 六、这台机器能做什么、不能做什么

**能**:跑通全流程、内部演示、你自己完整点一遍、给别人看。

**不能**:接真实用户收真钱。下面四条是硬约束,不是"最好处理一下"。

### 1. 备案过不了 → 域名在国内打不开

公网 IP `8.208.125.209` 落在阿里云**国际站**地址段:

- **无法 ICP 备案** —— 域名在国内打不开,微信内也打不开
- **不满足 PRD 10.7**(用户数据须存境内)

正式环境要在**华东/华北/华南**地域重开一台,备案 2–3 周且是串行的,越早启动越好。

### 2. 收了钱退不了

支付适配器是 mock。派单页的「转退款」只把订单状态改成 `refunding`,**钱没有真退**。
如果先接真实支付、后接退款,中间这段时间用户申请退款你只能手动转账。
微信支付商户号下来时,**收款和退款要一起接**。

### 3. 通知一条都发不出去

微信订阅消息 / 短信 / 邮件渠道都没接,所有通知停在 `pending`,
堆在 `/admin/notifications` 里等人工打电话兜底。

截止日提醒是 PRD 里的强制项 —— 漏发意味着用户错过申请。
接渠道需要小程序教育类目资质和营业执照,和备案在同一条串行路径上。

### 4. 数据 0% 人工核对

310 条全是 AI 采集。按 PRD 11.3,未核对占比 >10% 不应开始投放。
所以部署完前台是空的(地区默认全关),**"上线"和"能用"是两件事**。
英国要开放需要核对 126 条。

---

## 六点五、其余上线前事项

### 地区默认全部关闭

`/admin/regions` 里所有地区都是关闭的,用户在评估页会看到「暂时没有可选地区」。
这是**故意的**:数据没核对完就不该放出去。先核对英国的 139 条(90% 即 126 条),再点开放。

### 学生上传的材料是明文的

`uploads/` 里是护照、身份证、学位证扫描件,当前**明文存本机磁盘**,
只有应用层权限校验(`/api/materials/[id]/file` 会验归属,不是本人或运营一律 404)。

正式接用户前应换 OSS/COS:开启**存储侧加密**,访问走**带过期时间的签名 URL**。
备份文件同样含明文材料,同步到别处时要一并加密。

### 法律文本未过审

`/legal/terms` 和 `/legal/privacy` 是按产品实际行为写的技术草稿,页面顶部有醒目提示。
接真实用户前必须经执业律师依《个人信息保护法》审核定稿。

---

## 七、备份(单机部署尤其重要)

RDS 有自动备份,自建 Postgres 没有。至少配个每日备份:

```bash
sudo tee /etc/cron.d/compass-backup > /dev/null <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
# 数据库
0 3 * * * postgres pg_dump compass | gzip > /var/backups/compass-$(date +\%F).sql.gz
# 学生上传的材料 —— 只备数据库是不够的,见下方说明
15 3 * * * root tar -czf /var/backups/uploads-$(date +\%F).tar.gz -C /opt/compass uploads
0 4 * * * root find /var/backups -name 'compass-*.sql.gz' -mtime +14 -delete
5 4 * * * root find /var/backups -name 'uploads-*.tar.gz' -mtime +14 -delete
EOF

sudo mkdir -p /var/backups
```

> ⚠️ **`uploads/` 必须一起备。**
> 学生上传的成绩单、学位证、护照扫描件都存在 `/opt/compass/uploads/` 这个目录下,
> 数据库里只有文件名和路径。只做 `pg_dump` 的话,机器挂了之后数据库能恢复,
> 但每条材料记录都会指向一个不存在的文件 —— 页面显示「已上传」,点开是
> 「文件在服务器上找不到了」。对学生来说等于材料全部要重交。
>
> 同理:**`deploy.sh` 重新部署时不要清空 `uploads/`**(现在的脚本不会碰它)。

### 这些文件是敏感个人信息

`uploads/` 里是护照、身份证、学位证扫描件。当前实现是**明文存在本机磁盘**上,
只有应用层的权限校验(`/api/materials/[id]/file` 会验归属)。

正式接真实用户前应当换成 OSS/COS:开启**存储侧加密**,访问走**带过期时间的签名 URL**,
不要用公共读。这也是 PRD 10.x 对个人敏感信息的要求。备份文件同样含明文材料,
同步到别处时要一并加密。

备份文件留在同一台机器上只能防「误删数据」,防不了「机器挂了」。
真上线后请把备份同步到 OSS 或另一台机器。
