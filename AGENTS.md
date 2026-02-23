## Project Summary

An AI-powered travel & ticket search agent that acts like a conversational assistant: collect user details (dates, origin, nationality, preferences, loyalty/points), run a curated deep-research pipeline across flights, trains, and ticket sources, and return prioritized options (e.g., cheapest, best value, most convenient) with actionable next steps. Persist useful user preferences as memory to improve future recommendations.

# Agent Notes

## Notes
- Build and ship in small, verified slices; every new capability must keep existing flows stable before expanding scope.
- Reference implementation is available locally at `C:\Users\Venom\Documents\CODE\.vscode\Project\gpt-researcher`; consult it for planner/executor/synthesis patterns before reinventing pipeline internals.
- Keep `architecture-plan.md` as the implementation source of truth and update it when architecture decisions or constraints change.
- Keep `tools.md` up to date whenever tool contracts/channels/schema change (add/remove/rename tools, validation loops, or apply behavior), so new agents can immediately see the current tool map.

## Reference Docs
- Convex best practices: https://docs.convex.dev/understanding/best-practices
- Convex actions: https://docs.convex.dev/functions/actions
- Convex scheduled functions: https://docs.convex.dev/scheduling/scheduled-functions
- Convex indexes/query performance: https://docs.convex.dev/database/reading-data/indexes
- Convex query functions: https://docs.convex.dev/functions/query-functions
- AI SDK tool calling docs: https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling
- Clerk UserProfile customization (custom pages/tabs): https://clerk.com/docs/nextjs/guides/customizing-clerk/adding-items/user-profile

## Supplemental Reading (Non-Authoritative)
- Advanced tool calling deep dive: https://sparkco.ai/blog/advanced-tool-calling-in-llm-agents-a-deep-dive
- Tool-calling optimization eval write-up: https://www.useparagon.com/learn/rag-best-practices-optimizing-tool-calling/
- Use these for strategy ideas and evaluation heuristics, not API/SDK truth.
