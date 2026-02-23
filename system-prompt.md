# System Prompt Map

This is the source-of-truth inventory for every system prompt used in runtime.

Update this file whenever any prompt text, prompt location, trigger condition, or output contract changes.

## Prompt Inventory

| Prompt ID | Location | Trigger | Purpose | Inputs | Output Contract |
|---|---|---|---|---|---|
| `chat.base_instructions` | `convex/agent.ts` (`BASE_CHAT_INSTRUCTIONS`) | Every chat model call via `chatAgent` | Defines baseline assistant persona and behavior (concise, verifiable, uncertainty-aware travel copilot) | none | Plain assistant text; detailed envelope rules come from `chat.main_system` |
| `chat.main_system` | `convex/chat.ts` (`buildSystemPrompt`) | `generateReplyInternal` before `thread.streamText` | Injects memory/profile context, skill catalog, required slots by domain, and tool-envelope policy for `MemoryOps` / `ResearchOps` / `TitleOps` | thread title, latest user prompt, UTC timestamp, profile, confirmed facts, preference hints, skill catalog + general hints | Response-first output with optional tool tags and schema-constrained JSON payloads |
| `chat.envelope_repair` | `convex/chat.ts` (`buildEnvelopeRepairInstruction`) | Chat envelope validation fails | Repairs malformed output while preserving user-facing response and optional tool tags | validation errors + previous malformed output + attempt number | Same as `chat.main_system`; must satisfy envelope validation |
| `chat.empty_text_retry` | `convex/chat.ts` (inline `system` override in retry path) | First model pass returns empty text | Forces a plain direct response without tool calls to avoid blank assistant turns | full main system prompt + retry instruction | Plain response text only (`toolChoice: none`) |
| `research.planner` | `convex/research.ts` (`buildPlannerPrompt`) | `runJobInternal` planning stage when LLM planner path is enabled | Produces a structured planner JSON (strategy, primary/fallback query, subqueries, evidence focus, quality gate) | user prompt, domain, constraint summary, planner hints | Strict JSON matching planner schema; no markdown/extra keys |
| `research.planner_repair` | `convex/research.ts` (`generatePlannerPlan`, validation retry loop) | Planner JSON parse/schema validation fails | Re-prompts planner with concrete validation issues for corrected schema output | baseline planner prompt + validation errors | Strict planner JSON schema |
| `research.ranking` | `convex/research.ts` (`buildRankingPrompt`) | Ranking stage when LLM ranking path is enabled | Produces structured category ranking JSON with rationale and scores | user prompt, domain, constraints, normalized candidate metrics | Strict ranking JSON schema; no markdown/extra keys |
| `research.ranking_repair` | `convex/research.ts` (`generateLlmRanking`, validation retry loop) | Ranking JSON parse/schema validation fails | Re-prompts ranking model with concrete validation issues | baseline ranking prompt + validation errors | Strict ranking JSON schema |

## Skill/Playbook Injection Rules (Current)

- Runtime does not read `playbooks/*.md` directly; prompts consume curated knowledge from Convex (`knowledgeDocs` + `knowledgeItems`).
- Chat sees `availableSkills` catalog + general hints from active knowledge docs via `getSkillCatalogForChatInternal`.
- `general` is the canonical global skill slug (legacy alias `skills` is accepted and normalized).
- Domain and optional skills are selected by model through `ResearchOps.start.selectedSkills` and resolved via `getSkillPackBySlugsInternal`.
- `flights_grey_tactics` must only be used after explicit user opt-in; default consent scope is thread-level.

## Maintenance Checklist

- Add a new row for every new prompt or prompt variant.
- Update row details when prompt text behavior, inputs, or schema changes.
- Keep location pointers exact (`file + function/constant name`) so future agents can patch safely.
