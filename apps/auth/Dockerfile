FROM node:24.15.0-bookworm-slim AS build

WORKDIR /usr/src/app

RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    python3-pip \
    python3-setuptools \
    git \
    libsqlite3-dev
RUN corepack enable
RUN corepack prepare yarn@4.2.2 --activate

# Only what the two installs read, so a change anywhere else reuses them
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/auth/package.json apps/auth/
COPY packages/models/package.json packages/models/

# Only auth and the workspaces it depends on. The rest of the repo's dependencies
# include native modules that do not build on this Node version.
RUN yarn workspaces focus auth

# What the image runs besides the server: the migration tool. It is installed on
# its own from the repo's lockfile and resolutions, so it gets the versions the
# lockfile pins. Its install scripts only build bindings for an SSH tunnel the
# migrations never open.
WORKDIR /runtime
RUN node -e 'const root = require("/usr/src/app/package.json"); \
    const auth = require("/usr/src/app/apps/auth/package.json"); \
    const pick = (from, name) => { \
      if (!from[name]) throw new Error(name + " is missing from apps/auth/package.json"); \
      return [name, from[name]]; \
    }; \
    require("fs").writeFileSync("package.json", JSON.stringify({ \
      name: "auth-runtime", private: true, packageManager: "yarn@4.2.2", \
      scripts: Object.fromEntries([pick(auth.scripts, "migrate")]), \
      dependencies: Object.fromEntries([pick(auth.dependencies, "db-migrate"), pick(auth.dependencies, "db-migrate-pg")]), \
      resolutions: root.resolutions, \
    }, null, 2))'
RUN cp /usr/src/app/yarn.lock /usr/src/app/.yarnrc.yml . && YARN_ENABLE_SCRIPTS=false yarn install

WORKDIR /usr/src/app
COPY . .
RUN yarn models build
# One file holding auth and everything it imports, as the Lambda build makes
RUN yarn workspace auth server:build
RUN cp -r apps/auth/migrations apps/auth/build/server.cjs /runtime/


FROM node:24.15.0-bookworm-slim

WORKDIR /app

COPY --from=build /runtime/package.json ./
COPY --from=build /runtime/node_modules ./node_modules
COPY --from=build /runtime/migrations ./migrations
COPY --from=build /runtime/server.cjs ./

ENV NODE_ENV=production
ENV AUTH_PORT=3030
EXPOSE 3030

USER node

# The port as the server reads it: AUTH_PORT, or 3000 when that is empty
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD node -e "fetch('http://localhost:' + (process.env.AUTH_PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# Migrations: npm run migrate -- up
CMD ["node", "server.cjs"]
