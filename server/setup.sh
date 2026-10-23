#!/usr/bin/env bash
# Ordius — настройка сервера с нуля (Ubuntu 24.04). Запуск от root.
#
# Новый сервер:
#   bash setup.sh --domain app.ordius.ru --endpoint s3.ru1.storage.beget.cloud --bucket ИМЯ_БАКЕТА
# Новый сервер вместо пропавшего — восстановить данные из копии:
#   bash setup.sh --domain app.ordius.ru --endpoint s3.ru1.storage.beget.cloud --bucket ИМЯ_БАКЕТА --restore
# Хранилище копий — любое S3-совместимое в России. Для Selectel можно вместо --endpoint указать --pool ru-7.
# Регион подписи и стиль адресации скрипт подбирает сам (или --region).
#
# Повторный запуск безопасен: готовые шаги пропускаются, пароли и ключи не пересоздаются.
set -Eeuo pipefail

PB_VERSION="0.40.5"
REPO_URL=${ORDIUS_REPO_URL:-https://github.com/Yamanochy/ordius.git}
ADMIN_EMAIL="ordius.info@yandex.ru"

ORDIUS_ETC=/etc/ordius
ORDIUS_DATA=/var/lib/ordius
ORDIUS_OPT=/opt/ordius
REPO="$ORDIUS_OPT/repo"

DOMAIN="" BUCKET="" POOL="" ENDPOINT="" REGION="" RESTORE=0 BRANCH=main
ORIG_ARGS=("$@")

say()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\n\033[31mОШИБКА: %s\033[0m\n' "$*" >&2; exit 1; }
trap 'die "сбой на строке $LINENO. Пришлите Claude последние строки вывода."' ERR

usage() { sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)   DOMAIN=${2:-}; shift 2 ;;
    --bucket)   BUCKET=${2:-}; shift 2 ;;
    --pool)     POOL=${2:-}; shift 2 ;;
    --endpoint) ENDPOINT=${2:-}; shift 2 ;;
    --region)   REGION=${2:-}; shift 2 ;;
    --branch)   BRANCH=${2:-}; shift 2 ;;
    --restore)  RESTORE=1; shift ;;
    -h|--help)  usage 0 ;;
    *) printf 'Неизвестный параметр: %s\n\n' "$1"; usage 1 ;;
  esac
done

[ "$(id -u)" = "0" ] || die "запустите от root"
[[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || die "укажите --domain, например app.ordius.ru"
[[ "$BUCKET" =~ ^[a-z0-9][a-z0-9.-]{2,62}$ ]] || die "укажите --bucket — имя бакета Selectel"
if [ -n "$POOL" ]; then
  [[ "$POOL" =~ ^[a-z]{2,4}-[0-9]+$ ]] || die "--pool — пул Selectel, например ru-7"
  ENDPOINT=${ENDPOINT:-s3.${POOL}.storage.selcloud.ru}
  REGION=${REGION:-$POOL}
fi
[[ "$ENDPOINT" =~ ^[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "укажите --endpoint — адрес S3-хранилища копий, например s3.ru1.storage.beget.cloud"

# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] && [ "${VERSION_ID:-}" = "24.04" ] || warn "скрипт проверен на Ubuntu 24.04, у вас ${PRETTY_NAME:-неизвестная ОС}"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

# Секрет спрашиваем с экрана (или берём из переменной — только для автоматических проверок).
ask_secret() {
  local prompt=$1 var=$2 value=${!2:-}
  if [ -z "$value" ]; then
    read -r -s -p "  $prompt: " value 2>/dev/null < /dev/tty || true; echo
  fi
  [ -n "$value" ] || die "пустое значение: $prompt"
  printf -v "$var" '%s' "$value"
}
# Случайная строка из цифр и букв a–f, до 64 символов.
random_secret() { local s; s=$(openssl rand -hex 32); printf '%s' "${s:0:$1}"; }

# Показывает новый пароль и ждёт, пока его сохранят. Повторно пароль не показывается.
show_secret() {
  local title=$1 value=$2 answer=""
  printf '\n  \033[1;33m┌─ СОХРАНИТЕ В МЕНЕДЖЕР ПАРОЛЕЙ ─────────────────────────────\033[0m\n'
  printf '  \033[1;33m│\033[0m %s\n' "$title"
  printf '  \033[1;33m│\033[0m\n  \033[1;33m│\033[0m     %s\n' "$value"
  printf '  \033[1;33m└────────────────────────────────────────────────────────────\033[0m\n'
  while :; do
    read -r -p "  Сохранили? Напишите да и нажмите Enter: " answer 2>/dev/null < /dev/tty || answer="да"
    case "$answer" in да|Да|ДА|yes|y) break ;; esac
  done
}

# ---------------------------------------------------------------------------
say "1/11 Код Ordius из GitHub"
if ! command -v git >/dev/null; then apt-get update -qq && apt-get install -y -qq git >/dev/null; fi
mkdir -p "$ORDIUS_OPT"
if [ -d "$REPO/.git" ]; then
  git -C "$REPO" fetch --quiet origin "$BRANCH"
  git -C "$REPO" reset --quiet --hard "origin/$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$REPO"
fi
ok "репозиторий: $(git -C "$REPO" log -1 --format='%h %s')"
# Дальше работаем по версии скрипта из репозитория, а не по скачанной копии.
if [ "$(readlink -f "$0")" != "$(readlink -f "$REPO/server/setup.sh")" ] && [ -z "${ORDIUS_SETUP_REEXEC:-}" ]; then
  export ORDIUS_SETUP_REEXEC=1
  exec bash "$REPO/server/setup.sh" "${ORIG_ARGS[@]}"
fi

# ---------------------------------------------------------------------------
say "2/11 Обновление системы и пакеты"
apt-get update -qq
apt-get -y -qq -o Dpkg::Options::=--force-confold upgrade >/dev/null
apt-get install -y -qq ufw unattended-upgrades sqlite3 restic rsync curl ca-certificates gnupg \
  unzip jq python3-boto3 debian-keyring debian-archive-keyring apt-transport-https >/dev/null
ok "система обновлена, пакеты установлены"

if ! swapon --show | grep -q .; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/90-ordius.conf && sysctl -q -p /etc/sysctl.d/90-ordius.conf
  ok "файл подкачки 1 ГБ"
fi

# ---------------------------------------------------------------------------
say "3/11 Вход на сервер только по ключу"
if [ -s /root/.ssh/authorized_keys ]; then
  cat > /etc/ssh/sshd_config.d/10-ordius.conf <<'EOF'
# Ordius: вход только по SSH-ключу, пароли отключены.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
EOF
  sshd -t && systemctl try-reload-or-restart ssh
  ok "пароли для SSH отключены, вход по ключу"
else
  warn "на сервере нет SSH-ключа root — пароли НЕ отключаю, чтобы не потерять доступ"
fi

# ---------------------------------------------------------------------------
say "4/11 Межсетевой экран"
ufw --force default deny incoming >/dev/null
ufw --force default allow outgoing >/dev/null
ufw limit 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
ok "открыты только SSH (22), HTTP (80) и HTTPS (443)"

# ---------------------------------------------------------------------------
say "5/11 Автоматические обновления безопасности"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat > /etc/apt/apt.conf.d/52ordius-unattended <<'EOF'
// Ordius: кроме обновлений безопасности Ubuntu — обновления Caddy из его репозитория.
Unattended-Upgrade::Origins-Pattern { "site=dl.cloudsmith.io"; };
Unattended-Upgrade::Remove-Unused-Dependencies "true";
// Перезагрузка, если её требует обновление ядра: 21:00 UTC = 04:00 по Новосибирску.
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "21:00";
EOF
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
ok "обновления ставятся сами, перезагрузка при необходимости — в 04:00 НСК"

# ---------------------------------------------------------------------------
say "6/11 Caddy — HTTPS и сертификат"
if ! command -v caddy >/dev/null; then
  if curl -fsSL -m 30 https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
       | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
     && curl -fsSL -m 30 https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
       -o /etc/apt/sources.list.d/caddy-stable.list \
     && apt-get update -qq && apt-get install -y -qq caddy >/dev/null; then
    ok "Caddy установлен из официального репозитория"
  else
    warn "репозиторий Caddy недоступен — ставлю пакет с GitHub"
    rm -f /etc/apt/sources.list.d/caddy-stable.list
    CADDY_VERSION="2.11.7"
    tmp=$(mktemp -d)
    deb="caddy_${CADDY_VERSION}_linux_amd64.deb"
    base="https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}"
    curl -fsSL --retry 3 -o "$tmp/$deb" "$base/$deb"
    curl -fsSL --retry 3 -o "$tmp/sums" "$base/caddy_${CADDY_VERSION}_checksums.txt"
    (cd "$tmp" && grep " $deb\$" sums | sha512sum -c --status) || die "контрольная сумма Caddy не совпала"
    apt-get install -y -qq "$tmp/$deb" >/dev/null
    rm -rf "$tmp"
    ok "Caddy $CADDY_VERSION установлен с GitHub (обновлять вручную)"
  fi
fi
sed "s/__DOMAIN__/$DOMAIN/g" "$REPO/server/config/Caddyfile" > /etc/caddy/Caddyfile
if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/tmp/ordius-caddy.log 2>&1; then
  tail -5 /tmp/ordius-caddy.log >&2
  die "Caddyfile не прошёл проверку"
fi
systemctl enable caddy >/dev/null 2>&1
systemctl reload-or-restart caddy
ok "Caddy настроен на $DOMAIN"

server_ip=$(curl -fsS -4 -m 10 https://ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)
server_ip=${server_ip:-IP_СЕРВЕРА}
dns_ip=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
if [ -n "$dns_ip" ] && [ "$dns_ip" = "$server_ip" ]; then
  ok "$DOMAIN указывает на этот сервер ($server_ip)"
else
  warn "$DOMAIN пока указывает на «${dns_ip:-ничего}», а сервер — $server_ip. Сертификат выпустится сам, когда DNS обновится."
fi

# ---------------------------------------------------------------------------
say "7/11 PocketBase $PB_VERSION"
id pocketbase >/dev/null 2>&1 || useradd --system --home-dir "$ORDIUS_DATA" --shell /usr/sbin/nologin pocketbase
install -d -m 750 -o root -g root "$ORDIUS_ETC"
install -d -m 750 -o pocketbase -g pocketbase "$ORDIUS_DATA" "$ORDIUS_DATA/pb_data"
install -d -m 755 "$ORDIUS_OPT/pocketbase" "$ORDIUS_OPT/pb_public" "$ORDIUS_OPT/pb_hooks" "$ORDIUS_OPT/pb_migrations"
install -d -m 755 /usr/local/lib/ordius
install -m 644 "$REPO/server/lib/common.sh" /usr/local/lib/ordius/common.sh
for f in "$REPO"/server/bin/ordius-*; do install -m 755 "$f" "/usr/local/sbin/$(basename "$f")"; done
# shellcheck source=lib/common.sh
source /usr/local/lib/ordius/common.sh

fetch_pocketbase "$PB_VERSION"
[ -e "$ORDIUS_OPT/pocketbase/pocketbase" ] || ln -sfn "pocketbase-$PB_VERSION" "$ORDIUS_OPT/pocketbase/pocketbase"
ok "PocketBase: $(basename "$(readlink -f "$ORDIUS_OPT/pocketbase/pocketbase")")"

cat > "$ORDIUS_ETC/ordius.conf" <<EOF
# Ordius — настройки сервера (не секретные). Пишет setup.sh.
DOMAIN=$DOMAIN
PB_VERSION=$(basename "$(readlink -f "$ORDIUS_OPT/pocketbase/pocketbase")" | sed 's/^pocketbase-//')
S3_ENDPOINT=$ENDPOINT
S3_BUCKET=$BUCKET
S3_REGION=$REGION
S3_SCHEME=${ORDIUS_S3_SCHEME:-https}
S3_LOOKUP=${ORDIUS_S3_LOOKUP:-dns}
HEALTHCHECK_URL=$(grep -s '^HEALTHCHECK_URL=' "$ORDIUS_ETC/ordius.conf" | cut -d= -f2- || true)
EOF
chmod 644 "$ORDIUS_ETC/ordius.conf"

# Ключ шифрования настроек PocketBase. Входит в копии; при --restore заменяется ключом из копии.
if [ ! -s "$ORDIUS_ETC/pocketbase.env" ]; then
  umask 077; printf 'PB_ENCRYPTION_KEY=%s\n' "$(random_secret 32)" > "$ORDIUS_ETC/pocketbase.env"; umask 022
  ok "создан ключ шифрования настроек"
fi
chown -R root:root "$ORDIUS_ETC" && chmod 700 "$ORDIUS_ETC" && chmod 600 "$ORDIUS_ETC/pocketbase.env"

# ---------------------------------------------------------------------------
say "8/11 Службы и выкладка приложения"
sed "s/__DOMAIN__/$DOMAIN/g" "$REPO/server/systemd/ordius-pocketbase.service" > /etc/systemd/system/ordius-pocketbase.service
for u in ordius-backup.service ordius-backup.timer ordius-maintain.service ordius-maintain.timer; do
  install -m 644 "$REPO/server/systemd/$u" "/etc/systemd/system/$u"
done
systemctl daemon-reload
ORDIUS_BRANCH="$BRANCH" ordius-deploy --no-restart >/dev/null
systemctl enable ordius-pocketbase >/dev/null 2>&1
ok "службы установлены, файлы приложения разложены"

# ---------------------------------------------------------------------------
say "9/11 Копии в хранилище S3 ($ENDPOINT, бакет $BUCKET)"
if [ ! -s "$ORDIUS_ETC/backup.env" ]; then
  echo "  Вставьте Access key и Secret key хранилища копий (из панели хранилища или менеджера паролей)."
  echo "  При вставке символы не видны — это нормально. Вставка: правая кнопка мыши."
  ask_secret "Access key" ORDIUS_S3_ACCESS_KEY
  ask_secret "Secret key" ORDIUS_S3_SECRET_KEY
  umask 077
  cat > "$ORDIUS_ETC/backup.env" <<EOF
AWS_ACCESS_KEY_ID=$ORDIUS_S3_ACCESS_KEY
AWS_SECRET_ACCESS_KEY=$ORDIUS_S3_SECRET_KEY
EOF
  umask 022
fi
chmod 600 "$ORDIUS_ETC/backup.env"
/usr/local/sbin/ordius-s3-setup || { rm -f "$ORDIUS_ETC/backup.env"; die "нет доступа к бакету. Проверьте адрес, имя бакета и ключи и запустите скрипт ещё раз"; }

new_restic_pass=0
if [ ! -s "$ORDIUS_ETC/restic.pass" ]; then
  if [ "$RESTORE" = "1" ]; then
    echo "  Вставьте пароль шифрования копий (сохранили при первой установке)."
    ask_secret "Пароль шифрования копий" ORDIUS_RESTIC_PASSWORD
  else
    ORDIUS_RESTIC_PASSWORD=${ORDIUS_RESTIC_PASSWORD:-$(random_secret 40)}
    new_restic_pass=1
  fi
  umask 077; printf '%s\n' "$ORDIUS_RESTIC_PASSWORD" > "$ORDIUS_ETC/restic.pass"; umask 022
fi
chmod 600 "$ORDIUS_ETC/restic.pass"

load_backup_env
if r cat config >/dev/null 2>&1; then
  ok "хранилище копий уже создано, пароль подходит"
elif [ "$RESTORE" = "1" ]; then
  rm -f "$ORDIUS_ETC/restic.pass"
  die "не удалось открыть копии: неверный пароль шифрования или не тот бакет"
elif r init >/tmp/ordius-restic.log 2>&1; then
  ok "хранилище копий создано и зашифровано"
  if [ "$new_restic_pass" = "1" ]; then
    show_secret "Пароль шифрования копий. Запишите ещё и на бумагу: без него копии не открыть." "$ORDIUS_RESTIC_PASSWORD"
  fi
else
  rm -f "$ORDIUS_ETC/restic.pass"
  tail -5 /tmp/ordius-restic.log >&2
  if grep -q 'already initialized' /tmp/ordius-restic.log; then
    die "в бакете уже есть копии с другим паролем. Если это переезд на новый сервер — запустите с --restore"
  fi
  die "restic не смог создать хранилище копий (строки выше). Пришлите их Claude"
fi
unset ORDIUS_RESTIC_PASSWORD

# ---------------------------------------------------------------------------
if [ "$RESTORE" = "1" ]; then
  say "10/11 Восстановление данных из последней копии"
  ordius-restore latest
  touch "$ORDIUS_DATA/.superuser-created"   # администратор пришёл вместе с базой
else
  say "10/11 Запуск PocketBase"
  systemctl restart ordius-pocketbase
  for _ in $(seq 1 30); do
    curl -fsS -m 2 http://127.0.0.1:8090/api/health >/dev/null 2>&1 && break
    sleep 1
  done
  curl -fsS -m 2 http://127.0.0.1:8090/api/health >/dev/null 2>&1 || die "PocketBase не запустился: journalctl -u ordius-pocketbase -n 50"
  ok "PocketBase отвечает"
  if [ ! -e "$ORDIUS_DATA/.superuser-created" ]; then
    admin_pass=$(random_secret 24)
    pb_key=$(sed -n 's/^PB_ENCRYPTION_KEY=//p' "$ORDIUS_ETC/pocketbase.env")
    runuser -u pocketbase -- env PB_ENCRYPTION_KEY="$pb_key" \
      "$ORDIUS_OPT/pocketbase/pocketbase" superuser upsert "$ADMIN_EMAIL" "$admin_pass" \
      --dir="$PB_DATA" --migrationsDir="$ORDIUS_OPT/pb_migrations" --hooksDir="$ORDIUS_OPT/pb_hooks" \
      --encryptionEnv=PB_ENCRYPTION_KEY >/dev/null
    touch "$ORDIUS_DATA/.superuser-created"
    ok "администратор $ADMIN_EMAIL создан"
    show_secret "Пароль администратора PocketBase (вход: $ADMIN_EMAIL)." "$admin_pass"
    unset pb_key admin_pass
  fi
fi

# ---------------------------------------------------------------------------
say "11/11 Первая копия и расписание"
systemctl enable --now ordius-backup.timer ordius-maintain.timer >/dev/null 2>&1
ordius-backup
ordius-maintain --test
ok "копия отправлена, пробное восстановление прошло; дальше — каждый час сама"

echo
echo "════════════════════════════════════════════════════════════════════"
echo " Сервер готов: https://$DOMAIN"
echo "════════════════════════════════════════════════════════════════════"
echo
echo " Панель администратора (только через туннель), в PowerShell на своём компьютере:"
echo "    ssh -N -L 8090:127.0.0.1:8090 root@$server_ip"
echo " и в браузере: http://127.0.0.1:8090/_/"
echo
echo " Состояние сервера: sudo ordius-status"
echo
