# TRCloud proxy for Google Cloud Run.
# Runs the same deno-proxy/main.ts used for Deno Deploy, listening on $PORT.
FROM denoland/deno:2.1.4

WORKDIR /app

# Copy source and pre-cache (no external deps today, but keeps startup fast/reproducible)
COPY main.ts .
RUN deno cache main.ts

# Cloud Run sets PORT=8080. Permissions: --allow-net (listen + fetch TRCloud),
# --allow-env (read PORT + TRCLOUD_* credentials).
CMD ["run", "--allow-net", "--allow-env", "main.ts"]
