FROM node:20.18.3-bookworm-slim

WORKDIR /app

COPY . .

RUN rm -rf node_modules
RUN yarn install
RUN yarn build

EXPOSE 3030

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD curl -f http://localhost:3030/health || exit 1

CMD ["bash", "start-server.sh"]
