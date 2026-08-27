FROM node:24.18-alpine3.23 as build

RUN npm install -g pnpm@11.11.0

# Move files into the image and install
WORKDIR /app
COPY ./package.json ./
COPY ./pnpm-lock.yaml ./
COPY ./pnpm-workspace.yaml ./
COPY ./.npmrc ./
COPY ./tsconfig.json ./
# NOTE plc's transitive dependencies go here: if that changes, this needs to be updated.
COPY ./packages/lib ./packages/lib
COPY ./packages/server ./packages/server

RUN pnpm install --frozen-lockfile
RUN pnpm run --recursive --stream build
RUN pnpm run --recursive --stream update-main-to-dist
# Remove non-prod deps, hoisted so the runtime can resolve them.
# The layout change makes pnpm re-create node_modules, which it will not do
# without a TTY unless the purge confirmation is turned off.
RUN pnpm install --prod --shamefully-hoist --frozen-lockfile --prefer-offline \
  --config.confirm-modules-purge=false

# Uses assets from build stage to reduce build size
FROM node:24.18-alpine3.23

RUN apk add --update dumb-init

# Avoid zombie processes, handle signal forwarding
ENTRYPOINT ["dumb-init", "--"]

WORKDIR /app/packages/server/service
COPY --from=build /app /app

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

# https://github.com/nodejs/docker-node/blob/master/docs/BestPractices.md#non-root-user
USER node
# The service is ESM now, so dd-trace's CommonJS `require('dd-trace/init')`
# no longer works -- it cannot install the ESM loader hook from an import.
# initialize.mjs is the faithful replacement: it requires the same init.js
# (guardrails and env-driven config unchanged) and registers the hook.
CMD ["node", "--enable-source-maps", "--import", "dd-trace/initialize.mjs", "index.js"]

LABEL org.opencontainers.image.source=https://github.com/did-method-plc/did-method-plc
LABEL org.opencontainers.image.description="DID PLC server"
LABEL org.opencontainers.image.licenses=MIT
