# Aura Chat (Next.js + Convex + Gemini)

Production-style chat scaffold using:

- Next.js 16 App Router + TypeScript + Tailwind
- Convex backend + `@convex-dev/agent` threads/messages/streaming deltas
- Gemini via `@ai-sdk/google` (`gemini-2.5-flash-lite`)
- Async generation flow (mutation -> scheduler -> internal action)

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Add runtime keys to `.env.local`:

```bash
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
TAVILY_API_KEY=your_tavily_key
LLM_RESEARCH_PIPELINE_V1=1
```

Optional research/ops env vars:

```bash
KNOWLEDGE_EDITOR_IDS=user_1,user_2
```

3. Start Convex in one terminal:

```bash
pnpm convex:dev
```

4. Start Next.js in another terminal:

```bash
pnpm dev
```

5. Open `http://localhost:3000`.

## How messaging works

- `sendPrompt` mutation saves the user prompt immediately and schedules an internal action.
- `generateReplyInternal` continues the same thread and streams assistant output with `saveStreamDeltas`.
- UI reads with `useUIMessages(..., { stream: true })`, so reconnects remain resilient through Convex reactivity.

## Key files

- Frontend shell + sidebar/history: `src/components/chat.tsx`
- Canvas ASCII background: `src/components/chat-canvas.tsx`
- Convex agent config: `convex/agent.ts`
- Convex chat functions: `convex/chat.ts`
- Convex component wiring: `convex/convex.config.ts`

## Real-World Flight Testing Runbook

Use this phase only for `flights`, on `local/dev`, with a `dedicated test account`.

### Readiness checklist

Run these before any live batch:

```bash
pnpm test:once
pnpm lint
pnpm convex:dev
pnpm dev
```

Readiness rules:

- Use one dedicated Clerk/test user for all live-flight runs.
- Start one fresh chat thread per prompt so each run is attributable and replayable.
- Keep `GOOGLE_GENERATIVE_AI_API_KEY`, `TAVILY_API_KEY`, and `LLM_RESEARCH_PIPELINE_V1=1` enabled for normal runs.
- Run at least one manual `Recheck Live Data` after a completed job to confirm the recheck path works.
- If you intentionally remove a provider key for a degraded-path check, restore it before the main batch.

### First prompt pack

Use the exact same prompt text in this app and ChatGPT Deep Research.

1. `Find me the cheapest one-way flight from Manila to Tokyo on 2026-09-12. Budget is 220 USD. I am Filipino.`
2. `Find me the best value round-trip flight from Bangkok to Seoul departing 2026-10-07 and returning 2026-10-14. Budget is 420 USD. I am Thai.`
3. `I need a nonstop flight from Singapore to Bali on 2026-08-19. Budget 180 USD. I am Singaporean.`
4. `Find me a flight from Manila to Sydney on 2026-11-03 with 1 checked bag included. Budget 550 USD. I am Filipino.`
5. `Need the best value premium economy flight from Los Angeles to New York on 2026-09-18. Budget 650 USD. I am American.`
6. `Find me a business class flight from Bangkok to Tokyo on 2026-12-05. Budget 1400 USD. I am Thai.`
7. `Find flights for 2 passengers from Manila to Hong Kong on 2026-08-28. Budget 320 USD total. I am Filipino.`
8. `Find the best flight from Jakarta to Osaka around 2026-10-10. My dates are flexible by about 3 days. Budget 350 USD. I am Indonesian.`
9. `Find me the cheapest flight from Ho Chi Minh City to Paris on 2026-12-18. Dates are strict. Budget 700 USD. I am Vietnamese.`
10. `Find me a round-trip flight from Manila to Dubai departing 2026-09-02 and returning 2026-09-09 for 2 passengers with carry-on only. Budget 900 USD total. I am Filipino.`
11. `I need the best value flight from Bangkok to London on 2026-11-21 with as few transfers as possible and one checked bag. Budget 850 USD. I am Thai.`
12. `Find me a flight from Kuala Lumpur to Barcelona on 2026-10-02. I prefer premium economy, but only if it is a strong value over economy. Budget 900 USD. I am Malaysian.`

### Comparison protocol

- Run both systems in the same day/time window.
- Do not rewrite prompts mid-run.
- Let each system ask clarifying questions if it needs to.
- Capture whether fallback paths were used in this app from the research status panel.

Record for each prompt:

- time to first useful answer
- time to final answer
- whether clarification was needed
- top options returned
- cheapest credible option found
- best-value option found
- baggage/cabin/nonstop correctness
- citation quality and freshness
- obvious hallucinations, stale links, or unsupported claims
- whether planner, search, or ranking fell back

### Iteration loop

- Run `5` prompts.
- Cluster failures by intake, search, extraction, synthesis/ranking, verification, or UI visibility.
- Fix the single highest-leverage issue.
- Rerun affected prompts plus `2-3` regression prompts before widening scope.
