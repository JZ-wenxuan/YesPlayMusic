#!/bin/sh
set -eu

NETEASE_API_APP="$(npm root -g)/@neteaseapireborn/api/app.js"

cleanup() {
  kill "$ytmurl_pid" "$netease_pid" "$nginx_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup TERM INT

cd /opt/ytmurl
python3 run.py &
ytmurl_pid=$!

PORT=3000 node "${NETEASE_API_APP}" &
netease_pid=$!

nginx -g 'daemon off;' &
nginx_pid=$!

wait
