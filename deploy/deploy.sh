#!/usr/bin/env bash
#
# 构建并启动 / 重启应用
#
#   sudo bash deploy/deploy.sh            # 完整部署
#   sudo SKIP_DATA=1 bash deploy/deploy.sh # 跳过种子与院校数据导入(日常更新代码用)
#
# 可以重复执行。db:push / db:seed / data:import 都是幂等的。

set -euo pipefail

log() { echo -e "\n\033[1;36m==> $1\033[0m"; }
warn() { echo -e "\033[1;33m[注意] $1\033[0m"; }

if [[ $EUID -ne 0 ]]; then
  echo "请用 sudo 运行"
  exit 1
fi

APP_DIR="${APP_DIR:-/opt/compass}"
cd "$APP_DIR"

if [[ ! -f .env ]]; then
  echo "找不到 .env,请先跑 sudo bash deploy/setup-db.sh"
  exit 1
fi

# ⚠️ 运行用户必须在**开工前**就检查,不能等到构建完再说。
#    compass.service 里写死了 User=compass,这个用户不存在的话服务根本起不来。
#    原来这个检查在 build 之后(交出目录属主那一步),于是要先白等 51 秒构建、
#    再看着 systemctl restart 失败,才发现少跑了一个初始化脚本。
#    起不来的原因在第一秒就已经确定了,没有理由让人等到最后。
if ! id compass >/dev/null 2>&1; then
  echo "系统用户 compass 不存在 —— 服务以它运行(见 deploy/compass.service 的 User=compass),
不创建的话构建完也起不来。先跑一次初始化(幂等,已装过的会跳过,不动 .env):

    sudo bash deploy/setup-server.sh

然后重新执行本脚本。"
  exit 1
fi

# ── 1. 依赖 ────────────────────────────────────────────────
log "安装依赖"
npm ci --no-audit --no-fund

# ── 2. 数据库 ──────────────────────────────────────────────
log "同步数据库结构"
npx prisma generate
# ⚠️ 刻意**不加** --accept-data-loss。
#    加上它,以后任何一次「删列 / 改类型」都会在生产库上悄悄执行 ——
#    部署脚本是最不该有这种默认行为的地方。宁可在这里停下来让人看一眼。
#
#    但停下来时不要只把 prisma 的原始报错甩出去(它只说「加 --accept-data-loss」,
#    不说该不该加),下面把该做的判断写清楚。
if ! npx prisma db push --skip-generate; then
  warn "数据库结构同步失败。

  如果上面写的是「There might be data loss / 要删掉某一列」,先确认那一列真的没数据:

      sudo -u postgres psql -tAc \\
        \"SELECT DISTINCT <列名> FROM <表名>;\" compass

  只有全是默认值(如 0 / NULL)才说明删掉不丢东西。确认后单独执行一次:

      npx prisma db push --skip-generate --accept-data-loss

  然后重新跑本脚本。**不要**把 --accept-data-loss 写进这个脚本 ——
  那等于以后每次部署都默许在生产库上删数据。

  如果报的是连不上数据库,检查 .env 里的 DATABASE_URL 和 postgres 服务状态。"
  exit 1
fi

if [[ "${SKIP_DATA:-0}" != "1" ]]; then
  log "写入种子数据"
  # ⚠️ 必须带 NODE_ENV=production。
  #    prisma/seed.ts 里有一道保护:生产环境跳过创建开发账号
  #    admin@compass.local / compass-dev。不带这个变量,那道保护不会触发,
  #    一个人尽皆知的弱口令超级管理员就会跟着上生产。
  NODE_ENV=production npm run db:seed

  if compgen -G "data/raw/*.json" > /dev/null; then
    log "导入院校数据"
    npm run data:import
  else
    warn "data/raw/ 下没有 json 文件,跳过院校数据导入。
       注意:data/raw/*.json 在 .gitignore 里,git clone 不会带上它们,
       需要单独上传(scp -r data/raw root@服务器:${APP_DIR}/data/)。"
  fi

  # ── 院校排名 ─────────────────────────────────────────
  # data/schools/*.json 在 git 里,git pull 就有,不需要 scp。
  # 幂等:按 (name_en, region) upsert,重复跑只更新不新建。
  if compgen -G "data/schools/*.json" > /dev/null; then
    log "导入院校综合排名与学科排名"
    npm run schools:import
  fi

  # ── 人工核查的截止日修正 ─────────────────────────────
  # ⚠️ 必须在 data:import 之后跑。data:import 会用 data/raw 的原值覆盖截止日,
  #    而 data/raw 里存的正是核查中发现取错档次的那些日期(如 UCL 存了
  #    「无需签证」档的 08-28,而需签证的通道 06-26 就关了)。
  #    顺序反了,等于把已经修对的又改回错的。见 docs/数据核查-2026-08.md。
  #
  # ⚠️ 脚本匹配不到项目会**以非 0 退出**,从而中断整个部署 —— 这是有意的:
  #    对不上说明服务器上的数据和修正表不一致,那时宁可不发布,
  #    也不要让一个已经关闭的申请通道在页面上显示「还有 13 天截止」。
  if compgen -G "data/corrections/*.json" > /dev/null; then
    log "应用截止日修正与申请人档次标注"
    npm run fix:deadlines -- --write
  fi
fi

# ── 3. 构建 ────────────────────────────────────────────────
log "构建生产版本"
# 2GB 内存 + 4GB swap 的机器上,限制 Node 堆大小比让它自己撑爆更稳
NODE_OPTIONS="--max-old-space-size=1536" NODE_ENV=production npm run build

# ── 3.5 交出目录属主给运行用户 ─────────────────────────────
# root 负责构建(装依赖、prisma、next build),但服务以非特权用户 compass 运行
# (见 deploy/compass.service)。构建完把整个应用目录交给 compass —— 它要能读
# .next / node_modules,并能写 uploads/(学生上传的材料)。
if id compass >/dev/null 2>&1; then
  log "移交目录属主给 compass"
  mkdir -p "$APP_DIR/uploads"
  chown -R compass:compass "$APP_DIR"
  # .env 含密钥,权限收紧到属主可读写
  chmod 600 "$APP_DIR/.env" 2>/dev/null || true
else
  warn "系统用户 compass 不存在(未跑过 setup-server.sh?)——
       服务仍会以 compass 启动失败。请先 sudo bash deploy/setup-server.sh"
fi

# ── 4. systemd ─────────────────────────────────────────────
log "配置 systemd 服务"
install -m 644 deploy/compass.service /etc/systemd/system/compass.service
sed -i "s#__APP_DIR__#${APP_DIR}#g" /etc/systemd/system/compass.service
systemctl daemon-reload
systemctl enable compass >/dev/null
systemctl restart compass

# ── 5. Nginx ───────────────────────────────────────────────
log "配置 Nginx 反向代理"
install -m 644 deploy/nginx-compass.conf /etc/nginx/sites-available/compass
ln -sf /etc/nginx/sites-available/compass /etc/nginx/sites-enabled/compass
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── 6. 定时任务 ────────────────────────────────────────────
log "配置定时任务"
# cron 接口的密钥:优先用 CRON_SECRET,没配才退回 AUTH_SECRET。
# 这个值会明文进 cron 文件,单独配一个就不会把签会话的 AUTH_SECRET 也暴露出去。
CRON_SECRET=$(grep '^CRON_SECRET=' .env | cut -d'"' -f2)
if [ -z "$CRON_SECRET" ]; then
  CRON_SECRET=$(grep '^AUTH_SECRET=' .env | cut -d'"' -f2)
fi
CRON_FILE=/etc/cron.d/compass
cat > "$CRON_FILE" <<EOF
# Compass 定时任务(由 deploy.sh 生成)
# 漏配的后果:用户收不到截止日提醒;已交付订单永远停在待验收;个人信息无限期堆积
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 每天 9:00 发截止日期提醒
0 9 * * * root curl -fsS -X POST -H "x-cron-secret: ${CRON_SECRET}" http://127.0.0.1:3000/api/cron/deadline-reminders >> /var/log/compass-cron.log 2>&1
# 每天 9:10 自动确认超 48h 未验收的服务订单
10 9 * * * root curl -fsS -X POST -H "x-cron-secret: ${CRON_SECRET}" http://127.0.0.1:3000/api/cron/auto-confirm >> /var/log/compass-cron.log 2>&1
# 每天 4:30 数据保留期清理(PIPL 第 19 条,保留期定义见 src/lib/retention.ts)
# 放在凌晨、且排在 3:00 备份之后 —— 万一某天删多了,当天的备份里还留着
30 4 * * * root curl -fsS -X POST -H "x-cron-secret: ${CRON_SECRET}" http://127.0.0.1:3000/api/cron/retention >> /var/log/compass-cron.log 2>&1
EOF
chmod 600 "$CRON_FILE"
echo "已写入 $CRON_FILE"

# ── 完成 ───────────────────────────────────────────────────
sleep 3
log "状态检查"
systemctl --no-pager --lines=0 status compass || true
echo
# ⚠️ 探 /api/health 而不是首页。
#    首页在数据库连不上时会降级用兜底数据渲染,照样返回 200 ——
#    也就是说「首页 200」根本不能说明部署成功。health 会真的查一次库。
curl -fsS -o /dev/null -w "本机自测 /api/health → %{http_code}\n" http://127.0.0.1:3000/api/health || \
  warn "健康检查未通过(进程没起来,或数据库连不上),看日志:journalctl -u compass -n 50"

ADMIN_COUNT=$(sudo -u postgres psql -tAc \
  "SELECT count(*) FROM admin_users WHERE active = true" compass 2>/dev/null || echo "?")

PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org || echo "你的服务器IP")
cat <<EOF

────────────────────────────────────────────────
部署完成。

  访问        http://${PUBLIC_IP}
  员工登录    http://${PUBLIC_IP}/admin/login
  查看日志    journalctl -u compass -f
  重启        systemctl restart compass

EOF

if [[ "$ADMIN_COUNT" == "0" ]]; then
  cat <<'EOF'
⚠️ 现在还没有任何后台账号 —— 你进不去后台。立刻执行:

     cd /opt/compass
     ADMIN_EMAIL=你的邮箱 ADMIN_PHONE=你的手机号 npm run admin:create

   密码只打印一次,当场存进密码管理器。

EOF
fi

cat <<'EOF'
⚠️ 上线前必做:
  1. 阿里云安全组放行 80(和 443),**不要**放行 5432
  2. 确认后台没有 admin@compass.local 这个开发账号
     (本脚本已用 NODE_ENV=production 跑 seed,正常不会创建;
      如果之前手动跑过 db:seed,去 /admin/accounts 停用它)
  3. 所有地区默认关闭,先去 /admin/regions 核对数据后再开放
  4. .env 里的 NEXT_PUBLIC_SITE_URL 改成真实域名,
     否则分享链接会一直生成 localhost 地址
────────────────────────────────────────────────
EOF
