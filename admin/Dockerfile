FROM node:22-alpine AS frontend
WORKDIR /build/web
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
COPY web/default/package.json web/default/pnpm-lock.yaml web/default/.npmrc ./
RUN pnpm install --frozen-lockfile
COPY web/default/ ./
RUN pnpm typecheck && pnpm build

FROM golang:1.26-alpine AS backend
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /build/web/dist ./web/default/dist
ARG GO_BUILD_PARALLELISM=2
RUN GOMAXPROCS=${GO_BUILD_PARALLELISM} CGO_ENABLED=0 go build -p=${GO_BUILD_PARALLELISM} -trimpath -ldflags="-s -w" -o /admin .

FROM alpine:3.23
RUN apk add --no-cache ca-certificates tzdata && addgroup -S admin && adduser -S -G admin admin
WORKDIR /app
COPY --from=backend /admin /app/admin
USER admin
EXPOSE 3211
ENV PORT=3211
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD ["/app/admin", "healthcheck"]
ENTRYPOINT ["/app/admin"]
