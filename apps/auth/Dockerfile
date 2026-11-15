FROM node:24.15.0-bookworm-slim AS build

WORKDIR /usr/src/app

COPY . .
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    python3-pip \
    python3-setuptools \
    git \
    libsqlite3-dev
RUN corepack enable
RUN corepack prepare yarn@4.2.2 --activate
# Only auth and the workspaces it depends on. The rest of the repo's dependencies
# include native modules that do not build on this Node version.
RUN yarn workspaces focus auth
RUN yarn models build
# One file holding auth and everything it imports, as the Lambda build makes
RUN yarn workspace auth server:build

# What the image runs besides that file: the migration tool. It is installed on
# its own from the repo's lockfile, so it gets the versions the lockfile pins.
WORKDIR /runtime
RUN node -e 'const deps = require("/usr/src/app/apps/auth/package.json").dependencies; \
    const pick = (name) => [name, deps[name]]; \
    require("fs").writeFileSync("package.json", JSON.stringify({ \
      name: "auth-runtime", private: true, packageManager: "yarn@4.2.2", \
      scripts: { start: "node server.js", migrate: "db-migrate -t auth_migrations" }, \
      dependencies: Object.fromEntries([pick("db-migrate"), pick("db-migrate-pg")]), \
    }, null, 2))'
RUN cp /usr/src/app/yarn.lock /usr/src/app/.yarnrc.yml . && yarn install
RUN cp -r /usr/src/app/apps/auth/migrations . && cp /usr/src/app/apps/auth/build/server.js .


FROM node:24.15.0-bookworm-slim

WORKDIR /app

COPY --from=build /runtime/package.json ./
COPY --from=build /runtime/node_modules ./node_modules
COPY --from=build /runtime/migrations ./migrations
COPY --from=build /runtime/server.js ./

ENV AUTH_PORT=3030
EXPOSE 3030

USER node

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD node -e "fetch('http://localhost:3030/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# Migrations: npm run migrate -- up
CMD ["node", "server.js"]
