# Tool Contract Map

This project uses a response-first contract with optional tool-only turns.

- Preferred path: model returns user text plus optional tool tags.
- Allowed path: model returns only tool tags when it needs to load/refresh context first; runtime then auto-continues in the same turn and requests a direct user-facing reply.

## How many tools?

- Executable tool channels: **4**
  - `MemoryOps`
  - `ResearchOps`
  - `SkillOps`
  - `TitleOps`
- Non-executable fields: **3**
  - `Response` (preferred user-facing output)
  - `MemoryNote` (optional UI transparency note)
  - `ContractVersion` (optional compatibility tag)

## Envelope format

The model outputs:

```text
<plain response text, preferred>
<optional tool tags only when used>
```

Tool-only output is valid when at least one tool tag is present.

Optional tagged output examples:

```xml
I found strong options for this route. I can start deep research now.
<ResearchOps>{"action":"start","domain":"flight","selectedSkills":["general","flights"],"criteria":[{"key":"origin","value":"MNL"},{"key":"destination","value":"FRA"},{"key":"departureDate","value":"2026-08-11"},{"key":"budget","value":"900"},{"key":"nationality","value":"Filipino"}]}</ResearchOps>
```

```xml
<SkillOps>{"action":"load","skills":["flights"],"ttlUserTurns":5}</SkillOps>
```

```xml
Got it — I saved your preference for nonstop flights.
<MemoryOps>[{"action":"add","store":"preference","key":"flightStops","value":"nonstop","confidence":0.93,"reason":"User preference"}]</MemoryOps>
<MemoryNote>Saved your nonstop preference.</MemoryNote>
```

## Tool details

### 1) MemoryOps

- Tag: `<MemoryOps>`
- JSON schema per op:
  - `action`: `add | update | delete | noop`
  - `store`: `fact | preference | profile`
  - `key`: string
  - `value?`: string
  - `confidence?`: number `0..1`
  - `reason?`: string
  - `sensitive?`: boolean
- Backend apply path: `convex/memory.ts` -> `applyMemoryOpsInternal`

Validation status:

- Envelope JSON schema validation: **Yes**
- Repair loop on malformed output: **Yes** (up to 2 repair attempts)
- Per-op audit trail persisted: **Yes** (`memoryOpAuditEvents`)
- Hard safety checks on apply: **Yes**
  - max ops per turn
  - key normalization
  - delete confidence thresholds
  - sensitive fact protections

### 2) ResearchOps

- Tag: `<ResearchOps>`
- JSON schema:
  - `{"action":"start","domain":"flight|train|concert|mixed|general","selectedSkills":["general","flights"],"criteria":[{"key":"origin","value":"MNL"}]}`
  - `{"action":"noop"}`
- Backend apply path:
  - `convex/chat.ts` -> validate + resolve selected skill slugs
  - `convex/playbooks.ts` -> `getSkillPackBySlugsInternal` (pins selected playbook context for the run)
  - `convex/research.ts` -> `startResearchFromOpsInternal`

Validation status:

- Envelope JSON schema validation: **Yes**
- Repair loop on malformed output: **Yes** (up to 2 repair attempts)
- Semantic validation before apply: **Yes**
  - must include at least one selected skill
  - selected skill slugs must exist in active playbooks
  - required criteria must be complete for selected domain (missing can be satisfied by confirmed facts)
- Runtime hard check in research mutation: **Yes**
  - rejects empty selected skill list
  - deduplicates and normalizes selected skill slugs
  - snapshots skill hints/digest onto `researchJobs` for run-pinned planning

### 3) SkillOps

- Tag: `<SkillOps>`
- JSON schema:
  - `{"action":"load","skills":["flights"],"ttlUserTurns":5}`
  - `{"action":"noop"}`
- Backend apply path:
  - `convex/chat.ts` -> semantic validation against active skill catalog
  - `convex/chat.ts` -> `applySkillOpsInternal` (thread-scoped pack load/refresh)
  - `convex/chat.ts` -> `getActiveThreadSkillPacksInternal` + counter injection in system prompt

Validation status:

- Envelope JSON schema validation: **Yes**
- Repair loop on malformed output: **Yes** (up to 2 repair attempts)
- Semantic validation before apply: **Yes**
  - selected skill slugs must exist in active playbooks
  - `general` is always-on and not loaded as a thread pack
- Runtime behavior:
  - thread-scoped active packs
  - default TTL `5` user turns (refreshable)
  - counters exposed in prompt (e.g., `flights: 2/5 turns remaining`)

### 4) TitleOps

- Tag: `<TitleOps>`
- JSON schema:
  - `{ "action": "rename", "title": "..." }`
  - `{ "action": "noop" }`
- Backend apply path: `convex/chat.ts` -> `setThreadTitleFromToolInternal`

Validation status:

- Envelope JSON schema validation: **Yes**
- Repair loop on malformed output: **Yes** (up to 2 repair attempts)
- Title validation/repair before apply: **Yes**
  - normalize + trim
  - non-empty, min chars, max words
  - simple reorder repair patterns (e.g. `Trip to X on Y` -> `X Trip for Y`)

## Non-tool fields

### ContractVersion

- Tag: `<ContractVersion>`
- Optional exact value when present: `2026-02-23.v2`
- Purpose: compatibility signaling when prompt/schema changes.

Validation status:

- Version mismatch detection when present: **Yes**
- Repair loop feedback on mismatch: **Yes**
- Validation telemetry persisted: **Yes** (`assistantEnvelopeValidationEvents`)

### Response

- Tag: `<Response>`
- Purpose: user-visible assistant reply.
- Preferred in the first pass.
- Tool-only first pass is allowed; runtime then auto-continues and requests direct text in the same turn.

### MemoryNote

- Tag: `<MemoryNote>`
- Purpose: short optional note shown in UI (e.g., "Assistant note: ...").
- Does not mutate memory.

## Where this is implemented

- Envelope parsing + validation + repair loop: `convex/chat.ts`
- Envelope validation telemetry logging: `convex/chat.ts`
- Memory operation application + safeguards: `convex/memory.ts`
- Memory op audit query + storage: `convex/memory.ts`
- Research op validation and start orchestration: `convex/chat.ts`
- Skill pack load/refresh + turn TTL state: `convex/chat.ts` (`threadSkillPacks`)
- Playbook catalog + selected-skill resolution: `convex/playbooks.ts`
- Research start/resume + skill hint snapshot persistence: `convex/research.ts`
- Title apply validation and normalization: `convex/chat.ts`
- UI envelope stripping, memory note display, and memory activity list: `src/components/chat.tsx`
