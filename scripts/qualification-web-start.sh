#!/bin/sh
set -eu

# Schema and app-store mutations are deliberate maintenance operations, never a
# side effect of serving traffic. The runtime URL can only be changed before a
# digest-addressed image is started.
scripts/replace-placeholder.sh "$BUILT_NEXT_PUBLIC_WEBAPP_URL" "$NEXT_PUBLIC_WEBAPP_URL"
exec setpriv --reuid=node --regid=node --init-groups yarn start
