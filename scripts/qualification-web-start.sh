#!/bin/sh
set -eu

# Schema and app-store mutations are deliberate maintenance operations, never a
# side effect of serving traffic. The runtime URL can only be changed before a
# digest-addressed image is started.
scripts/replace-placeholder.sh "$BUILT_NEXT_PUBLIC_WEBAPP_URL" "$NEXT_PUBLIC_WEBAPP_URL"
# The traced standalone server has no runtime Yarn, Turbo, or build cache. The
# process still drops from the bounded placeholder-replacement bootstrap to node.
exec setpriv --reuid=node --regid=node --init-groups env PORT=3000 HOSTNAME=0.0.0.0 node apps/web/server.js
