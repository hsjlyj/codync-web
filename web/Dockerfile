# syntax=docker/dockerfile:1
#
# The Web client. next.config.ts sets `output: "export"`, so the build produces
# a static site in web/out and the runtime image is only a web server over it.
#
# Build from the repository root:
#
#   docker build -f web/Dockerfile -t <namespace>/codync-web .

FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS build

WORKDIR /app

# Dependencies first, so a source-only change reuses this layer.
COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS runtime

# Every exported route is its own .html file, so the server has to try
# `$uri.html` before giving up — the stock nginx config would 404 on /client.
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/out /usr/share/nginx/html

EXPOSE 80
