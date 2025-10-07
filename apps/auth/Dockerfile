FROM node:20.19.5-bookworm-slim

WORKDIR /usr/src/app

COPY . .
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    python3-pip \
    python3-setuptools \
    git \
    libsqlite3-dev
RUN apt-get clean && rm -rf /var/lib/apt/lists/*
RUN apt update && apt install -y curl
RUN corepack enable
RUN corepack prepare yarn@4.2.2 --activate
RUN yarn install
RUN yarn workspace auth build


EXPOSE 3030

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD curl -f http://localhost:3030/health || exit 1

CMD ["yarn", "auth", "start"]
