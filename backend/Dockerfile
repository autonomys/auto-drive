FROM node:20

WORKDIR /app

COPY . .

RUN rm -rf node_modules
RUN yarn install
RUN yarn build

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD curl -f http://localhost:3000/health || exit 1

CMD ["bash", "start-server.sh"]