# syntax=docker/dockerfile:1
#
# codync-host — the Rust daemon that runs the bots.
#
# Build from the repository root (the context has to be the root: the language
# files and fixtures the host reads at compile time live outside host/):
#
#   docker build -f host/Dockerfile -t <namespace>/codync-host .
#
# What shapes this file:
#   * CODYNC_ENV is read at COMPILE time (option_env!) and defaults to Dev. A
#     default build is a useless image: port 19223, state in ~/.codync-dev, the
#     dev cloud endpoint, and the dev device-certificate key — a production
#     phone could never pair with it. The build stage pins it to main.
#   * HOME has to exist at run time: the host resolves its state directory from
#     it and refuses to start without one, and Docker does not set HOME for the
#     USER instruction. The runtime stage sets it explicitly.
#   * rusqlite is built with the `bundled` feature, so the runtime image needs
#     no system SQLite.
#   * cmake is a build-time requirement of aws-lc-rs (TLS); the runtime image
#     needs ca-certificates, because the host builds a real TLS client for the
#     cloud on first use.
#   * `serve` defaults to --bind 0.0.0.0, and the port comes from the
#     compiled-in Environment::port() — 19222 for a Main build. The entrypoint
#     spells out the bind but deliberately leaves the port alone, so a wrong
#     build fails loudly; see the first note above.
#   * Do NOT run `codync-host install` in this image. Self-updating is gated on
#     a systemd unit, so it stays inert here, and replacing the binary would
#     break the image contract — upgrade by running a newer tag.

FROM rust:1.99.0-bookworm@sha256:114c7a4425406451c2866b6aafe69fe29b1b298832db1277d411ac73c82d04d6 AS build

# A container ships a release build, and a release build is a Main build.
ENV CODYNC_ENV=main

RUN apt-get update \
 && apt-get install -y --no-install-recommends cmake pkg-config \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# The host crate, plus only the paths inside apps/, docs/ and packaging/ that
# host/ reads at compile time. The relative layout has to match the repository:
# those includes resolve through ../../../ from host/src.
COPY host/ ./host/
COPY apps/ios/Kit/Sources/CodyncKit/Resources/Languages/ ./apps/ios/Kit/Sources/CodyncKit/Resources/Languages/
COPY docs/reference/fixtures/ ./docs/reference/fixtures/
COPY packaging/updates/ ./packaging/updates/

WORKDIR /src/host
# One layer, so the cache mount can hold the registry and the target directory
# across builds while the binary still lands in the image.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/host/target \
    cargo build --release --locked \
 && cp target/release/codync-host /usr/local/bin/codync-host \
 && /usr/local/bin/codync-host --version

FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3 AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# State (token, identity key, SQLite, bots/, agents/) lives in $HOME/.codync.
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin codync

COPY --from=build /usr/local/bin/codync-host /usr/local/bin/codync-host

USER codync
ENV HOME=/home/codync
WORKDIR /home/codync
VOLUME ["/home/codync/.codync"]

# The host API: HTTP + SSE, and the WebSocket the Web client speaks.
EXPOSE 19222

ENTRYPOINT ["codync-host"]
# No --port on purpose: the default comes from the compiled-in
# Environment::port(). A build that forgot CODYNC_ENV=main listens on 19223
# instead of 19222, so the published port reaches nothing and the smoke test
# fails loudly — rather than the container coming up and quietly talking to the
# dev cloud with a dev device certificate.
CMD ["serve", "--bind", "0.0.0.0"]
