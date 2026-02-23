# Tool Contract Map

This project currently uses a single-pass tagged envelope from the model. In one response, the model returns user text plus structured operations.

## How many tools?

- Executable tool channels: **2**
  - `MemoryOps`
  - `TitleOps`
- Non-executable envelope fields: **2**
  - `Response` (user-facing output)
  - `MemoryNote` (UI transparency note)

## Envelope format

The model must output exactly:

```xml
<Response>...</Response>
<MemoryOps>[...]</MemoryOps>
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
- Hard safety checks on apply: **Yes**
  - max ops per turn
  - key normalization
  - delete confidence thresholds
  - sensitive fact protections

### 2) TitleOps

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
- Memory operation application + safeguards: `convex/memory.ts`
- Title apply validation and normalization: `convex/chat.ts`
- UI envelope stripping and memory note display: `src/components/chat.tsx`
