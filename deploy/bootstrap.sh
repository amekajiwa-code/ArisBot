#!/usr/bin/env bash
# ArisBot 배포 부트스트랩 — Ubuntu 22.04/24.04, x86_64 · arm64 공통.
#
#   sudo bash /opt/arisbot/deploy/bootstrap.sh
#
# 설치·등록까지만 하고 서비스는 시작하지 않는다. .env 를 채운 뒤
# 직접 start 해야 한다 (기존 서버와 동시에 돌면 알림이 두 번 간다).
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/arisbot}
REPO=${REPO:-https://github.com/amekajiwa-code/ArisBot.git}
SVC_USER=arisbot

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "root 로 실행해라:  sudo bash $0"

log "1/6  시스템 패키지"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates git

log "2/6  Node.js (>=20.6)"
node_ok() {
  command -v node >/dev/null 2>&1     && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=6)?0:1)'
}
if node_ok; then
  echo "  이미 설치됨: $(node -v)  ($(dpkg --print-architecture))"
else
  # NodeSource 우선. 아주 새 우분투(26.04 등)는 아직 미지원일 수 있어서
  # 실패하면 배포판 기본 nodejs 로 폴백한다.
  if curl -fsSL https://deb.nodesource.com/setup_20.x | bash -      && apt-get install -y -qq nodejs; then
    echo "  NodeSource 로 설치: $(node -v)"
  else
    warn "NodeSource 실패 — 배포판 기본 nodejs 로 폴백"
    apt-get install -y -qq nodejs npm
    echo "  apt 로 설치: $(node -v 2>/dev/null || echo '없음')"
  fi
  node_ok || die "Node >=20.6 이 필요한데 현재 $(node -v 2>/dev/null || echo '미설치') 다. 수동 설치가 필요하다."
fi
command -v npm >/dev/null 2>&1 || apt-get install -y -qq npm

log "3/6  코드 배치 ($APP_DIR)"
if [ -d "$APP_DIR/.git" ]; then
  # 재실행. 파일 소유자는 arisbot 인데 이 스크립트는 root 라서, 그냥 pull 하면
  # git 이 "dubious ownership" 으로 거부한다. 예외를 등록해 두고 받는다.
  git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
  git -C "$APP_DIR" pull --ff-only
else
  mkdir -p "$APP_DIR"
  git clone --depth 1 "$REPO" "$APP_DIR"
fi

log "4/6  런타임 의존성"
cd "$APP_DIR"
npm ci --omit=dev

log "5/6  서비스 유저 · .env · 권한"
id -u "$SVC_USER" >/dev/null 2>&1 \
  || useradd --system --no-create-home --shell /usr/sbin/nologin "$SVC_USER"

if [ -f "$APP_DIR/.env" ]; then
  echo "  .env 이미 있음 — 건드리지 않는다"
else
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  warn ".env 를 예시에서 새로 만들었다. 토큰을 채워야 봇이 뜬다."
fi
chown -R "$SVC_USER:$SVC_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

log "6/6  systemd 등록"
NODE_BIN=$(command -v node)
install -m 644 "$APP_DIR/deploy/arisbot.service" /etc/systemd/system/arisbot.service
# 유닛의 node 절대경로를 이 서버 실제 경로로 맞춘다 (arm64/x86 차이 흡수).
sed -i "s|^ExecStart=.*|ExecStart=$NODE_BIN --env-file=.env src/index.js|" \
  /etc/systemd/system/arisbot.service
sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$APP_DIR|" \
  /etc/systemd/system/arisbot.service
systemctl daemon-reload
systemctl enable arisbot >/dev/null
echo "  ExecStart=$NODE_BIN --env-file=.env src/index.js"

cat <<EOF

  ─────────────────────────────────────────────
   설치 완료. 서비스는 아직 시작하지 않았다.

   1) 토큰 채우기
        sudo nano $APP_DIR/.env

   2) 기존 서버(GCP) 봇을 먼저 정지
        # 그쪽에서:  sudo systemctl stop arisbot

   3) 여기서 시작
        sudo systemctl start arisbot
        journalctl -u arisbot -f

   되돌리려면 여기서 stop 하고 GCP 쪽을 start 하면 된다.
  ─────────────────────────────────────────────

EOF
