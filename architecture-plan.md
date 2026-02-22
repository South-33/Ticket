# Architecture Plan

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
  - Move from demo `userId` to real auth-backed identity before Phase 1 completion
- Memory confirmation policy
  - Explicit confirmation required for sensitive facts
- Job retry policy
  - Max attempts, backoff curve, and terminal failure handling
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
