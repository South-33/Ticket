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

2. Add a server-only Gemini key to `.env.local`:

```bash
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
```

Optional research/ops env vars:

```bash
TAVILY_API_KEY=your_tavily_key
KNOWLEDGE_EDITOR_IDS=user_1,user_2
```

3. Start Convex in one terminal:

```bash
pnpm convex dev
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
