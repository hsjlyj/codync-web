# syntax=docker/dockerfile:1
#
# The Web client. next.config.ts sets `output: "export"`, so the build produces
# a static site in web/out and the runtime image is only a web server over it.
#
# Build from the repository root:
#
#   docker build -f web/Dockerfile -t <namespace>/codync-web .

FROM node:22-bookworm-slim AS build

WORKDIR /app

# Dependencies first, so a source-only change reuses this layer.
COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

FROM nginx:1.27-alpine AS runtime

# Every exported route is its own .html file, so the server has to try
# `$uri.html` before giving up — the stock nginx config would 404 on /client.
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/out /usr/share/nginx/html

EXPOSE 80
