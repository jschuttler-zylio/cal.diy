#!/bin/sh
set -eu

required_vars='DATABASE_URL DATABASE_DIRECT_URL NEXTAUTH_SECRET CALENDSO_ENCRYPTION_KEY CRON_API_KEY CRON_SECRET NEXT_PUBLIC_WEBAPP_URL NEXTAUTH_URL ALLOWED_HOSTNAMES CALCOM_TELEMETRY_DISABLED TASKER_RETENTION_DAYS EMAIL_SERVER_HOST EMAIL_SERVER_PORT EMAIL_SERVER_USER EMAIL_SERVER_PASSWORD EMAIL_FROM EMAIL_FROM_NAME USE_POOL NEXT_PUBLIC_DISABLE_SIGNUP'
for variable in $required_vars; do
  file_var="${variable}_FILE"
  eval "file_path=\${$file_var:-}"
  if [ -z "$file_path" ] || [ ! -r "$file_path" ]; then
    echo "Required runtime file $file_var is unavailable" >&2
    exit 64
  fi
  value="$(cat "$file_path")"
  if [ -z "$value" ]; then
    echo "Required runtime file $file_var is empty" >&2
    exit 64
  fi
  export "$variable=$value"
  unset "$file_var"
done

if [ "$EMAIL_SERVER_PORT" != "587" ]; then
  echo "Qualification SMTP requires submission port 587" >&2
  exit 64
fi
if [ "$CALCOM_TELEMETRY_DISABLED" != "1" ]; then
  echo "Qualification telemetry must be disabled" >&2
  exit 64
fi
if [ "$USE_POOL" != "1" ]; then
  echo "Qualification Prisma pooling must be enabled" >&2
  exit 64
fi
if [ "$NEXT_PUBLIC_DISABLE_SIGNUP" != "true" ]; then
  echo "Qualification self-service signup must be disabled" >&2
  exit 64
fi

case "${1:-web}" in
  web)
    shift
    exec /calcom/scripts/qualification-web-start.sh "$@"
    ;;
  migrate)
    exec setpriv --reuid=node --regid=node --init-groups /calcom/node_modules/.bin/prisma migrate deploy --schema /calcom/packages/prisma/schema.prisma
    ;;
  seed-app-store)
    exec setpriv --reuid=node --regid=node --init-groups /calcom/node_modules/.bin/ts-node --transpile-only /calcom/scripts/seed-app-store.ts
    ;;
  *)
    echo "Unsupported qualification mode: ${1:-}" >&2
    exit 64
    ;;
esac
