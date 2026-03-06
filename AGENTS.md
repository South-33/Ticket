## Project Summary

An AI-powered travel & ticket search agent that acts like a conversational assistant: collect user details (dates, origin, nationality, preferences, loyalty/points), run a curated deep-research pipeline across flights, trains, and ticket sources, and return prioritized options (e.g., cheapest, best value, most convenient) with actionable next steps. Persist useful user preferences as memory to improve future recommendations.

# Agent Notes

## Notes
- Keep `architecture-plan.md` as the implementation source of truth.
- Keep `tools.md` and `system-prompt.md` synced whenever tool contracts or prompt contracts change.
- For any behavior change, add/update tests and run relevant test suites (plus lint) before handoff.
- Reference implementation is local at `C:\Users\Venom\Documents\CODE\.vscode\Project\gpt-researcher`.
- Playbooks are authored in `playbooks/*.md` and synced into Convex `playbooks`; use `pnpm convex:dev` so markdown edits auto-sync.
- `playbooks/flights.md` has an explicit `Experimental (Unproven) Tactics` section; keep those labeled `experimental` and revalidate before presenting as reliable.
- `flights_grey_tactics` consent defaults to thread scope; only persist beyond a thread on explicit user request.
- Chat only starts research when model emits valid `ResearchOps.start` (required criteria + at least one selected skill).
- Tool-only turns are allowed; runtime auto-continues same turn to fetch a direct user-facing reply.
- Retry uses `api.chat.retryPrompt` (latest user prompt only) and `generateReplyInternal` drops same-turn `existingResponses` during regeneration to avoid continuation-style outputs.
- Latest-turn UI should be derived from `buildLatestTurnSnapshot` (persisted variants + transient stream split) to prevent retry/nav empty-state regressions.
- CI quirk: placeholder Clerk publishable keys (e.g. `pk_test_ci_placeholder`) can break Next.js prerender for auth-wrapped layouts.
- Memory snapshots are deduped by markdown and capped to latest 40 per user.
- Research pipeline contracts/types now live in `convex/researchContracts.ts`, `convex/researchTypes.ts`, `convex/researchEvidence.ts`, and `convex/researchSynthesis.ts`; keep `convex/research.ts` orchestration-focused to avoid type/schema drift.
- Styling is split by concern via `src/app/globals.css` imports (`styles/base.css`, `styles/chat.css`, `styles/knowledge-admin.css`, `styles/clerk.css`); keep chat/admin/clerk edits in those files instead of re-growing one monolithic stylesheet, and avoid over-fragmenting beyond this set unless a file becomes genuinely hard to navigate.
- Streaming markdown in chat/reasoning should go through `src/components/markdown-renderer.tsx`; avoid CSS rules that flatten streamed block elements (`ul/ol/pre`) to inline or list markers disappear until streaming ends.
- Chat scroll uses a feed-end anchor (`IntersectionObserver`) plus Lenis follow calls; keep one scroll authority and block non-essential follow updates during thread-switch reveal transitions.

## Reference Docs
- Convex best practices: https://docs.convex.dev/understanding/best-practices
- Convex actions + scheduling: https://docs.convex.dev/functions/actions
- Convex indexes/query performance: https://docs.convex.dev/database/reading-data/indexes
- AI SDK tool calling: https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling
- Clerk UserProfile customization: https://clerk.com/docs/nextjs/guides/customizing-clerk/adding-items/user-profile
- GPT Researcher deep research flow: https://docs.gptr.dev/docs/gpt-researcher/gptr/deep_research

## Supplemental Reading (Non-Authoritative)
- Tool-calling optimization eval write-up: https://www.useparagon.com/learn/rag-best-practices-optimizing-tool-calling/
- SkillsBench paper (skills design benchmark): https://arxiv.org/html/2602.12670v1
- Use only for strategy/evaluation ideas, not API truth.
