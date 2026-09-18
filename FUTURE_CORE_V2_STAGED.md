# UNBOUND AI — Future Core v2 (STAGED, NOT LAUNCHED)

Status: CODED ON A STAGING BRANCH. DO NOT LAUNCH UNTIL EXPLICITLY REQUESTED.

Branch: `feature/future-core-v2-staged`
Launch flag: `UNBOUND_FUTURE_CORE_V2_ENABLED=true`
Default when unset: OFF / route returns 404.

## What is coded

- Deterministic intent classification and task planning.
- Specialist registry: Coordinator, Researcher, Analyst, Builder, Reviewer, Action Planner.
- Tool registry with read/write metadata and fail-closed availability.
- Resumable serializable job state.
- Database-backed job snapshots in `future_core_jobs`.
- Parallel-wave scheduling bounded by a per-job concurrency budget.
- Model-call, web-call, and estimated-cost budgets.
- Explicit human approval checkpoint for external or irreversible actions.
- Default model task executor with automatic Fast/Deep/Research model routing.
- Web research support for research subtasks.
- API for plan/create/list/get/run/approve/cancel/delete.
- Regression contract covering planning, persistence shape, resumability, budgets, approval gates, and server integration.

## Important safety/launch behavior

External actions remain FAIL-CLOSED. The default executor will not send, submit, buy, pay, book, apply, delete, publish, deploy, transfer, or otherwise perform an irreversible action. Even after user approval, a dedicated production action executor must be connected before those actions can run.

The feature is also protected by the existing signed-in + `agents` entitlement gate and the separate Future Core v2 environment launch flag.

## Launch sequence later

When Boyd explicitly says to launch Future Core v2:

1. Rebase/refresh this branch against current `main`.
2. Run full Production CI and database recovery CI.
3. Review any schema/integration conflicts caused by work added after staging.
4. Decide the commercial tier for Future Core v2 before enabling it. The staged code currently reuses the existing `agents` entitlement gate.
5. Merge the staged PR only after CI is green.
6. Set `UNBOUND_FUTURE_CORE_V2_ENABLED=true` on the production app.
7. Verify Render deploy is live on the exact merge commit.
8. Smoke-test:
   - `GET /api/future-core-v2/status`
   - create a harmless analysis job
   - run/resume the job
   - verify a simulated external-action job stops at the approval checkpoint
   - verify no external action runs without a dedicated executor
9. Keep the flag OFF if any launch check fails.

## Do not confuse staged with live

This file is the launch handoff. Creating or updating this file does not mean Future Core v2 is live.
