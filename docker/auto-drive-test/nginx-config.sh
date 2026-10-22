#!/usr/bin/env bash
# Installs production's nginx configuration with its S3 server block served
# over plain HTTP. Fails the build if the production files no longer have the
# shape this extraction relies on.
set -euo pipefail

SRC=${1:?usage: nginx-config.sh <directory with nginx.conf and backend.mainnet.public.conf>}
PUBLIC=$SRC/backend.mainnet.public.conf

sed '/ssl_dhparam/d' "$SRC/nginx.conf" >/etc/nginx/nginx.conf
: >/etc/nginx/hasura.conf
rm -f /etc/nginx/sites-enabled/default

{
  awk '/^server \{/ { exit } /^(limit_req_zone|limit_conn_zone|limit_req_status) /' "$PUBLIC"
  echo
  echo 'server {'
  echo '    listen 80 default_server;'
  echo '    server_name _;'
  # Production serves S3 on the default HTTPS port, where $host is enough.
  # This image is published on any port, and the backend builds the
  # CompleteMultipartUpload Location from Host, so keep the client's port.
  awk '
    /server_name s3\.auto-drive\.autonomys\.xyz;/ && !done { copying = 1; next }
    copying && /# TLS:/ { copying = 0; done = 1 }
    copying
  ' "$PUBLIC" | sed 's/proxy_set_header Host \$host;/proxy_set_header Host $http_host;/'
  echo '}'
} >/etc/nginx/backend.conf

for expected in \
  'zone=s3addr' \
  'location / {' \
  'proxy_pass http://127.0.0.1:3000;' \
  'proxy_set_header Host $http_host;' \
  'rewrite "(?s)^/(.*)$" /s3/$1 break;'; do
  grep -qF "$expected" /etc/nginx/backend.conf || {
    echo "nginx-config.sh: S3 block extracted from $PUBLIC lacks: $expected" >&2
    exit 1
  }
done

cp "$SRC/gateway-stub.conf" /etc/nginx/conf.d/gateway-stub.conf
