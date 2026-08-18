#!/bin/sh
set -eu

# Schema and app-store mutations are deliberate maintenance operations, never a
# side effect of serving traffic. The runtime URL can only be changed before a
# digest-addressed image is started.
scripts/replace-placeholder.sh "$BUILT_NEXT_PUBLIC_WEBAPP_URL" "$NEXT_PUBLIC_WEBAPP_URL"
# `setpriv` changes the UID but intentionally preserves the parent environment.
# Set a node-owned home explicitly so Yarn and Turbo cannot write under `/root`
# or the immutable application tree.
exec setpriv --reuid=node --regid=node --init-groups env HOME=/home/node XDG_CONFIG_HOME=/home/node/.config yarn start --cache-dir /home/node/.cache/turbo
