## Project Summary

An AI-powered travel & ticket search agent that acts like a conversational assistant: collect user details (dates, origin, nationality, preferences, loyalty/points), run a curated deep-research pipeline across flights, trains, and ticket sources, and return prioritized options (e.g., cheapest, best value, most convenient) with actionable next steps. Persist useful user preferences as memory to improve future recommendations.

# Agent Notes

## Notes
- Build and ship in small, verified slices; every new capability must keep existing flows stable before expanding scope.
- Reference implementation is available locally at `C:\Users\Venom\Documents\CODE\.vscode\Project\gpt-researcher`; consult it for planner/executor/synthesis patterns before reinventing pipeline internals.
- Keep `architecture-plan.md` as the implementation source of truth and update it when architecture decisions or constraints change.
- Keep `tools.md` up to date whenever tool contracts/channels/schema change (add/remove/rename tools, validation loops, or apply behavior), so new agents can immediately see the current tool map.
- Keep `system-prompt.md` up to date whenever any system prompt is added/removed/modified (location, trigger, input context, or output contract), so prompt behavior remains auditable.
- Canonical playbook markdown scaffolds live under `playbooks/` (`general.md`, `flights.md`, `flights_grey_tactics.md`, `train.md`, `concert.md`); curate there first, then publish active items into Convex knowledge docs for runtime injection.
- `playbooks/flights.md` includes an explicit `Experimental (Unproven) Tactics` section; these tactics are for search expansion only and should always be labeled `experimental` (never presented as reliable without route-level revalidation).
- Product direction now includes a PR-style community signal loop for flight knowledge (proposal -> testing -> temporary active -> promoted/invalidated/expired) so volatile finds can be injected quickly without contaminating verified core tactics.
- Grey-tactics consent default scope is thread-level; only persist beyond a thread when the user explicitly asks to remember that preference.
- Chat intake (`sendPrompt`) no longer starts/resumes research heuristically; research jobs now start only when `generateReplyInternal` emits valid `ResearchOps.start` with required criteria and at least one selected skill.
- Product direction: researcher and chatbot are distinct actors; researcher can request user clarifications mid-run, chatbot mediates user interaction, and the user-facing UI should expose this runtime trace clearly (expandable panel/pop-up style is preferred).
- Product direction: research quality should be LLM-led end-to-end (planning, analysis, synthesis, and ranking), while code-level logic primarily enforces safety guardrails, validation loops, and recovery behavior.
- Chat model output contract: response text is preferred, but tool-only output is allowed when the model needs to load/refresh context first; runtime auto-continues in the same turn to collect direct user-facing text.
- Context trimming policy: keep metric-gated; do not add aggressive trimming heuristics by default. Only tighten context budgets after observed quality/latency degradation in telemetry.
- Research loop direction: use iterative, checkpointed rounds with quality-gated continuation (no full restart by default) and selective context promotion from raw sources.
- CI/preview quirk: avoid placeholder Clerk publishable keys (for example `pk_test_ci_placeholder`) because Next.js prerender can fail in auth-wrapped layouts; treat invalid/placeholder keys as unconfigured.
- Clarification plumbing is in place (`requestUserClarificationInternal`, `submitClarificationAnswerInternal`, pending-request query), and chat now handles pending clarification answers then re-queues research automatically.
- Current flight runtime behavior: if scan quality remains weak on numeric fare evidence and `flexibilityLevel` is missing (with core route/date present), research can pause and request a date-flexibility clarification before synthesis.
- Planner runtime now includes an LLM planner contract with schema validation + repair attempts; if model output is invalid/unavailable, the pipeline falls back to a deterministic planner strategy instead of failing the run.
- Ranking runtime now attempts LLM-based category prioritization with schema validation/repair; it falls back to deterministic scoring when model output is unavailable/invalid.

## Reference Docs
- Convex best practices: https://docs.convex.dev/understanding/best-practices
- Convex actions: https://docs.convex.dev/functions/actions
- Convex scheduled functions: https://docs.convex.dev/scheduling/scheduled-functions
- Convex indexes/query performance: https://docs.convex.dev/database/reading-data/indexes
- Convex query functions: https://docs.convex.dev/functions/query-functions
- AI SDK tool calling docs: https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling
- Clerk UserProfile customization (custom pages/tabs): https://clerk.com/docs/nextjs/guides/customizing-clerk/adding-items/user-profile
- GPT Researcher docs (official welcome): https://docs.gptr.dev/docs/welcome
- GPT Researcher architecture intro: https://docs.gptr.dev/docs/gpt-researcher/getting-started/introduction
- GPT Researcher deep research flow: https://docs.gptr.dev/docs/gpt-researcher/gptr/deep_research
- GPT Researcher logs/observability: https://docs.gptr.dev/docs/gpt-researcher/handling-logs/all-about-logs
- GPT Researcher retriever options: https://docs.gptr.dev/docs/gpt-researcher/search-engines/search-engines
- GPT Researcher tailored research/context controls: https://docs.gptr.dev/docs/gpt-researcher/context/tailored-research

## Supplemental Reading (Non-Authoritative)
- Advanced tool calling deep dive: https://sparkco.ai/blog/advanced-tool-calling-in-llm-agents-a-deep-dive
- Tool-calling optimization eval write-up: https://www.useparagon.com/learn/rag-best-practices-optimizing-tool-calling/
- SkillsBench paper (skills design benchmark): https://arxiv.org/html/2602.12670v1
- Use these for strategy ideas and evaluation heuristics, not API/SDK truth.
