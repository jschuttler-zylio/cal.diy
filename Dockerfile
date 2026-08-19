# The full, target-native builder carries the toolchain required by upstream
# native install hooks. The published runner below remains the slim digest.
FROM node:20.20.2-bookworm@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5 AS builder

WORKDIR /calcom

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
# platform. It keeps only the declared production closure needed by the
# traced web server and the explicit Prisma/seed maintenance commands.
FROM builder AS runtime-deps

RUN yarn workspaces focus @calcom/web --production
RUN find node_modules -depth -type d \( \
      -path '*/@depot' -o -path '*/trigger.dev' -o -path '*/@esbuild' -o \
      -path '*/esbuild' -o -path '*/vite' -o -path '*/playwright' -o \
      -path '*/@playwright' \
    \) -exec rm -rf {} + \
  && test -x node_modules/.bin/prisma \
  && test -x node_modules/.bin/ts-node \
  && ! find node_modules -type d \( \
      -path '*/@depot' -o -path '*/trigger.dev' -o -path '*/@esbuild' -o \
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

FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS runner

WORKDIR /calcom

RUN command -v setpriv && command -v sed && command -v egrep && command -v find

# The standalone output has its traced workspace runtime tree. Only the focused
# production external closure and the explicit Prisma maintenance source root are
# added; no build/test tree is copied into the published image.
COPY --from=builder --chown=node:node /calcom/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /calcom/apps/web/public ./apps/web/public
COPY --from=builder --chown=node:node /calcom/apps/web/.next/static ./apps/web/.next/static
# Output tracing can leave partial third-party package directories. Replace the
# Prisma namespace atomically with the complete focused production closure.
RUN rm -rf /calcom/node_modules/@prisma
COPY --from=runtime-deps --chown=node:node /calcom/node_modules ./node_modules
COPY --from=builder --chown=node:node /calcom/packages/prisma ./packages/prisma
COPY --from=builder --chown=node:node /calcom/.qualification/seed/seed-app-store.cjs ./scripts/seed-app-store.cjs
COPY --chown=node:node scripts/replace-placeholder.sh scripts/qualification-entrypoint.sh scripts/qualification-web-start.sh ./scripts/

RUN chmod +x scripts/replace-placeholder.sh scripts/qualification-entrypoint.sh scripts/qualification-web-start.sh
# The upstream runtime URL replacement writes only built/static web assets before
# dropping to node. With all Linux capabilities removed, UID 0 cannot bypass
# ownership, so make precisely those replacement targets root-owned and retain
# node read/execute access. No runtime path is world-writable.
RUN test -f /calcom/node_modules/@prisma/adapter-pg/node_modules/@prisma/driver-adapter-utils/dist/index.js \
  && find /calcom -depth -type d \( \
      -path '*/@depot' -o -path '*/trigger.dev' -o -path '*/@esbuild' -o \
      -path '*/esbuild' -o -path '*/vite' -o -path '*/playwright' -o \
      -path '*/@playwright' \
    \) -exec rm -rf {} + \
  && chown -R root:root /calcom/apps/web/.next /calcom/apps/web/public \
  && find /calcom/apps/web/.next /calcom/apps/web/public -type d -exec chmod 0755 {} + \
  && find /calcom/apps/web/.next /calcom/apps/web/public -type f -exec chmod u=rwX,go=rX {} + \
  && ! find /calcom -type d \( \
      -path '*/@depot' -o -path '*/trigger.dev' -o -path '*/@esbuild' -o \
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
