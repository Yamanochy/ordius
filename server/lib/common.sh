# Общие настройки и функции для скриптов сервера Ordius.
# Подключается командой: source /usr/local/lib/ordius/common.sh
# shellcheck shell=bash
# Переменные ниже используются в подключающих скриптах:
# shellcheck disable=SC2034

ORDIUS_ETC=${ORDIUS_ETC:-/etc/ordius}
ORDIUS_DATA=${ORDIUS_DATA:-/var/lib/ordius}
ORDIUS_OPT=${ORDIUS_OPT:-/opt/ordius}
ORDIUS_HOST=${ORDIUS_HOST:-ordius-app}   # одно имя для всех копий, даже после переезда на новый сервер
ORDIUS_TAG=ordius

PB_DATA="$ORDIUS_DATA/pb_data"
SNAP_DIR="$ORDIUS_DATA/backup"

# Хранение копий: 48 почасовых + 21 ежедневная. Старые версии в бакете живут ещё 7 дней,
# итого данные удалённого человека исчезают из копий не позже чем через 30 дней (ч. 5 ст. 21 152-ФЗ).
KEEP_HOURLY=48
KEEP_DAILY=21

log()  { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
warn() { printf '%s ВНИМАНИЕ: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die()  { printf '%s ОШИБКА: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; exit 1; }

# Загружает несекретные настройки и ключи хранилища.
load_backup_env() {
  [ -r "$ORDIUS_ETC/ordius.conf" ] || die "нет $ORDIUS_ETC/ordius.conf — сначала запустите setup.sh"
  [ -r "$ORDIUS_ETC/backup.env" ] || die "нет $ORDIUS_ETC/backup.env — копирование не настроено"
  set -a
  # shellcheck disable=SC1091
  . "$ORDIUS_ETC/ordius.conf"
  # shellcheck disable=SC1091
  . "$ORDIUS_ETC/backup.env"
  set +a
  export RESTIC_PASSWORD_FILE="$ORDIUS_ETC/restic.pass"
  export RESTIC_REPOSITORY="s3:${S3_SCHEME:-https}://${S3_ENDPOINT}/${S3_BUCKET}/restic"
  export RESTIC_CACHE_DIR="$ORDIUS_DATA/restic-cache"
  [ -r "$RESTIC_PASSWORD_FILE" ] || die "нет пароля шифрования $RESTIC_PASSWORD_FILE"
}

# restic с параметрами Selectel: адресация vHosted (dns) и регион = пул.
r() {
  restic -o "s3.bucket-lookup=${S3_LOOKUP:-dns}" -o "s3.region=${S3_REGION:-us-east-1}" "$@"
}

# Оповещение мониторинга (healthchecks.io или совместимый). Без адреса — ничего не делает.
ping_health() {
  local suffix=${1:-}
  [ -n "${HEALTHCHECK_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 "${HEALTHCHECK_URL}${suffix}" >/dev/null 2>&1 || true
}

# Скачивает PocketBase нужной версии с GitHub, сверяет контрольную сумму из checksums.txt того же
# релиза и кладёт в $ORDIUS_OPT/pocketbase/pocketbase-<версия>. Ссылку pocketbase не трогает.
fetch_pocketbase() {
  local ver=$1 arch tmp zip dest="$ORDIUS_OPT/pocketbase/pocketbase-$1"
  [ -x "$dest" ] && { log "PocketBase $ver уже скачан"; return 0; }
  case "$(uname -m)" in
    x86_64) arch=amd64 ;; aarch64) arch=arm64 ;; *) die "неизвестная архитектура $(uname -m)" ;;
  esac
  zip="pocketbase_${ver}_linux_${arch}.zip"
  tmp=$(mktemp -d)
  local base="https://github.com/pocketbase/pocketbase/releases/download/v${ver}"
  curl -fsSL --retry 3 -o "$tmp/$zip" "$base/$zip" || { rm -rf "$tmp"; die "не скачался $zip"; }
  curl -fsSL --retry 3 -o "$tmp/checksums.txt" "$base/checksums.txt" || { rm -rf "$tmp"; die "не скачался checksums.txt"; }
  (cd "$tmp" && grep " $zip\$" checksums.txt | sha256sum -c --status) || { rm -rf "$tmp"; die "контрольная сумма $zip не совпала"; }
  mkdir -p "$ORDIUS_OPT/pocketbase"
  unzip -q -o "$tmp/$zip" pocketbase -d "$tmp/x"
  install -m 755 "$tmp/x/pocketbase" "$dest"
  rm -rf "$tmp"
  log "PocketBase $ver скачан и проверен"
}

# При выходе с ошибкой — сообщение и оповещение мониторинга о сбое.
# Использование: trap 'report_failure "копия не сделана"' EXIT
report_failure() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    warn "$1 (код $rc)"
    ping_health /fail
  fi
  return "$rc"
}

# Проверка целостности базы SQLite.
db_ok() {
  [ -s "$1" ] && [ "$(sqlite3 "$1" 'PRAGMA integrity_check;' 2>/dev/null)" = "ok" ]
}
