#!/bin/sh
# Install corporate CA certificates already copied into /usr/local/share/ca-certificates/.
set -eu

apk add --no-cache ca-certificates
update-ca-certificates

if ! grep -q UnsafeLegacyRenegotiation /etc/ssl/openssl.cnf 2>/dev/null; then
  echo "Options = UnsafeLegacyRenegotiation" >> /etc/ssl/openssl.cnf
fi
