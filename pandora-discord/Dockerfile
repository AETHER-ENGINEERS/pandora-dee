# Jade Discord bridge: discord.py + the HTTP (MCP) bridge in one small image.
#   docker compose up -d        (see docker-compose.yml)
#   docker compose run --rm jade-discord --set-token      once, to store the bot's token
#   docker compose logs | grep "Bridge token"
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libopus0 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "discord.py[voice]>=2.4" \
 && useradd --create-home --uid 10001 jade && mkdir -p /data && chown jade /data
COPY jade_discord_bridge.py archive_db.py /usr/local/bin/
USER jade
ENV JADE_DISCORD_HOME=/data JADE_DISCORD_PORT=8788 PYTHONUNBUFFERED=1
VOLUME ["/data"]
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s CMD python3 -c "import urllib.request;t=open('/data/token').read().strip();urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8788/health',headers={'Authorization':'Bearer '+t}),timeout=4)" || exit 1
ENTRYPOINT ["python3", "/usr/local/bin/jade_discord_bridge.py", "--host", "0.0.0.0"]
