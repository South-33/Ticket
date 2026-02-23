# Architecture Plan

This is a living source-of-truth document. Keep implementation status updated with checklist items so future conversations can resume without rediscovery.

## 1) Product Goal

Build a conversational travel and ticket research agent that:

- Understands user intent from natural language
- Persists user context across sessions (`user.md` concept)
- Uses deep research to discover non-obvious options, promos, and constraints
- Ranks options into clear decisions (`cheapest`, `best value`, `most convenient`)
- Supports multiple verticals (flights, trains, concerts) through curated knowledge

This plan is optimized for the current stack: Next.js + Convex + TypeScript + Gemini.

## 2) Core Artifacts

Use markdown as a human-facing layer, with Convex tables as source of truth.

- `skills.md` (global index)
  - General strategy playbook
  - References domain playbooks (`flights.md`, `train.md`, `concert.md`)
- `flights.md`, `train.md`, `concert.md` (global domain playbooks)
  - Curated tactics, heuristics, caveats, and source-backed tips
- `user.md` (per-user generated profile)
  - Persistent memory snapshot rendered from structured memory records

Why this approach:

- Markdown is easy to read/edit
- Structured storage is safer for concurrency, indexing, and validation
- No lock-in to fragile file writes in serverless environments

## 3) System Architecture

### 3.1 Frontend (Next.js)

- Chat UI
- Follow-up question UI for missing fields
- Live progress UI for deep research jobs
- Ranked results cards with evidence, timestamps, and caveats

### 3.2 Backend (Convex)

- Function API for chat, memory, jobs, and ranking
- Realtime state updates to clients
- Scheduler-based background orchestration
- Persistent memory and research artifacts

### 3.3 Tool Layer (Actions)

- Search providers (web search APIs)
- Source fetch + extraction
- Ticket data integrations (flight/train/concert APIs)
- Optional browser automation in a later phase

### 3.4 Knowledge Layer

- Curated playbook storage (`skills` + domain docs)
- Retrieval and injection into planning stage
- Confidence and expiration metadata per knowledge item

## 4) Request Lifecycle (Prompt -> Final)

1. User sends prompt
2. Intent and domain detection (`flight`, `train`, `concert`, or mixed)
3. Load `user` memory + relevant skills/domain snippets
4. Ask for missing required fields only
5. Build a normalized `ProjectGoal`
6. Planner decomposes into tasks (breadth/depth/concurrency controlled)
7. Executors run tasks in parallel and collect evidence
8. Synthesis builds normalized candidate options
9. Ranking computes `cheapest`, `best value`, `most convenient`
10. Verification pass rechecks top options for freshness
11. Final response with citations, confidence, caveats, and next actions
12. Memory update writes confirmed facts and safe inferences

## 5) Deep Research Strategy (Inspired by GPT Researcher)

Reference implementation path for local study:

- `C:\Users\Venom\Documents\CODE\.vscode\Project\gpt-researcher`

Use it as a pattern library for planner/executor/synthesis structure, not as a strict runtime dependency for this stack.

Adopt:

- Planner -> branch executors -> synthesizer
- Parallel branch execution with bounded concurrency
- Recursive summarization so context does not explode
- Citation-first outputs
- Partial failure tolerance (failed branch does not fail whole job)

Improve for this product:

- Add deterministic candidate builder for route/ticket options
- Add freshness verification before final rank
- Add memory confidence states (`proposed`, `confirmed`, `rejected`, `stale`)
- Inject domain playbooks (`flights.md`, etc.) into planning prompts

## 6) Convex Data Model (High-Level)

## 6.1 Core runtime tables

- `users`
- `conversations`
- `messages`
- `projectGoals`
- `researchJobs`
- `researchTasks`
- `sources`
- `findings`
- `candidates`
- `rankedResults`

## 6.2 Memory tables

- `userProfiles`
  - Stable profile fields (home city, default budget band, etc.)
- `userMemoryFacts`
  - Atomic facts with provenance and confidence
- `userMemorySnapshots`
  - Generated markdown snapshots (`user.md`) for display/debug

## 6.3 Knowledge tables

- `knowledgeDocs`
  - `skills`, `flights`, `train`, `concert`
- `knowledgeItems`
  - Individual tactics/heuristics with source and confidence
- `knowledgeLinks`
  - Cross-doc links (e.g., `skills` -> `flights`)

## 6.4 Essential indexes

- By user and recency (`by_user_updatedAt`)
- By job status and recency (`by_status_updatedAt`)
- By task job + status (`by_job_status`)
- By domain + priority for knowledge retrieval (`by_doc_priority`)

## 7) Memory Policy (Critical)

Persist memory, but guard correctness.

- Sensitive facts require explicit confirmation:
  - nationality/passport country
  - legal/visa assumptions
  - age (prefer age band over exact age)
- Track metadata per memory fact:
  - `sourceType` (`user_confirmed`, `inferred`, `imported`)
  - `confidence` (0-1)
  - `status` (`proposed`, `confirmed`, `rejected`, `stale`)
  - `updatedAt`
- Never silently overwrite high-confidence confirmed facts

## 8) Job State Machine

### 8.1 Research job states

`draft -> awaiting_input -> planned -> running -> synthesizing -> verifying -> completed`

Terminal states:

- `failed`
- `cancelled`
- `expired`

### 8.2 Research task states

`queued -> running -> completed`

Terminal states:

- `failed`
- `skipped`
- `timeout`

## 9) Convex Best-Practice Implementation Rules

Follow Convex docs patterns for production stability:

- Public API wrappers should be thin
- Put shared logic in helper modules
- Use validators for all public function args (and returns where practical)
- Use indexes over broad `.collect()` queries
- Use `internal` functions for scheduler and `ctx.run*` calls
- Use mutations for atomic intent capture, then schedule actions
- Make mutations idempotent where possible
- Avoid sequential `ctx.runQuery`/`ctx.runMutation` when one internal function can do both
- Always await all promises

## 10) Function Boundaries

- `query`
  - Read-only data fetch for UI and orchestration reads
- `mutation`
  - Atomic writes: user intent, state changes, memory updates
- `action`
  - External I/O (search/fetch/APIs), heavy processing
- `internalQuery/internalMutation/internalAction`
  - Background/private workflow steps only

Client pattern:

- Client calls mutation (`submitPrompt`)
- Mutation writes message/job, schedules internal action (`runResearchJob`)
- Action performs deep-research workflow and writes results via internal mutations

## 11) Ranking Framework

Default output groups:

- Cheapest
- Best Value
- Most Convenient

Scoring factors (weighted by domain):

- price
- total duration / transfer burden
- reliability/risk
- hidden fee risk
- source confidence
- freshness penalty

Every top result must include:

- source links
- observed/verified timestamp
- assumptions and caveats
- confidence tier

Implementation notes (current):

- Ranker uses weighted factor scoring by category (`cheapest`, `best_value`, `most_convenient`)
- Candidate/Ranked records persist freshness metadata (`verifiedAt`, `recheckAfter`)
- UI can trigger manual live recheck, which re-queues job + tasks and reruns pipeline
- Candidate metric defaults are now adjusted by extracted source evidence (price, duration, transfer cues, policy/baggage/booking signals)
- Knowledge curation now has authenticated admin surfaces for docs/items/links, maintenance to stale expired tactics, and markdown regeneration query output
- Optional editor allowlist via `KNOWLEDGE_EDITOR_IDS` controls knowledge write access when configured

Target direction (locked):

- Final candidate ranking should become LLM-led (domain + skill steered), with code-level guardrails for validation/recovery/safety.
- Deterministic weighted ranking remains as a temporary fallback path until LLM ranking verifier gates are complete.

## 12) Knowledge Curation Workflow

For `skills.md` and domain playbooks:

1. Ingest candidate tips from trusted and community sources
2. Extract and normalize heuristic candidates
3. Deduplicate and cluster
4. Attach evidence + confidence + expiry
5. Human review for activation
6. Publish to runtime knowledge tables
7. Regenerate markdown docs from active entries

Quality gate:

- No high-priority tactic without corroboration
- Expire or downgrade stale tactics automatically

## 13) Security and Privacy

- Collect minimum personal data needed for better results
- Separate sensitive facts from general preferences
- Keep audit logs for memory writes/overrides
- Ensure authorization on every public Convex function
- Do not trust client-provided identity fields for access control

## 14) Observability and Evaluation

Track:

- job latency by stage
- task error and timeout rates
- stale-result rate
- citation coverage
- user corrections to memory

Implementation notes (current):

- Job stage transitions are now persisted in `researchStageEvents` from internal job patching logic.
- Events include status/stage/progress/attempt/errorCode and can be queried via paginated `listStageEventsByJob`.
- Retry and terminal failure paths emit stage events, enabling operational debugging without scanning full job/task documents.
- `runJobInternal` now uses a per-job lease (`runLeaseToken`, `runLeaseExpiresAt`) to avoid duplicate concurrent runners.
- Retry scheduling now runs through `scheduleRetryInternal` (single mutation) so status/task updates and scheduling are atomic.
- Inferred intake writes no longer overwrite high-confidence confirmed sensitive memory facts.
- User-editable preference hints are stored separately from confirmed memory and passed to chat system prompts as untrusted, soft context only.
- Chat reply generation now uses a single-pass envelope (`<Response>`, `<MemoryOps>`, `<ResearchOps>`, `<TitleOps>`, `<MemoryNote>`) so one model call can return user reply plus structured memory/research/title updates.
- Thread title updates now come directly from the same single-pass model output with backend validation/repair rules (no cooldown/quality heuristic gate).
- Malformed envelope outputs now trigger an automatic repair loop (up to 2 retries) with explicit validation feedback before falling back to safe no-op memory/title ops.
- Envelope protocol validates optional `ContractVersion` (`2026-02-23.v1` when present) and logs validation attempts/errors to `assistantEnvelopeValidationEvents` for telemetry.
- Memory operation application now records per-op audits (`applied`/`skipped` + reason + confidence) in `memoryOpAuditEvents` and surfaces recent activity in account settings.
- Chat now injects a skill catalog (available skill slugs + general guidance) and the model decides whether to emit `ResearchOps.start`.
- `ResearchOps.start` is semantically validated before apply (required domain criteria + at least one valid selected skill slug).
- Research runs now persist pinned skill context on job creation/resume (`selectedSkillSlugs`, `skillHintsSnapshot`, `skillPackDigest`) so planning is stable for the run and does not drift with later knowledge edits.

Evaluate with fixed benchmark scenarios per domain:

- accuracy
- freshness
- latency
- cost
- actionability

## 15) Implementation Phases

### Phase 0: Foundation

- Finalize schema, indexes, and state machine
- Implement domain plugin interfaces
- Add logging and metrics events

### Phase 1: Memory + Intake

- Slot filling flow
- Structured memory store
- `user.md` snapshot generation
- Confirmation flow for sensitive facts

### Phase 2: Flight Domain MVP

- Planner + executors + synthesis for flights
- Ranking and freshness verification
- Citation-first response formatting

### Phase 3: Knowledge System

- `skills.md` + `flights.md` curation and retrieval injection
- Runtime use of curated heuristics in planning and ranking

### Phase 4: Multi-Domain Expansion

- Add train and concert plugins
- Share orchestration and scoring abstractions

### Phase 5: Hardening

- Retry/backoff/idempotency improvements
- Cost controls and rate limiting
- Regression evaluation suite

## 16) MVP Definition of Done

- User can submit natural request and complete guided slot-filling
- Memory persists correctly across sessions
- Deep research job executes asynchronously with realtime progress
- Top ranked options include evidence and freshness metadata
- `skills.md` and one domain playbook (`flights.md`) influence output
- Core metrics visible in dashboard/logs

## 17) Immediate Next Steps

1. Implement schema for memory/jobs/knowledge/candidates
2. Implement minimal function surface (`submitPrompt`, planner, executor, synthesizer)
3. Implement `skills` + `flights` knowledge retrieval in planner
4. Ship one end-to-end flight flow before adding train/concert

## 18) Convex Constraints and Reliability Rules

These are important implementation constraints from Convex docs and should be treated as requirements.

- Schedule background work from `mutation` when possible
  - Scheduling in a mutation is atomic with the write
  - This guarantees the job is queued if and only if the mutation succeeds
- Keep long pipelines step-based
  - Actions can run up to 10 minutes and are not automatically retried on transient failures
  - Break deep research into resumable scheduled steps, not one giant action
- Build explicit retries for action failures
  - Use retry metadata (`attempt`, `nextRunAt`, `lastError`) and scheduler backoff
  - Use idempotency keys to prevent duplicate side effects
- Assume scheduled function auth is not propagated
  - Pass explicit user identifiers and re-check authorization in called functions
- Prefer indexes over broad `.collect()`
  - Avoid unbounded reads for performance and conflict reduction
- Do not use `Date.now()` inside query logic for time-sensitive filtering
  - Use precomputed flags or pass coarse time buckets as args
- Use internal functions for all scheduler and `ctx.run*` calls
  - Keep public functions narrow and access-controlled

## 19) Decisions to Lock Before Coding

Locking these now prevents painful refactors later.

- Identity model
  - Completed: switched from demo `userId` to auth-backed identity via Clerk + Convex auth integration
  - Public Convex functions derive user identity from `ctx.auth.getUserIdentity()` and enforce ownership checks
  - Keep `userId` schema fields provider-agnostic (`string`) to simplify future auth-provider migration
- Memory confirmation policy
  - Explicit confirmation required for sensitive facts
- Job retry policy
  - `MAX_JOB_ATTEMPTS = 3`
  - Backoff curve: `30s -> 120s -> 300s`
  - Retryable error codes: `provider_rate_limited`, `provider_unavailable`, `unknown_error`
  - Terminal error codes: `provider_key_missing`, `task_missing`, `goal_missing`
  - Persist retry metadata on jobs/tasks: `attempt`, `nextRunAt`, `lastErrorCode` / `errorCode`
- Domain rollout order
  - Flights first, then trains, then concerts
- Cost and latency budgets
  - Define per-job limits by mode (`fast`, `balanced`, `deep`)

## 20) Bandwidth Guardrails (Prevent Client-Side Filtering/Sorting Pitfalls)

This directly addresses the prior issue where large datasets were sent to the client and filtered/sorted there.

Hard rules:

- Never fetch unbounded lists to sort/filter in React
- Every list query must accept server-side filter/sort args
- Use `.withIndex(...)` for filterable fields
- Use `.take(N)` or `.paginate(...)` for list responses (no unbounded `.collect()`)
- Add hard limits per endpoint (`MAX_THREADS`, `MAX_CANDIDATES`, etc.)
- Return only UI-needed fields for list pages (summary projection), not full documents
- Keep expensive joins/aggregation server-side and write denormalized summary fields when needed

Schema and query patterns:

- Design indexes around top product queries first
- Prefer compound indexes that match filter + sort order
- Avoid redundant indexes unless needed for different sort behavior

Tooling enforcement:

- Enable `@convex-dev/eslint-plugin`
- Enforce rules at minimum:
  - `@convex-dev/no-collect-in-query`
  - `@convex-dev/explicit-table-ids`
  - `@convex-dev/require-argument-validators`

Operational checks:

- Monitor Convex function health for high-bandwidth queries
- Add a review checklist item: "Could this query return 1000+ docs?"
- Add load tests for worst-case list endpoints before production rollout

## 21) Convex Hard Limits -> Design Budgets

Use these platform limits as architecture budgets, not afterthoughts.

Key Convex limits to design around:

- Transactions (each query/mutation)
  - Data read: 16 MiB
  - Data written: 16 MiB
  - Documents scanned: 32,000
  - Index ranges read (`db.get` + `db.query` calls): 4,096
- Actions
  - Max execution time: 10 minutes
  - Memory: 64 MiB (Convex runtime), 512 MiB (Node runtime)
  - Concurrent I/O operations per function: 1000
- Scheduling
  - A single mutation can schedule up to 1000 functions
  - Total scheduled-argument size per mutation: 16 MiB
- Data shape
  - Document size: 1 MiB
  - Max fields per document: 1024

Architecture implications:

- Do not store huge raw crawl blobs in one document; chunk or summarize before write
- Keep `sources`/`findings` compact and derive display projections server-side
- Prefer more small tasks over one giant action for deep research
- Keep task payloads tiny; pass IDs instead of full objects when scheduling

## 22) Error Handling and Recovery Strategy

Follow Convex error-handling model explicitly.

- Expected domain failures
  - Throw `ConvexError` with structured error payloads (`code`, `message`, optional metadata)
- Query failures
  - Handle with React error boundaries for stable UI fallbacks
- Mutation failures
  - Handle promise rejection in client and render actionable retry UI
- Action failures
  - Not auto-retried by Convex due to side effects; implement retry policy in workflow state
- Production behavior
  - Server errors are redacted to clients; rely on deployment logs + request IDs for debugging

Reliability pattern for external calls:

- Before external call: mark task `running`
- After successful call: write idempotent result and mark `completed`
- On transient failure: increment `attempt`, schedule retry with backoff
- On terminal failure: mark `failed` with normalized reason

## 23) Pagination Contract for All List Endpoints

Every potentially growing list endpoint must be paginated from day one.

- Required args
  - `paginationOpts` (`numItems`, `cursor`) using Convex pagination validator
  - Optional server-side filter/sort arguments
- Required response
  - `page`, `continueCursor`, `isDone` (or Convex equivalent)
- Client behavior
  - Use incremental loading (`loadMore`) and never request "all records"

Default page-size policy:

- UI lists: 20-50 items per page
- Admin/debug lists: 50-100 items per page (explicitly gated)
- Hard cap max page size in function validator logic

## 24) Non-Obvious Convex Gotchas (Surprising but Important)

- Scheduling from `mutation` is atomic; scheduling from `action` is not
  - An action can schedule work and then fail; scheduled work still runs
- Scheduled function auth is not propagated
  - Pass explicit user context and re-check authorization in the called function
- Actions are not auto-retried by Convex
  - You must build retry/backoff logic yourself for transient external failures
- Query retries with same args are pointless
  - Convex queries are deterministic; same inputs produce the same error/result
- `Date.now()` in queries causes stale/caching issues
  - Use precomputed fields or coarse time args instead
- `.filter(...)` on database queries still scans documents
  - Filtered-out docs still count toward scan/read limits and bandwidth
- Multiple sequential `ctx.runQuery` / `ctx.runMutation` in actions are not one transaction
  - Consolidate related reads/writes into one internal function for consistency
- `ctx.db.get/patch/replace/delete` should include explicit table name
  - This is a forward-compat and safety requirement (lint-enforce it)
- Paginated pages are reactive and may grow/shrink between fetches
  - Client UI must tolerate item count shifts as live data changes

## 25) LLM-Led Research Pipeline Plan and Status (Authoritative)

When this section conflicts with older sections, this section wins.

### 25.1 Locked product decisions

- [x] Research start is model-driven: jobs start/resume only from valid `ResearchOps.start`.
- [x] Domain and selected skills steer runs; runs pin selected skill guidance snapshot for stability.
- [x] Researcher and chatbot are distinct actors (chatbot mediates all user interaction).
- [x] User sees runtime trace in an expandable panel/pop-up style UI (with key milestones in chat).
- [x] Clarification batching is allowed and should stay concise (max 3 fields per ask).
- [x] Target quality model is LLM-led end-to-end (planning, analysis, synthesis, ranking), with code as guardrails.
- [x] Chat output contract is response-first with optional tool tags; model should emit only tools it intends to run.
- [x] Research should iterate in checkpointed rounds with quality-gated continuation, not full restarts by default.
- [x] Working LLM context should be selective and compact; raw retrieval is stored but only promoted evidence is carried forward.

### 25.2 Current status snapshot

- [x] Single-pass chat envelope supports `Response`, `MemoryOps`, `ResearchOps`, `TitleOps`, `MemoryNote`.
- [x] Chat validation supports optional tool tags (missing tool tags default to no-op behavior).
- [x] `sendPrompt` no longer performs heuristic research start/resume.
- [x] `ResearchOps.start` semantic validation exists (required criteria + at least one valid skill).
- [x] Skill catalog + selected-skill resolution exists; run-pinned snapshots persist on jobs (`selectedSkillSlugs`, `skillHintsSnapshot`, `skillPackDigest`).
- [x] Job reliability controls exist (lease lock, retries, stage events, retry scheduling).
- [x] Memory safeguards and audit trails exist.
- [x] Scan stage now has deterministic quality assessment with selective source promotion and one targeted continuation round (`continue` vs `finalize`).
- [x] Backend dialogue event bus is scaffolded (`researchDialogueEvents`) with actor/kind metadata and paginated query API.
- [x] Clarification request lifecycle primitives exist (`requestUserClarificationInternal`, `submitClarificationAnswerInternal`, pending request query) with persisted request/answer records.
- [x] Chat now consumes pending clarification requests, accepts user answers, and re-queues research automatically.
- [x] Flight scan now quality-gates into clarification when numeric fare evidence remains thin and `flexibilityLevel` is missing.
- [ ] LLM planner/executor/synthesizer runtime is not complete yet (current execution is still largely deterministic retrieval/scoring).
- [ ] LLM-led final ranking is not complete yet (deterministic ranker still active primary path).
- [ ] Researcher-to-chatbot clarification tooling and pause/resume handshake is not complete yet.
- [ ] User-visible actor-level trace (researcher <-> chatbot conversation timeline) is not complete yet.

### 25.3 Target runtime flow (end state)

1. User sends prompt.
2. Chat model responds with envelope + optional `ResearchOps.start`.
3. Backend validates schema/semantics; if valid, create/resume research job.
4. Research planner LLM generates branch plan (subqueries/objectives/checks) using domain + skills + criteria + memory.
5. Retrieval/extraction runs in parallel for branches with bounded concurrency.
6. Branch analyst LLM produces evidence-grounded findings with source-linked citations.
7. If blocking unknowns are found, researcher calls clarification tool; job pauses `awaiting_input`.
8. Chatbot asks user concise batched clarification question(s); user replies; answer is normalized/validated.
9. Research auto-resumes from checkpoint with clarified inputs.
10. Synthesizer LLM produces normalized options and rationale.
11. Ranking LLM selects/prioritizes `cheapest`, `best value`, `most convenient` with constraints/caveats.
12. Verifier guardrails enforce citation integrity, freshness, and safety before final response.
13. Quality assessor decides one of three outcomes: finalize, request clarification, or continue another targeted round.
14. Continuation round uses delta-planning on unresolved gaps and promoted evidence only (no full reset unless explicit recovery path is triggered).
15. Loop exits with explicit termination reason (`quality_met`, `needs_user_input`, `budget_limit`, `diminishing_returns`, `failed`).

### 25.3.1 Iteration and context budget rules

- Store full raw search/extraction artifacts in runtime tables for traceability.
- Promote only high-signal evidence into branch working context (relevance, freshness, novelty, citation quality).
- Build compact branch summaries first, then promote only resolved key points + unresolved gaps to global synthesis context.
- Prefer selective context promotion over token-heavy transcript stuffing.
- On continuation rounds, search only for missing/weakly-supported claims instead of repeating broad queries.

### 25.4 Implementation checklist (build order)

#### A) Contracts and schemas

- [ ] Add stage schemas for planner output, branch findings, synthesis output, and ranking output.
- [ ] Add strict semantic validators for each stage output.
- [ ] Add bounded repair loops per stage (with structured feedback).

#### B) Dual-actor dialogue bus

- [x] Add `researchDialogueEvents` (or equivalent) with actor/type/payload schema.
- [x] Persist actor events for `researcher`, `chatbot`, `system`, `user`.
- [x] Expose paginated query API for UI timeline.

#### C) Clarification tool (HITL)

- [x] Add `requestUserClarificationInternal` mutation with batched fields (`<= 3`).
- [x] Add clarification request storage with status lifecycle (`pending`, `answered`, `expired`, `cancelled`).
- [x] Add answer ingestion + normalization + validation path from chatbot user replies.
- [x] Auto-resume paused jobs after valid clarification answers.

#### D) LLM research runtime

- [ ] Implement planner stage action using selected skills + domain adapters.
- [ ] Implement branch analyzer stage with citation-bound findings.
- [ ] Implement synthesizer stage to produce normalized candidate set.
- [ ] Implement LLM ranking stage (domain/skill aware) for final prioritization.
- [ ] Implement quality assessor stage with explicit continue/clarify/finalize decision output.
- [ ] Keep deterministic ranker as fallback until verifier gates are stable.

#### E) Guardrails and verification

- [ ] Enforce claim-to-citation integrity (all claims map to collected source IDs).
- [ ] Enforce required-criteria completeness before synthesis/finalization.
- [ ] Add contradiction/uncertainty checks and downgrade or pause when confidence is low.
- [ ] Add context budgeter and evidence promotion rules for each stage handoff.
- [ ] Keep retry/lease/idempotency protections for all new stages.

#### F) UX and observability

- [ ] Render expandable research trace panel showing actor timeline and stage transitions.
- [ ] Surface clarification pauses clearly with required fields and resume status.
- [ ] Add stage metrics: latency, retries, branch success rate, citation coverage, and cost.
- [ ] Add downloadable/debuggable trace suitable for regression triage.

#### G) Rollout and quality gates

- [ ] Add benchmark scenarios per domain and skill mix (accuracy/freshness/actionability/cost/latency).
- [ ] Add regression tests for pause/resume clarification loop and envelope-stage repair behavior.
- [ ] Add fixed pass/fail thresholds (citation coverage, contradiction rate, clarification completion, latency/cost budgets).
- [ ] Ship behind feature flag (`llm_research_pipeline_v1`) with safe fallback path.
- [ ] Promote to default only after quality gates pass on benchmark suite.

## 26) Community Signal PR Loop for Flights (Living Knowledge)

Goal:

- Keep flight intelligence continuously updated from real user-run discoveries (promos, channel-only discounts, booking quirks) without polluting verified core tactics.
- Model this as an internal PR workflow with automated triage, validation, and promotion/demotion.

### 26.1 Scope and source of truth

- Runtime source of truth remains Convex knowledge tables.
- `playbooks/flights.md` remains the canonical playbook scaffold and is regenerated/published from active curated entries.
- Do not directly trust one-off findings from a single run; all findings enter the PR loop first.

### 26.2 New data model additions

- `knowledgeProposals`
  - Candidate findings submitted by research runs or admins.
  - Example types: promo code, fare-rule quirk, channel-specific discount, route-level anomaly.
- `knowledgeProposalEvents`
  - Evidence events attached to a proposal (confirm/fail/expired/abuse/no-longer-working).
- `knowledgeProposalReviews`
  - Reviewer decisions (agent or human) with rationale and confidence.
- `knowledgeProposalUsage`
  - Runtime attempts and outcomes when a proposal is surfaced to users.

Recommended key fields:

- `domain`, `tacticKey`, `title`, `description`, `carrier`, `region`, `routeScope`
- `evidenceTier` (`verified|mixed|experimental`)
- `riskClass` (`safe_compliant|grey_common|high_risk_contract`)
- `status` (see lifecycle below)
- `firstSeenAt`, `lastValidatedAt`, `expiresAt`
- `maxUses`, `remainingUses` (for limited promo inventory when known)
- `sourceRefs` (internal source IDs, optional external links)

### 26.3 Proposal lifecycle (PR-style)

`proposed -> triaged -> testing -> active_temp -> promoted_verified | rejected | expired | invalidated`

Rules:

- New findings start as `proposed` and default to `experimental`.
- `active_temp` means visible to runtime as temporary intelligence with explicit caveats.
- `promoted_verified` requires repeated positive validation and conflict checks.
- Any repeated failure reports or hard expiry trigger `invalidated`/`expired` and removal from active injection.

### 26.4 Reviewer agent responsibilities

- Triage incoming proposals for duplicates, obvious spam, and policy risk.
- Request/trigger validation runs for high-impact proposals.
- Approve promotion, demotion, expiry, or rejection with explicit rationale.
- Keep temporary findings in a bounded queue; prune stale/low-signal items automatically.

### 26.5 Runtime injection contract

- Inject temporary findings into research context as a separate block (for example, `temporary_flight_signals`).
- Temporary findings must always be labeled `experimental` unless promoted.
- Temporary findings can expand search, but cannot outrank verified options without route-level revalidation in the current run.
- If temporary and verified guidance conflict, verified guidance wins by default.

### 26.6 Auto-promotion and auto-demotion policy

Promotion candidates:

- Minimum independent confirmations (configurable) across runs/sessions.
- Recent validation freshness window satisfied.
- No unresolved policy/safety conflicts.

Demotion triggers:

- Consecutive failed attempts above threshold.
- Explicit user-run invalidation reports.
- Expired validity window or exhausted promo uses.

### 26.7 GitHub mirror (optional)

- Internal proposal tables are the operational truth.
- Optional GitHub PR mirror can publish high-signal changes for auditability and manual review.
- Avoid mirroring every low-signal event to prevent noisy PR churn.

### 26.8 Implementation checklist

- [ ] Add Convex tables/indexes for proposals, events, reviews, usage.
- [ ] Add `KnowledgeProposalOps` internal functions (`submit`, `triage`, `review`, `promote`, `demote`, `expire`).
- [ ] Add reviewer agent job that processes proposal queues on schedule.
- [ ] Add runtime injection path for `active_temp` signals into planning context.
- [ ] Add stale cleanup job and usage-based invalidation.
- [ ] Add admin UI for proposal queue and review actions.
- [ ] Add metrics dashboard (proposal volume, promotion rate, invalidation rate, savings impact).
