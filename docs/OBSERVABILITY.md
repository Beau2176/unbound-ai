# UNBOUND AI Observability

UNBOUND AI uses privacy-minimized HTTP request telemetry for production troubleshooting.

## Request IDs

Every HTTP request receives a server-generated UUID in the `X-Request-ID` response header. The server does not trust or reuse a client-supplied request ID. This prevents user-controlled values from being injected into operational correlation identifiers.

## Structured request logs

For normal application traffic, the server writes one JSON log record after the response completes. The record contains only:

- event name (`http_request`)
- server-generated request ID
- HTTP method
- sanitized path
- HTTP status code
- response duration in milliseconds
- whether the connection aborted before completion
- timestamp

Health/readiness probes (`/healthz` and `/readyz`) are intentionally omitted from structured request logs to reduce noise.

## Privacy rules

The request logger does **not** record:

- request or response bodies
- query strings
- cookies
- authorization headers
- IP addresses
- user-agent strings
- email addresses or display names
- session/device/passkey tokens
- AI prompt or response content

Dynamic-looking path segments are normalized before logging. Numeric IDs, UUID-like values, and long opaque token-like path segments are replaced with placeholders such as `:id` or `:token`.

## In-process counters

The current server process keeps low-cardinality counters for:

- active requests
- completed requests
- 4xx responses
- 5xx responses
- aborted requests
- average response duration
- maximum response duration

These counters reset on every deploy or process restart. They are operational telemetry, not a durable analytics store.

## Administrator operations snapshot

Authenticated administrators can query:

`GET /api/admin/ops/status`

The endpoint combines:

- runtime/readiness state
- maintenance state
- database recovery-readiness declaration
- current-process HTTP telemetry

It does not expose request content or user identifiers.

## Incident use

When investigating a user-reported failure, use the `X-Request-ID` returned to the client to locate the corresponding structured request log. Do not ask users to send passwords, API keys, session cookies, recovery codes, or other secrets for troubleshooting.
