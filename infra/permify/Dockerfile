# infra/permify/Dockerfile
#
# Minimal init container that waits for Permify to be healthy,
# then pushes the nexcom RBAC schema from permify.perm.
#
# Build context must be the project root so permify.perm is accessible:
#   docker build -f infra/permify/Dockerfile -t nexcom-permify-init .

FROM alpine:3.19

# curl, jq, and CA roots are required for the authenticated TLS health and schema write.
RUN apk add --no-cache ca-certificates curl jq

# Copy the schema file and the push script
COPY permify.perm /app/permify.perm
COPY infra/permify/push-schema.sh /app/push-schema.sh
RUN chmod +x /app/push-schema.sh

ENV PERMIFY_HOST=permify \
    PERMIFY_HTTP_PORT=3476 \
    PERMIFY_TENANT_ID=t1 \
    SCHEMA_FILE=/app/permify.perm

CMD ["sh", "/app/push-schema.sh"]
