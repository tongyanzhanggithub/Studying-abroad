#!/usr/bin/env bash
#
# 创建数据库与账号,并生成 .env
#
#   sudo bash deploy/setup-db.sh
#
# ⚠️ 密码与 AUTH_SECRET 都是**现场随机生成**的,不写死在任何文件里。
#    仓库里绝不能出现真实凭据 —— 一旦提交进 git history 就很难彻底清除。

set -euo pipefail

log() { echo -e "\n\033[1;36m==> $1\033[0m"; }

if [[ $EUID -ne 0 ]]; then
  echo "请用 sudo 运行"
  exit 1
fi

APP_DIR="${APP_DIR:-/opt/compass}"
DB_NAME="compass"
DB_USER="compass"

if [[ ! -d "$APP_DIR" ]]; then
  echo "找不到 $APP_DIR,请先把代码上传到这个目录"
  exit 1
fi

# ── 1. 数据库与账号 ────────────────────────────────────────
log "创建数据库与账号"

DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" || true)

if [[ "$DB_EXISTS" == "1" ]]; then
  echo "数据库 ${DB_NAME} 已存在"
  if [[ -f "$APP_DIR/.env" ]] && grep -q '^DATABASE_URL=' "$APP_DIR/.env"; then
    echo "已有 .env,保留现有密码不改动"
    SKIP_ENV=1
  else
    # 数据库在但 .env 丢了 —— 重置密码,否则连不上
    DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
    sudo -u postgres psql -q -c "ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASS}';"
    echo "已重置 ${DB_USER} 的密码"
  fi
else
  DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
  sudo -u postgres psql -q -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';"
  sudo -u postgres psql -q -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER} ENCODING 'UTF8';"
  echo "已创建数据库 ${DB_NAME} 与账号 ${DB_USER}"
fi

# ── 2. 生成 .env ───────────────────────────────────────────
if [[ "${SKIP_ENV:-0}" != "1" ]]; then
  log "生成 .env"

  AUTH_SECRET=$(openssl rand -base64 32)
  PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org || echo "你的服务器IP")

  cat > "$APP_DIR/.env" <<EOF
# 由 deploy/setup-db.sh 生成于 $(date '+%Y-%m-%d %H:%M:%S')
# ⚠️ 这个文件含真实凭据,已在 .gitignore 中,不要提交

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}?schema=public"

# 会话与定时任务共享密钥
AUTH_SECRET="${AUTH_SECRET}"

# ── 外部依赖:资质到位前先用 mock ──────────────────────
PAYMENT_PROVIDER="mock"
LLM_PROVIDER="mock"
SMS_PROVIDER="mock"
STORAGE_PROVIDER="local"

# 有 LLM key 时改成 anthropic 或 openai_compatible 并填下面的值
ANTHROPIC_API_KEY=""
ANTHROPIC_MODEL="claude-sonnet-5"
OPENAI_COMPAT_BASE_URL=""
OPENAI_COMPAT_API_KEY=""
OPENAI_COMPAT_MODEL=""

# 站点地址。绑域名后改成 https://你的域名
NEXT_PUBLIC_SITE_URL="http://${PUBLIC_IP}"
EOF

  chmod 600 "$APP_DIR/.env"
  chown "$(stat -c '%U' "$APP_DIR")":"$(stat -c '%G' "$APP_DIR")" "$APP_DIR/.env" 2>/dev/null || true
  echo "已写入 $APP_DIR/.env(权限 600)"
fi

cat <<EOF

────────────────────────────────────────────────
数据库准备完成。

DATABASE_URL 已写入 $APP_DIR/.env
数据库只监听 localhost,不对公网开放。

下一步:sudo bash deploy/deploy.sh
────────────────────────────────────────────────
EOF
