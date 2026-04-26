FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY main.go .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o ddos-guard .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /root/

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

COPY --from=builder /app/ddos-guard .

EXPOSE 7072

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:7072/health || exit 1

CMD ["./ddos-guard"]
