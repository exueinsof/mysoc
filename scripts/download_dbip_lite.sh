#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${ROOT_DIR}/data/dbip"
TARGET_FILE="${TARGET_DIR}/dbip-city-lite.mmdb"
PAGE_URL="${GEOIP_DOWNLOAD_URL:-https://db-ip.com/db/download/ip-to-city-lite}"

mkdir -p "${TARGET_DIR}"

download_url="$(
  curl -fsSL -A 'Mozilla/5.0' "${PAGE_URL}" \
    | sed -n "s/.*href='\\(https:\\/\\/download\\.db-ip\\.com\\/free\\/dbip-city-lite-[0-9]\\{4\\}-[0-9]\\{2\\}\\.mmdb\\.gz\\)'.*/\\1/p" \
    | head -n 1
)"

if [[ -z "${download_url}" ]]; then
  echo "Unable to resolve DB-IP Lite MMDB URL from ${PAGE_URL}" >&2
  exit 1
fi

tmp_gz="${TARGET_FILE}.gz.tmp"
tmp_mmdb="${TARGET_FILE}.tmp"

curl -fsSL -A 'Mozilla/5.0' "${download_url}" -o "${tmp_gz}"
gzip -dc "${tmp_gz}" > "${tmp_mmdb}"
mv "${tmp_mmdb}" "${TARGET_FILE}"
rm -f "${tmp_gz}"
printf '%s\n' "${download_url}" > "${TARGET_FILE}.url"

echo "Downloaded DB-IP Lite MMDB to ${TARGET_FILE}"
