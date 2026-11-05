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
#   * rusqlite is built with the `bundled` feature, so the runtime image needs
#     no system SQLite.
#   * cmake is a build-time requirement of aws-lc-rs (TLS); the runtime image
#     only needs a trust store.
#   * `serve` already defaults to --bind 0.0.0.0 --port 19222, which is what a
#     container wants; the entrypoint spells both out so they read explicitly.
#   * A container has no desktop app and no terminal UI, so pairing approval is
#     the CLI:  docker exec -it <container> codync-host access approve <id>

FROM rust:1.99.0-bookworm AS build

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
# One layer so the cache mount can hold the registry and target dir across
# builds while the binary still lands in the image.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/host/target \
    cargo build --release --locked \
 && cp target/release/codync-host /usr/local/bin/codync-host

FROM debian:bookworm-slim AS runtime

# The host talks HTTPS to the Codync cloud, so it needs a trust store.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# State (devices, token, bots, sessions) lives in ~/.codync; see the volume.
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin codync

COPY --from=build /usr/local/bin/codync-host /usr/local/bin/codync-host

USER codync
WORKDIR /home/codync
VOLUME ["/home/codync/.codync"]

# The host API: HTTP + SSE, and the WebSocket the Web client speaks.
EXPOSE 19222

ENTRYPOINT ["codync-host"]
CMD ["serve", "--bind", "0.0.0.0", "--port", "19222"]
