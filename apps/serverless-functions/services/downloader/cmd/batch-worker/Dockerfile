FROM --platform=linux/arm64 alpine:3.19
RUN apk add --no-cache ca-certificates
COPY batch-worker /batch-worker
ENTRYPOINT ["/batch-worker"]
