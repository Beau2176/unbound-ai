# UNBOUND AI infrastructure baseline — September 14, 2026

This is a read-only planning snapshot from the connected Render workspace. It does not change any plan, create any paid resource, or certify launch capacity.

## Current resources

### `unbound-ai-app`

- Render web service
- branch: `main`
- region: Ohio
- plan: Free
- auto-deploy: enabled
- platform health-check path: not configured
- application health endpoint exists at `/healthz`

Observed approximately over the most recent one-hour Render metrics window during this review:

- CPU was generally below `0.001` CPU core, with one observed spike around `0.0114` core.
- memory was generally around 81–82 MB before a short rise to about 120.6 MB, then settled around 93.5 MB near the end of the window.
- Render returned no usable HTTP request-count or HTTP-latency series for this window.
- reported bandwidth for the sampled hour was roughly 0.26 MB.

Interpretation: the service is presently lightly loaded. This snapshot is **not** evidence that the smallest production plan will be sufficient for a public launch, because there is not enough representative user traffic or concurrency in this sample.

### `unbound-browser-worker`

- Render web service
- branch: `main`
- region: Ohio
- plan: Free
- auto-deploy: enabled
- platform health-check path: not configured

The Render metrics query returned no CPU, memory, or instance-count series for this worker during the sampled window. Do not infer zero resource need from missing telemetry. Before paying for a production worker size, exercise representative browser-worker jobs and capture real telemetry.

### `unbound-ai-db`

- Render PostgreSQL
- PostgreSQL major version: 18
- plan: Free
- current Free database expiration: **October 11, 2026**

Observed approximately over the most recent one-hour Render metrics window during this review:

- CPU ranged roughly from `0.0025` to `0.0083` CPU core.
- memory was typically around 45–54 MB, with an observed peak around 60.1 MB.
- active connections were almost always 1, with brief observed peaks of 2 and 3.

Interpretation: current database load is very low. The current Free database is nevertheless **not acceptable launch storage** because it is expiring and does not satisfy the durable-production/recovery requirements.

## Zero-cost work completed from this baseline

- verified the live plan/region/branch state without changing it;
- verified that both web-service platform health-check paths are currently unset;
- verified PostgreSQL 18 and the Free-database expiration date;
- captured a current app CPU/memory/bandwidth sample;
- captured a current database CPU/memory/connection sample;
- confirmed the browser worker needs deliberate exercised-load telemetry before sizing;
- documented that current load is too small to justify a confident production-capacity decision.

## Before spending money

Use the Free environment to create a repeatable representative-load sample that includes, as safely available:

1. normal Casual chat;
2. Work/Research requests;
3. concurrent account/session/database reads and writes;
4. file/image operations using safe test inputs;
5. browser-worker jobs if that worker is part of the production launch path;
6. health/readiness polling;
7. expected background/admin activity.

Record CPU, memory, p95 latency, request/error counts, database connections, and any provider-bound concurrency. Do not manufacture paid API usage merely for this test; use mocked/local/provider-free paths where available until a real launch test budget is approved.

## Paid migration stop point

When funding is approved, choose always-on web/worker capacity and durable PostgreSQL based on:

- this baseline;
- representative-load results;
- provider concurrency/rate limits;
- headroom for launch bursts;
- database storage/growth estimates;
- backup/restore requirements;
- acceptable restart/deploy behavior.

Then configure the platform health check (currently intended to be `/healthz`), verify successful probes, complete the real backup/restore drill, and only afterward set the `UNBOUND_INFRA_*` production-readiness attestations.

The entry-level paid price is a cost floor, not a capacity recommendation.
