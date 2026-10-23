#!/usr/bin/env bash
# Проверка скриптов сервера Ordius без настоящего сервера и без Selectel:
#   bash server/test/test.sh
# Нужны: restic, sqlite3, rsync, git, shellcheck, python3 с boto3 и moto (pip install "moto[server]").
# Вместо Selectel поднимается локальный S3 (moto), вместо PocketBase — тестовая база SQLite.
set -Eeuo pipefail

HERE=$(cd "$(dirname "$0")/.." && pwd)
failed=0
pass() { printf 'ok  - %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1"; failed=$((failed + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

for t in restic sqlite3 rsync git shellcheck python3 moto_server; do
  command -v "$t" >/dev/null || { echo "нет $t — установите и повторите"; exit 2; }
done

# --- 1. статический анализ -------------------------------------------------
check "shellcheck: setup.sh, lib, bin" \
  "shellcheck -x -S warning '$HERE/setup.sh' '$HERE/lib/common.sh' $(printf "'%s' " "$HERE"/bin/ordius-backup "$HERE"/bin/ordius-maintain "$HERE"/bin/ordius-restore "$HERE"/bin/ordius-deploy "$HERE"/bin/ordius-pb-update "$HERE"/bin/ordius-status)"
check "python: ordius-s3-setup компилируется" "python3 -c \"import ast,sys; ast.parse(open(sys.argv[1]).read())\" '$HERE/bin/ordius-s3-setup'"
check "bash -n: все скрипты" "for f in '$HERE/setup.sh' '$HERE'/bin/ordius-backup '$HERE'/bin/ordius-maintain '$HERE'/bin/ordius-restore '$HERE'/bin/ordius-deploy '$HERE'/bin/ordius-pb-update '$HERE'/bin/ordius-status; do bash -n \"\$f\" || exit 1; done"
check "systemd: служба PocketBase слушает только 127.0.0.1" "grep -q -- '--http=127.0.0.1:8090' '$HERE/systemd/ordius-pocketbase.service'"
check "Caddy: панель администратора закрыта снаружи" "grep -q '@admin path /_ /_/\*' '$HERE/config/Caddyfile' && grep -q 'respond @admin 404' '$HERE/config/Caddyfile'"

# --- 2. окружение ------------------------------------------------------------
T=$(mktemp -d)
MOTO_PID="" HC_PID=""
cleanup() {
  [ -n "$MOTO_PID" ] && kill "$MOTO_PID" 2>/dev/null
  [ -n "$HC_PID" ] && kill "$HC_PID" 2>/dev/null
  rm -rf "$T"
}
trap cleanup EXIT

PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
HCPORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
moto_server -H 127.0.0.1 -p "$PORT" >"$T/moto.log" 2>&1 & MOTO_PID=$!

# Приёмник оповещений мониторинга: записывает пути запросов в файл.
python3 - "$HCPORT" "$T/pings" >/dev/null 2>&1 <<'PY' & HC_PID=$!
import sys, http.server
port, out = int(sys.argv[1]), sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        open(out, "a").write(self.path + "\n"); self.send_response(200); self.end_headers()
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", port), H).serve_forever()
PY

for _ in $(seq 1 50); do curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break; sleep 0.2; done

export ORDIUS_ETC="$T/etc" ORDIUS_DATA="$T/data" ORDIUS_OPT="$T/opt" ORDIUS_LIB="$HERE/lib" ORDIUS_NO_SYSTEMD=1
export PATH="$HERE/bin:$PATH"
export AWS_EC2_METADATA_DISABLED=true
mkdir -p "$ORDIUS_ETC" "$ORDIUS_DATA/pb_data/storage/abc123" "$ORDIUS_OPT"

cat > "$ORDIUS_ETC/ordius.conf" <<EOF
DOMAIN=app.test
S3_SCHEME=http
S3_ENDPOINT=127.0.0.1:$PORT
S3_BUCKET=ordius-backup-test
S3_REGION=us-east-1
S3_LOOKUP=path
HEALTHCHECK_URL=http://127.0.0.1:$HCPORT/hc
EOF
printf 'AWS_ACCESS_KEY_ID=test\nAWS_SECRET_ACCESS_KEY=test\n' > "$ORDIUS_ETC/backup.env"
printf 'test-restic-password\n' > "$ORDIUS_ETC/restic.pass"
printf 'PB_ENCRYPTION_KEY=abcdefghijklmnopqrstuvwxyz012345\n' > "$ORDIUS_ETC/pocketbase.env"

python3 - "$PORT" <<'PY'
import sys, boto3
s3 = boto3.client("s3", endpoint_url=f"http://127.0.0.1:{sys.argv[1]}", region_name="us-east-1",
                  aws_access_key_id="test", aws_secret_access_key="test")
s3.create_bucket(Bucket="ordius-backup-test")
PY

DB="$ORDIUS_DATA/pb_data/data.db"
sqlite3 "$DB" "PRAGMA journal_mode=WAL; CREATE TABLE _collections(id TEXT PRIMARY KEY, name TEXT); INSERT INTO _collections VALUES ('c1','companies'),('c2','shifts');" >/dev/null
echo "фото путевого 1" > "$ORDIUS_DATA/pb_data/storage/abc123/photo1.jpg"

# --- 3. хранилище ------------------------------------------------------------
out=$(ordius-s3-setup 2>&1) || true
check "s3-setup: доступ к бакету" "grep -q 'доступ есть' <<<\"\$out\""
check "s3-setup: версионирование включено" "grep -q 'версионирование: включено' <<<\"\$out\""
check "s3-setup: правило хранения 7 дней" "grep -q 'через 7 дней' <<<\"\$out\""

bad=$(mktemp -d); cp "$ORDIUS_ETC"/* "$bad/"; sed -i 's/^S3_BUCKET=.*/S3_BUCKET=no-such-bucket/' "$bad/ordius.conf"
check "s3-setup: чужой бакет — ошибка" "! ORDIUS_ETC='$bad' ordius-s3-setup >/dev/null 2>&1"
rm -rf "$bad"

# shellcheck source=../lib/common.sh
source "$HERE/lib/common.sh"
load_backup_env
check "restic: хранилище создаётся" "r init >/dev/null 2>&1"

# --- 4. копии ----------------------------------------------------------------
check "backup: первая копия" "ordius-backup >/dev/null 2>&1"
check "backup: отметка last-ok" "[ -s '$ORDIUS_DATA/backup/last-ok' ]"
check "backup: оповещение об успехе" "grep -qx '/hc' '$T/pings'"

sqlite3 "$DB" "INSERT INTO _collections VALUES ('c3','tasks');"
echo "фото чека 2" > "$ORDIUS_DATA/pb_data/storage/abc123/photo2.jpg"
check "backup: вторая копия" "ordius-backup >/dev/null 2>&1"
check "restic: две копии в списке" "[ \"\$(r snapshots --json --host ordius-app --tag ordius | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')\" = 2 ]"
check "restic: в копии есть ключ шифрования настроек" "r ls latest --host ordius-app | grep -q '/pocketbase.env\$'"

check "maintain --test: пробное восстановление" "ordius-maintain --test >/dev/null 2>&1"
check "maintain --full: очистка, проверка и пробное восстановление" "ordius-maintain --full >/dev/null 2>&1"
check "maintain: временные папки убраны" "! ls -d '$ORDIUS_DATA'/restore-test.* >/dev/null 2>&1"

# --- 5. восстановление после «потери» данных ----------------------------------
rm -f "$DB" "$ORDIUS_DATA/pb_data/storage/abc123/photo1.jpg"
check "restore: восстановление последней копии" "ordius-restore latest >/dev/null 2>&1"
check "restore: база на месте и цела" "[ \"\$(sqlite3 '$DB' 'PRAGMA integrity_check;')\" = ok ]"
check "restore: все 3 записи вернулись" "[ \"\$(sqlite3 '$DB' 'SELECT count(*) FROM _collections;')\" = 3 ]"
check "restore: оба фото вернулись" "[ -s '$ORDIUS_DATA/pb_data/storage/abc123/photo1.jpg' ] && [ -s '$ORDIUS_DATA/pb_data/storage/abc123/photo2.jpg' ]"
check "restore: прежние данные отложены, а не удалены" "ls -d '$ORDIUS_DATA'/pb_data.before-restore-* >/dev/null 2>&1"

first=$(r snapshots --json --host ordius-app --tag ordius | python3 -c 'import json,sys; print(sorted(json.load(sys.stdin), key=lambda s: s["time"])[0]["short_id"])')
check "restore: откат на более раннюю копию" "ordius-restore '$first' >/dev/null 2>&1 && [ \"\$(sqlite3 '$DB' 'SELECT count(*) FROM _collections;')\" = 2 ]"

# --- 6. сбой хранилища --------------------------------------------------------
kill "$MOTO_PID"; wait "$MOTO_PID" 2>/dev/null || true; MOTO_PID=""
: > "$T/pings"
check "backup: хранилище недоступно — ошибка, а не тишина" "! timeout 120 ordius-backup >/dev/null 2>&1"
check "backup: оповещение о сбое /fail" "grep -qx '/hc/fail' '$T/pings'"

# --- 7. выкладка ------------------------------------------------------------
src="$T/src"; mkdir -p "$src/backend/pb_migrations" "$src/backend/pb_hooks" "$src/server/config"
cp "$HERE/config/placeholder.html" "$src/server/config/"
echo 'migrate(() => {})' > "$src/backend/pb_migrations/1_init.js"
echo '// hook' > "$src/backend/pb_hooks/main.pb.js"
git -C "$src" init -q -b main && git -C "$src" -c user.name=t -c user.email=t@t add -A && git -C "$src" -c user.name=t -c user.email=t@t commit -qm init
git clone -q "$src" "$ORDIUS_OPT/repo"
check "deploy: файлы разложены" "ordius-deploy --no-restart >/dev/null 2>&1 && [ -s '$ORDIUS_OPT/pb_migrations/1_init.js' ] && [ -s '$ORDIUS_OPT/pb_hooks/main.pb.js' ] && grep -q ORDIUS '$ORDIUS_OPT/pb_public/index.html'"
git -C "$src" rm -q backend/pb_hooks/main.pb.js && git -C "$src" -c user.name=t -c user.email=t@t commit -qm rm
check "deploy: удалённый хук исчезает, миграции остаются" "ordius-deploy --no-restart >/dev/null 2>&1 && [ ! -e '$ORDIUS_OPT/pb_hooks/main.pb.js' ] && [ -s '$ORDIUS_OPT/pb_migrations/1_init.js' ]"

echo
if [ "$failed" -eq 0 ]; then echo "Все проверки прошли"; else echo "$failed проверок не прошло"; fi
exit "$failed"
