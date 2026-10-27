#!/usr/bin/env bash
# Starts one of the Node services once Postgres and RabbitMQ accept connections.
set -euo pipefail

app=${1:?usage: run-node.sh <app directory under apps/> <script>}
script=${2:?usage: run-node.sh <app directory under apps/> <script>}

for _ in $(seq 120); do
  if pg_isready -q -h 127.0.0.1 -p 5432 && (exec 3<>/dev/tcp/127.0.0.1/5672) 2>/dev/null; then
    break
  fi
  sleep 1
done

cd "/usr/src/app/apps/$app"
exec node "$script"
