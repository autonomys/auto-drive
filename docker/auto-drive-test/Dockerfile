# syntax=docker/dockerfile:1

# Auto Drive's S3 API on local storage only, for client integration tests.
# Build from the repository root:
#   docker build -f docker/auto-drive-test/Dockerfile -t auto-drive-test .

FROM node:20.18.3-bookworm-slim AS node

FROM node AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake python3 git libsqlite3-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare yarn@4.2.2 --activate
WORKDIR /usr/src/app
COPY . .
# Compiling TypeScript needs no native modules, and some test-only ones (the
# Jest SWC transform) fail to build here. The production install below builds
# the native modules the services load.
RUN YARN_ENABLE_SCRIPTS=false yarn install --immutable
# files-gateway has its own lockfile, so its build scripts run as a separate
# project and need that project installed too.
RUN cd submodules/files-gateway && YARN_ENABLE_SCRIPTS=false yarn install --immutable
RUN yarn workspaces foreach -Rt --from '{backend,auth}' run build
# The root workspace is included because auth resolves siwe's peer dependency,
# ethers, from it.
RUN rm -rf submodules/files-gateway/node_modules \
    && yarn workspaces focus --production auto-drive backend auth

FROM postgres:17.9-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx rabbitmq-server supervisor tini curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --no-create-home --shell /usr/sbin/nologin autodrive
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=build /usr/src/app /usr/src/app

COPY nginx/nginx.conf nginx/backend.mainnet.public.conf /tmp/nginx-prod/
COPY docker/auto-drive-test/nginx-config.sh docker/auto-drive-test/gateway-stub.conf /tmp/nginx-prod/
RUN /tmp/nginx-prod/nginx-config.sh /tmp/nginx-prod && nginx -t && rm -rf /tmp/nginx-prod

COPY docker/auto-drive-test/supervisord.conf docker/auto-drive-test/seed.sql /etc/auto-drive-test/
COPY docker/auto-drive-test/start.sh /usr/local/bin/auto-drive-test-start
COPY docker/auto-drive-test/run-node.sh /usr/local/bin/auto-drive-test-node
COPY docker/auto-drive-test/ready.sh /usr/local/bin/auto-drive-test-ready
COPY docker/auto-drive-test/healthcheck.sh /usr/local/bin/auto-drive-test-healthcheck

ENV AUTO_DRIVE_TEST_ACCESS_KEY_ID=0123456789abcdef0123456789abcdef \
    DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/autodrive \
    RABBITMQ_URL=amqp://guest:guest@127.0.0.1:5672 \
    AUTH_SERVICE_URL=http://127.0.0.1:3030 \
    JWT_SECRET_ALGORITHM=HS256 \
    FILES_GATEWAY_URL=http://127.0.0.1:8081 \
    FILES_GATEWAY_TOKEN=unused \
    OBJECT_MAPPING_ARCHIVER_URL=ws://127.0.0.1:9 \
    RPC_ENDPOINT=ws://127.0.0.1:9 \
    EVM_CHAIN_ENDPOINT=http://127.0.0.1:9 \
    EVM_CHAIN_CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000 \
    FORBIDDEN_EXTENSIONS=exe \
    DEFAULT_ACCOUNT_UPLOAD_LIMIT=1125899906842624 \
    DEFAULT_ACCOUNT_DOWNLOAD_LIMIT=1125899906842624 \
    CACHE_DIR=/var/lib/auto-drive-test/cache \
    CACHE_MAX_SIZE=2147483648 \
    MEMORY_DOWNLOAD_CACHE_MAX_SIZE=134217728 \
    DEBUG_LEVEL=info \
    DEBUG_TIMESTAMP=iso

LABEL org.opencontainers.image.source=https://github.com/autonomys/auto-drive \
      org.opencontainers.image.description="Auto Drive S3 API on local storage, for integration tests" \
      org.opencontainers.image.licenses=MIT

EXPOSE 80
HEALTHCHECK --interval=5s --timeout=5s --start-period=180s CMD ["auto-drive-test-healthcheck"]
ENTRYPOINT ["tini", "--", "auto-drive-test-start"]
