FROM node:20.18.3-bookworm-slim

WORKDIR /usr/src/app

COPY . .
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    python3-pip \
    python3-setuptools \
    git \
    libsqlite3-dev
RUN apt update && apt install -y curl
RUN apt-get clean && rm -rf /var/lib/apt/lists/*
RUN corepack enable
RUN corepack prepare yarn@4.2.2 --activate
RUN npm i -g bun
RUN make -B backend

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD curl -f http://localhost:3000/health || exit 1

CMD ["yarn", "workspace", "backend", "start"]
