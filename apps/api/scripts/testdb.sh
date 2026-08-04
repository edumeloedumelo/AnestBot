#!/usr/bin/env bash
# Sobe um PostgreSQL EFÊMERO real, roda a suíte de integração e derruba tudo.
# Funciona: (a) com DATABASE_URL_TEST já apontando para um Postgres (CI);
# (b) local com binários do Postgres (initdb/pg_ctl), inclusive rodando como
# root (usa um usuário dedicado "pguser", pois o Postgres recusa root).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${DATABASE_URL_TEST:-}" ]; then
  export DATABASE_URL="$DATABASE_URL_TEST"
  echo "[testdb] usando DATABASE_URL_TEST"
  npx tsx --test test/*.test.ts
  exit $?
fi

PGBIN="$(dirname "$(command -v initdb 2>/dev/null || echo /usr/lib/postgresql/16/bin/initdb)")"
[ -x "$PGBIN/initdb" ] || { echo "[testdb] initdb não encontrado — defina DATABASE_URL_TEST"; exit 1; }

PORT=${TESTDB_PORT:-54329}
DBNAME=anestbot_test

if [ "$(id -u)" = "0" ]; then
  id pguser >/dev/null 2>&1 || useradd -m pguser
  RUNAS() { su pguser -s /bin/bash -c "$1"; }
  WORK=/home/pguser/anestbot-testdb
else
  RUNAS() { bash -c "$1"; }
  WORK="${TMPDIR:-/tmp}/anestbot-testdb-$USER"
fi

cleanup() { RUNAS "'$PGBIN/pg_ctl' -D '$WORK/data' stop -m immediate" >/dev/null 2>&1 || true; }
trap cleanup EXIT

RUNAS "rm -rf '$WORK' && mkdir -p '$WORK'"
RUNAS "'$PGBIN/initdb' -D '$WORK/data' -U anest --auth=trust -E UTF8" >/dev/null
RUNAS "'$PGBIN/pg_ctl' -D '$WORK/data' -o '-p $PORT -k $WORK -c listen_addresses= -c fsync=off' -l '$WORK/log' start" >/dev/null
RUNAS "'$PGBIN/createdb' -h '$WORK' -p $PORT -U anest $DBNAME" >/dev/null

export DATABASE_URL="postgres://anest@localhost:$PORT/$DBNAME?host=$WORK"
echo "[testdb] Postgres efêmero em $WORK (porta $PORT)"

npx tsx --test test/*.test.ts
