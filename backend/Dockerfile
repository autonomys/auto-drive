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
RUN yarn install
RUN yarn build

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD curl -f http://localhost:3000/health || exit 1

CMD ["bash", "start-server.sh"]