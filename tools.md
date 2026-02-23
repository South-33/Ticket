# Tool Contract Map

This project currently uses a single-pass tagged envelope from the model. In one response, the model returns user text plus structured operations.

## How many tools?

- Executable tool channels: **3**
  - `MemoryOps`
  - `ResearchOps`
  - `TitleOps`
- Non-executable envelope fields: **3**
  - `ContractVersion` (protocol gate)
  - `Response` (user-facing output)
  - `MemoryNote` (UI transparency note)

## Envelope format

The model must output exactly:

```xml
<ContractVersion>2026-02-23.v1</ContractVersion>
<Response>...</Response>
<MemoryOps>[...]</MemoryOps>
<ResearchOps>{"action":"noop"}</ResearchOps>
<TitleOps>{"action":"rename","title":"..."}</TitleOps>
<MemoryNote>...</MemoryNote>
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
  - `{"action":"start","domain":"flight|train|concert|mixed|general","selectedSkills":["skills","flights"],"criteria":[{"key":"origin","value":"MNL"}]}`
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
- Required exact value: `2026-02-23.v1`
- Purpose: enforce protocol compatibility when prompt/schema changes.

Validation status:

- Version mismatch detection: **Yes**
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
