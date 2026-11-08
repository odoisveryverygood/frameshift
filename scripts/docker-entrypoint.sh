#!/bin/sh
set -eu
if [ "${EARL_HOSTED:-0}" = "1" ]; then
  EARL_ADMIN_TOKEN=${EARL_ADMIN_TOKEN:-}
  if [ "${#EARL_ADMIN_TOKEN}" -lt 24 ] || [ -z "${EARL_PUBLIC_ORIGIN:-}" ]; then
    echo "Hosted mode requires a private EARL_ADMIN_TOKEN (24+ characters) and EARL_PUBLIC_ORIGIN." >&2
    exit 1
  fi
fi
# Railway volumes may initially be owned by root. Drop privileges before web/worker start.
mkdir -p "${FRAMESHIFT_DATA_DIR:-/data}"
chown node:node "${FRAMESHIFT_DATA_DIR:-/data}"
exec gosu node /usr/bin/tini -g -- "$@"
