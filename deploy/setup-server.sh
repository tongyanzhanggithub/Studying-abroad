#!/usr/bin/env bash
#
# 服务器一次性初始化(Ubuntu 24.04)
#
#   sudo bash deploy/setup-server.sh
#
# 做四件事:加 swap、装 Postgres、装 Node、装 Nginx。
# 可以重复执行,已装过的会跳过。
#
# ⚠️ 这台机器只有 2 GiB 内存。Next.js 生产构建峰值能吃到 1.5-2 GB,
#    不加 swap 大概率在 build 阶段被 OOM Killer 杀掉,而且报错信息
#    往往是莫名其妙的 "Killed" —— 很难一眼看出是内存问题。所以先加 swap。

set -euo pipefail

log() { echo -e "\n\033[1;36m==> $1\033[0m"; }
warn() { echo -e "\033[1;33m[注意] $1\033[0m"; }

if [[ $EUID -ne 0 ]]; then
  echo "请用 sudo 运行:sudo bash deploy/setup-server.sh"
  exit 1
fi

# ── 1. Swap ────────────────────────────────────────────────
log "配置 swap"
if swapon --show | grep -q '/swapfile'; then
  echo "swap 已存在,跳过"
else
  # 2GB 内存配 4GB swap,构建时够用
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # 内存小的机器让内核更早用 swap,避免突然 OOM
  sysctl vm.swappiness=30
  grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=30' >> /etc/sysctl.conf
  echo "已添加 4GB swap"
fi
free -h

# ── 2. 系统依赖 ────────────────────────────────────────────
log "更新系统包"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git ufw

# ── 3. PostgreSQL ──────────────────────────────────────────
log "安装 PostgreSQL"
if command -v psql >/dev/null 2>&1; then
  echo "PostgreSQL 已安装:$(psql --version)"
else
  apt-get install -y -qq postgresql postgresql-contrib
  systemctl enable --now postgresql
  echo "已安装:$(psql --version)"
fi

# ⚠️ 只监听本机。数据库绝不能暴露在公网上 ——
#    弱密码 + 公网 5432 是最常见的数据泄露方式之一。
PG_CONF=$(sudo -u postgres psql -tAc "SHOW config_file;")
if grep -qE "^\s*listen_addresses\s*=\s*'\*'" "$PG_CONF"; then
  sed -i "s/^\s*listen_addresses\s*=\s*'\*'/listen_addresses = 'localhost'/" "$PG_CONF"
  systemctl restart postgresql
  warn "已把 PostgreSQL 改回只监听 localhost"
fi

# ── 4. Node.js 22 ──────────────────────────────────────────
log "安装 Node.js 22"
if command -v node >/dev/null 2>&1 && [[ "$(node -v)" == v22* ]]; then
  echo "Node 已安装:$(node -v)"
else
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs
  echo "已安装:$(node -v) / npm $(npm -v)"
fi

# ── 5. Nginx ───────────────────────────────────────────────
log "安装 Nginx"
if command -v nginx >/dev/null 2>&1; then
  echo "Nginx 已安装"
else
  apt-get install -y -qq nginx
  systemctl enable --now nginx
fi

# ── 6. 防火墙 ──────────────────────────────────────────────
log "配置防火墙"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
# 5432 绝不开放。数据库只走本机回环
ufw --force enable >/dev/null
ufw status

cat <<'EOF'

────────────────────────────────────────────────
服务器初始化完成。

下一步:
  1. 创建数据库          sudo bash deploy/setup-db.sh
  2. 上传代码到 /opt/compass
  3. 部署                sudo bash deploy/deploy.sh

⚠️ 别忘了在阿里云控制台的**安全组**里放行 80 / 443,
   但**不要**放行 5432(数据库只走本机)。
────────────────────────────────────────────────
EOF
