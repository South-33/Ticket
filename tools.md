# Tool Contract Map

This project uses a single-pass response contract where the model always returns user text and can optionally append only the tool tags it wants to execute.

## How many tools?

- Executable tool channels: **3**
  - `MemoryOps`
  - `ResearchOps`
  - `TitleOps`
- Non-executable fields: **3**
  - `Response` (required user-facing output)
  - `MemoryNote` (optional UI transparency note)
  - `ContractVersion` (optional compatibility tag)

## Envelope format

The model must output:

```text
<required plain response text>
<optional tool tags only when used>
```

Optional tagged output examples:

```xml
I found strong options for this route. I can start deep research now.
<ResearchOps>{"action":"start","domain":"flight","selectedSkills":["general","flights"],"criteria":[{"key":"origin","value":"MNL"},{"key":"destination","value":"FRA"},{"key":"departureDate","value":"2026-08-11"},{"key":"budget","value":"900"},{"key":"nationality","value":"Filipino"}]}</ResearchOps>
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
  - `convex/knowledge.ts` -> `getSkillPackBySlugsInternal` (pins selected skill hints for the run)
  - `convex/research.ts` -> `startResearchFromOpsInternal`

Validation status:

- Envelope JSON schema validation: **Yes**
- Repair loop on malformed output: **Yes** (up to 2 repair attempts)
- Semantic validation before apply: **Yes**
  - must include at least one selected skill
  - selected skill slugs must exist in active knowledge docs
  - required criteria must be complete for selected domain (missing can be satisfied by confirmed facts)
- Runtime hard check in research mutation: **Yes**
  - rejects empty selected skill list
  - deduplicates and normalizes selected skill slugs
  - snapshots skill hints/digest onto `researchJobs` for run-pinned planning

### 3) TitleOps

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
- Optional exact value when present: `2026-02-23.v1`
- Purpose: compatibility signaling when prompt/schema changes.

Validation status:

- Version mismatch detection when present: **Yes**
- Repair loop feedback on mismatch: **Yes**
- Validation telemetry persisted: **Yes** (`assistantEnvelopeValidationEvents`)

### Response

- Tag: `<Response>`
- Purpose: user-visible assistant reply.
- UI only renders this field (envelope tags are stripped).

### MemoryNote

- Tag: `<MemoryNote>`
- Purpose: short optional note shown in UI (e.g., "Memory updated: ...").
- Does not mutate memory.

## Where this is implemented

- Envelope parsing + validation + repair loop: `convex/chat.ts`
- Envelope validation telemetry logging: `convex/chat.ts`
- Memory operation application + safeguards: `convex/memory.ts`
- Memory op audit query + storage: `convex/memory.ts`
- Research op validation and start orchestration: `convex/chat.ts`
- Skill catalog + selected-skill resolution: `convex/knowledge.ts`
- Research start/resume + skill hint snapshot persistence: `convex/research.ts`
- Title apply validation and normalization: `convex/chat.ts`
- UI envelope stripping, memory note display, and memory activity list: `src/components/chat.tsx`
