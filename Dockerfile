FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS builder

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
RUN yarn vitest run packages/features/tasker/internal-tasker.test.ts packages/features/tasker/task-processor.test.ts
# Build and make embed servable from web/public/embed folder
RUN yarn workspace @calcom/trpc run build
RUN yarn --cwd packages/embeds/embed-core workspace @calcom/embed-core run build
RUN yarn --cwd apps/web workspace @calcom/web run copy-app-store-static
RUN yarn --cwd apps/web workspace @calcom/web run build
RUN rm -rf node_modules/.cache .yarn/cache apps/web/.next/cache

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
# Next standalone owns traced workspace links. Merge only production external
# dependencies into it, rather than replacing those traced links with a full
# monorepo node_modules tree.
RUN mkdir /runtime-node_modules \
  && cp -a node_modules/. /runtime-node_modules/ \
  && rm -rf /runtime-node_modules/@calcom /runtime-node_modules/@coss

FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS runner

WORKDIR /calcom

RUN command -v setpriv && command -v sed && command -v egrep && command -v find

# The standalone output has its traced workspace runtime tree. Only the focused
# production external closure and the two explicit maintenance source roots are
# added; no build/test tree is copied into the published image.
COPY --from=builder --chown=node:node /calcom/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /calcom/apps/web/public ./apps/web/public
COPY --from=builder --chown=node:node /calcom/apps/web/.next/static ./apps/web/.next/static
COPY --from=runtime-deps --chown=node:node /runtime-node_modules ./node_modules
COPY --from=builder --chown=node:node /calcom/packages/prisma ./packages/prisma
COPY --from=builder --chown=node:node /calcom/packages/app-store ./packages/app-store
COPY --chown=node:node scripts/replace-placeholder.sh scripts/qualification-entrypoint.sh scripts/qualification-web-start.sh scripts/seed-app-store.ts ./scripts/

RUN chmod +x scripts/replace-placeholder.sh scripts/qualification-entrypoint.sh scripts/qualification-web-start.sh
# The upstream runtime URL replacement writes only built/static web assets before
# dropping to node. With all Linux capabilities removed, UID 0 cannot bypass
# ownership, so make precisely those replacement targets root-owned and retain
# node read/execute access. No runtime path is world-writable.
RUN chown -R root:root /calcom/apps/web/.next /calcom/apps/web/public \
  && find /calcom/apps/web/.next /calcom/apps/web/public -type d -exec chmod 0755 {} + \
  && find /calcom/apps/web/.next /calcom/apps/web/public -type f -exec chmod u=rwX,go=rX {} + \
  && ! find /calcom -type d \( \
      -path '*/@depot' -o -path '*/trigger.dev' -o -path '*/@esbuild' -o \
      -path '*/esbuild' -o -path '*/vite' -o -path '*/playwright' -o \
      -path '*/@playwright' \
    \) -print -quit | grep -q .

ARG NEXT_PUBLIC_WEBAPP_URL=http://localhost:3000
ENV NEXT_PUBLIC_WEBAPP_URL=$NEXT_PUBLIC_WEBAPP_URL \
  BUILT_NEXT_PUBLIC_WEBAPP_URL=$NEXT_PUBLIC_WEBAPP_URL \
  NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["/calcom/scripts/qualification-entrypoint.sh", "web"]
