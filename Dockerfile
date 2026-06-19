FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY web ./web

ENV HTTP_PORT=8080
ENV WIALON_PORT=20332
ENV JT808_PORT=20380
ENV DATA_PATH=/app/data

EXPOSE 8080 20332 20380
CMD ["node", "src/server.mjs"]
