# The target-native slim builder installs only the toolchain required by
# upstream native install hooks. None of these packages reach the published
# runner, which uses the same supported Node LTS and Debian stable generation.
FROM node:24.19.0-trixie-slim@sha256:0711b541c1c33a8a530ac4f0d391baa9a15b3d804695b1b24a47daa5fb60e74d AS builder

WORKDIR /calcom

RUN apt-get update \
  && apt-get install -y --no-install-recommends g++ make python3 unzip \
  && rm -rf /var/lib/apt/lists/*

## If we want to read any ENV variable from .env file, we need to first accept and pass it as an argument to the Dockerfile
ARG NEXT_PUBLIC_LICENSE_CONSENT
ARG NEXT_PUBLIC_WEBSITE_TERMS_URL
ARG NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL
ARG CALCOM_TELEMETRY_DISABLED=1
ARG DATABASE_URL
ARG NEXTAUTH_SECRET=secret
ARG CALENDSO_ENCRYPTION_KEY=secret
ARG MAX_OLD_SPACE_SIZE=6144
ARG NEXT_PUBLIC_API_V2_URL=""
ARG NEXT_PUBLIC_DISABLE_SIGNUP=true
ARG CSP_POLICY

## We need these variables as required by Next.js build to create rewrites
ARG NEXT_PUBLIC_SINGLE_ORG_SLUG
ARG ORGANIZATIONS_ENABLED=false

ENV NEXT_PUBLIC_WEBAPP_URL=http://NEXT_PUBLIC_WEBAPP_URL_PLACEHOLDER \
  NEXT_PUBLIC_API_V2_URL=$NEXT_PUBLIC_API_V2_URL \
  NEXT_PUBLIC_DISABLE_SIGNUP=$NEXT_PUBLIC_DISABLE_SIGNUP \
  NEXT_PUBLIC_LICENSE_CONSENT=$NEXT_PUBLIC_LICENSE_CONSENT \
  NEXT_PUBLIC_WEBSITE_TERMS_URL=$NEXT_PUBLIC_WEBSITE_TERMS_URL \
  NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL=$NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL \
  CALCOM_TELEMETRY_DISABLED=$CALCOM_TELEMETRY_DISABLED \
  DATABASE_URL=$DATABASE_URL \
  DATABASE_DIRECT_URL=$DATABASE_URL \
  NEXTAUTH_SECRET=${NEXTAUTH_SECRET} \
  CALENDSO_ENCRYPTION_KEY=${CALENDSO_ENCRYPTION_KEY} \
  NEXT_PUBLIC_SINGLE_ORG_SLUG=$NEXT_PUBLIC_SINGLE_ORG_SLUG \
  ORGANIZATIONS_ENABLED=$ORGANIZATIONS_ENABLED \
  NODE_OPTIONS=--max-old-space-size=${MAX_OLD_SPACE_SIZE} \
  BUILD_STANDALONE=true \
  CSP_POLICY=$CSP_POLICY

COPY package.json yarn.lock .yarnrc.yml playwright.config.ts turbo.json i18n.json ./
COPY .yarn ./.yarn
COPY apps ./apps
COPY example-apps ./example-apps
COPY packages ./packages

RUN yarn config set httpTimeout 1200000
RUN yarn install --immutable
RUN node -e "require('deasync').runLoopOnce()" \
  && node -e "require('sharp')({ create: { width: 1, height: 1, channels: 4, background: '#000' } }).png().toBuffer()" \
  && node -e "require('@sentry-internal/node-cpu-profiler')"
COPY scripts/seed-app-store.ts ./scripts/seed-app-store.ts
COPY scripts/qualification/seed-bundle.config.mjs ./scripts/qualification/seed-bundle.config.mjs
RUN yarn --cwd packages/embeds/embed-core vite build --config ../../../scripts/qualification/seed-bundle.config.mjs
RUN yarn vitest run packages/features/tasker/internal-tasker.test.ts packages/features/tasker/task-processor.test.ts
# Build and make embed servable from web/public/embed folder
RUN yarn workspace @calcom/trpc run build
# The upstream aggregate build script resolves ad hoc cleanup/copy tooling. Use
# only immutable-install local binaries here so the Docker build cannot fetch a
# mutable package; this is a fresh builder so clearing these outputs is bounded.
RUN rm -rf packages/embeds/embed-core/dist apps/web/public/embed \
  && yarn --cwd packages/embeds/embed-core workspace @calcom/embed-core run tailwind \
  && yarn --cwd packages/embeds/embed-core vite build \
  && yarn --cwd packages/embeds/embed-core tsc --emitDeclarationOnly --declarationDir dist \
  && cp -r apps/web/public/embed packages/embeds/embed-core/dist/
RUN yarn --cwd apps/web workspace @calcom/web run copy-app-store-static
RUN yarn --cwd apps/web workspace @calcom/web run build
RUN rm -rf node_modules/.cache apps/web/.next/cache

# This stage runs on the target platform because no Docker stage pins a host
# platform. Next standalone already contains the traced serving graph, so this
# separate closure is limited to the Prisma/seed maintenance commands.
FROM builder AS runtime-deps

RUN yarn workspaces focus @calcom/prisma --production
RUN find node_modules -depth -type d \( \
      -path '*/@depot' -o -path '*/@trigger.dev' -o -path '*/@esbuild' -o \
      -path '*/esbuild' -o -path '*/vite' -o -path '*/playwright' -o \
      -path '*/@playwright' \
    \) -exec rm -rf {} + \
  && test -x node_modules/.bin/prisma \
  && test -x node_modules/.bin/ts-node \
  && ! find node_modules -type d \( \
      -path '*/@depot' -o -path '*/@trigger.dev' -o -path '*/@esbuild' -o \
      -path '*/esbuild' -o -path '*/vite' -o -path '*/playwright' -o \
      -path '*/@playwright' \
    \) -print -quit | grep -q .
# Yarn focus retains the exact nested adapter package metadata but not its dist
# payload. Restore that one checksum-verified immutable-install archive before
# narrowing workspace aliases and handing the tree to the runner.
RUN command -v unzip \
  && rm -rf /tmp/driver-adapter-utils \
  && mkdir -p /tmp/driver-adapter-utils node_modules/@prisma/adapter-pg/node_modules/@prisma \
  && unzip -q .yarn/cache/@prisma-driver-adapter-utils-npm-6.16.1-37fd39f74c-0866fce22f.zip -d /tmp/driver-adapter-utils \
  && rm -rf node_modules/@prisma/adapter-pg/node_modules/@prisma/driver-adapter-utils \
  && cp -a /tmp/driver-adapter-utils/node_modules/@prisma/driver-adapter-utils node_modules/@prisma/adapter-pg/node_modules/@prisma/driver-adapter-utils \
  && rm -rf /tmp/driver-adapter-utils \
  && rm -rf node_modules/@calcom node_modules/@coss \
  && mkdir -p node_modules/@calcom \
  && ln -s ../../packages/prisma node_modules/@calcom/prisma \
  && test -f node_modules/@prisma/adapter-pg/node_modules/@prisma/driver-adapter-utils/dist/index.js

FROM node:24.19.0-trixie-slim@sha256:0711b541c1c33a8a530ac4f0d391baa9a15b3d804695b1b24a47daa5fb60e74d AS runner

WORKDIR /calcom

# The immutable upstream digest can predate fixes already published in Debian
# stable. Apply only repository-supported security/stable updates, then remove
# package-manager metadata from the final filesystem.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# The serving and maintenance entrypoints execute Node and checked-in scripts
# directly. Package managers and their large transitive trees are build-stage
# tools, so remove them from the published image before adding the app closure.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx \
  && ! command -v npm \
  && ! command -v npx \
  && ! command -v yarn \
  && ! command -v corepack \
  && test "$(node --version)" = "v24.19.0" \
  && . /etc/os-release \
  && test "$VERSION_ID" = "13" \
  && command -v setpriv \
  && command -v sed \
  && command -v egrep \
  && command -v find

# The standalone output has its traced workspace runtime tree. Keep the focused
# Prisma/seed maintenance closure under a separate root so Docker COPY merging
# cannot replace or partially overwrite Next's traced nested dependencies.
COPY --from=builder --chown=node:node /calcom/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /calcom/apps/web/public ./apps/web/public
COPY --from=builder --chown=node:node /calcom/apps/web/.next/static ./apps/web/.next/static
# Next 16.3.1 resolves its exact @swc/helpers dependency from this nested path,
# but output tracing omits the payload. Copy only that immutable dependency.
COPY --from=builder --chown=node:node /calcom/node_modules/next/node_modules/@swc/helpers ./node_modules/next/node_modules/@swc/helpers
COPY --from=runtime-deps --chown=node:node /calcom/node_modules ./maintenance/node_modules
COPY --from=builder --chown=node:node /calcom/packages/prisma ./maintenance/packages/prisma
COPY --from=builder --chown=node:node /calcom/.qualification/seed/seed-app-store.cjs ./scripts/seed-app-store.cjs
COPY --chown=node:node scripts/replace-placeholder.sh scripts/qualification-entrypoint.sh scripts/qualification-web-start.sh ./scripts/

RUN chmod +x scripts/replace-placeholder.sh scripts/qualification-entrypoint.sh scripts/qualification-web-start.sh
# The upstream runtime URL replacement writes only built/static web assets before
# dropping to node. With all Linux capabilities removed, UID 0 cannot bypass
# ownership, so make precisely those replacement targets root-owned and retain
# node read/execute access. No runtime path is world-writable.
RUN test -f /calcom/maintenance/node_modules/@prisma/adapter-pg/node_modules/@prisma/driver-adapter-utils/dist/index.js \
  && test -f /calcom/node_modules/next/node_modules/@swc/helpers/esm/_interop_require_default.js \
  && node -e "if (require('/calcom/node_modules/next/node_modules/@swc/helpers/package.json').version !== '0.5.23') process.exit(1)" \
  && find /calcom -depth -type d \( \
      -path '*/@depot' -o -path '*/@trigger.dev' -o -path '*/@esbuild' -o \
      -path '*/esbuild' -o -path '*/vite' -o -path '*/playwright' -o \
      -path '*/@playwright' \
    \) -exec rm -rf {} + \
  && chown -R root:root /calcom/apps/web/.next /calcom/apps/web/public \
  && find /calcom/apps/web/.next /calcom/apps/web/public -type d -exec chmod 0755 {} + \
  && find /calcom/apps/web/.next /calcom/apps/web/public -type f -exec chmod u=rwX,go=rX {} + \
  && ! find /calcom -type d \( \
      -path '*/@depot' -o -path '*/@trigger.dev' -o -path '*/@esbuild' -o \
      -path '*/esbuild' -o -path '*/vite' -o -path '*/playwright' -o \
      -path '*/@playwright' \
    \) -print -quit | grep -q .

ARG NEXT_PUBLIC_WEBAPP_URL=http://localhost:3000
ENV NEXT_PUBLIC_WEBAPP_URL=$NEXT_PUBLIC_WEBAPP_URL \
  BUILT_NEXT_PUBLIC_WEBAPP_URL=http://NEXT_PUBLIC_WEBAPP_URL_PLACEHOLDER \
  NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["/calcom/scripts/qualification-entrypoint.sh", "web"]
