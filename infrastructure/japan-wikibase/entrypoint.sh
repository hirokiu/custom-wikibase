#!/usr/bin/env bash
set -euo pipefail

readonly marker=/var/lib/jwb/installed
readonly lock=/var/lib/jwb/install.lock

required=(JWB_DB_HOST JWB_DB_NAME JWB_DB_USER JWB_DB_PASSWORD JWB_ADMIN_USER JWB_ADMIN_PASSWORD JWB_SECRET_KEY JWB_UPGRADE_KEY JWB_INSTANCE_ID)
for name in "${required[@]}"; do
  test -n "${!name:-}" || { echo "missing required runtime setting: ${name}" >&2; exit 1; }
done
[[ "${JWB_INSTANCE_ID}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || { echo 'invalid instance identity' >&2; exit 1; }
readonly canonical_public_url="${JWB_CANONICAL_PUBLIC_URL:-${JWB_PUBLIC_URL:-http://127.0.0.1:8180}}"
[[ "${canonical_public_url}" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || { echo 'invalid canonical public URL' >&2; exit 1; }

install -d -m 0770 -o www-data -g www-data /var/lib/jwb /var/www/html/images
chown www-data:www-data /var/www/html/images

for attempt in $(seq 1 60); do
  if php -r '$db = @new mysqli(getenv("JWB_DB_HOST"), getenv("JWB_DB_USER"), getenv("JWB_DB_PASSWORD"), getenv("JWB_DB_NAME")); exit($db->connect_errno ? 1 : 0);'; then
    break
  fi
  test "${attempt}" -lt 60 || { echo 'MariaDB did not become ready' >&2; exit 1; }
  sleep 2
done

if test ! -f "${marker}"; then
  exec 9>"${lock}"
  flock 9
  if test ! -f "${marker}"; then
    rm -f /var/www/html/LocalSettings.php
    install_dir="$(mktemp -d)"
    php maintenance/install.php \
      --confpath "${install_dir}" \
      --dbname "${JWB_DB_NAME}" \
      --dbserver "${JWB_DB_HOST}" \
      --dbuser "${JWB_DB_USER}" \
      --dbpass "${JWB_DB_PASSWORD}" \
      --server "${canonical_public_url}" \
      --scriptpath '' \
      --lang ja \
      --pass "${JWB_ADMIN_PASSWORD}" \
      "${JWB_SITE_NAME:-Japan Wikibase Development}" "${JWB_ADMIN_USER}"
    rm -rf "${install_dir}"
    install -m 0644 -o root -g root /opt/jwb/LocalSettings.php /var/www/html/LocalSettings.php
    php maintenance/run.php update --quick
    touch "${marker}"
    chown www-data:www-data "${marker}"
  fi
  flock -u 9
  exec 9>&-
fi

install -m 0644 -o root -g root /opt/jwb/LocalSettings.php /var/www/html/LocalSettings.php
if test "${JWB_QUERY_BACKEND:-none}" = none; then
  cat > /var/lib/jwb/runtime-contract.json <<EOF
{"contractVersion":"jwb-runtime-v1","distribution":{"type":"japan-wikibase","version":"0.1.0-rc.1"},"instance":{"id":"${JWB_INSTANCE_ID}"},"endpoints":{"mediawiki":"${canonical_public_url}/wiki/","actionApi":"${canonical_public_url}/api.php"},"health":{"state":"healthy"},"queryService":{"enabled":false},"capabilities":{"queryOptional":true,"instanceStopPreservesData":true}}
EOF
  chmod 0644 /var/lib/jwb/runtime-contract.json
  cat > /etc/apache2/conf-enabled/jwb-runtime-discovery.conf <<'EOF'
Alias "/.well-known/japan-wikibase-runtime" "/var/lib/jwb/runtime-contract.json"
<Location "/.well-known/japan-wikibase-runtime">
  ForceType application/json
  Header set Cache-Control "no-store"
</Location>
EOF
else
  cat > /etc/apache2/conf-enabled/jwb-runtime-discovery.conf <<'EOF'
ProxyPass "/.well-known/japan-wikibase-runtime" "http://query-router:19200/runtime"
ProxyPassReverse "/.well-known/japan-wikibase-runtime" "http://query-router:19200/runtime"
EOF
fi

exec "$@"
