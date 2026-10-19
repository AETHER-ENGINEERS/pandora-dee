# Jade Vector bridge: Vector's vector-agent (patched for Jade) + the HTTP bridge, in one image.
#   docker compose up -d        (see docker-compose.yml)
#   docker compose logs | grep "Bridge token"
FROM rust:1-bookworm AS build
ARG VECTOR_REPO=https://github.com/VectorPrivacy/Vector.git
ARG VECTOR_REF=44fdb873464a99d8256ecdce7a1cfd1ddc2b45c4
RUN apt-get update && apt-get install -y --no-install-recommends clang libclang-dev pkg-config git python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init Vector && cd Vector && git remote add origin "$VECTOR_REPO" && git fetch --depth 1 origin "$VECTOR_REF" && git checkout --quiet FETCH_HEAD
COPY patch_vector_agent.py /src/
RUN python3 /src/patch_vector_agent.py /src/Vector/crates/vector-agent
RUN cd /src/Vector/crates && cargo build --release -p vector-agent && strip target/release/vector-agent

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates tini && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 jade && mkdir -p /data && chown jade /data
COPY --from=build /src/Vector/crates/target/release/vector-agent /usr/local/bin/vector-agent
COPY jade_vector_bridge.py /usr/local/bin/jade_vector_bridge.py
USER jade
ENV JADE_VECTOR_HOME=/data JADE_VECTOR_PORT=8787 VECTOR_LOG=warn
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD python3 -c "import urllib.request,os;t=open('/data/token').read().strip();urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8787/health',headers={'Authorization':'Bearer '+t}),timeout=4)" || exit 1
ENTRYPOINT ["tini", "--", "python3", "/usr/local/bin/jade_vector_bridge.py", "--agent", "/usr/local/bin/vector-agent", "--host", "0.0.0.0"]
