## Project Summery

An AI-powered travel & ticket search agent that acts like a conversational assistant: collect user details (dates, origin, nationality, preferences, loyalty/points), run a curated deep-research pipeline across flights, trains, and ticket sources, and return prioritized options (e.g., cheapest, best value, most convenient) with actionable next steps. Persist useful user preferences as memory to improve future recommendations.

# Agent Notes

## Notes
- Build and ship in small, verified slices; every new capability must keep existing flows stable before expanding scope.
- Reference implementation is available locally at `C:\Users\Venom\Documents\CODE\.vscode\Project\gpt-researcher`; consult it for planner/executor/synthesis patterns before reinventing pipeline internals.
- Keep `architecture-plan.md` as the implementation source of truth and update it when architecture decisions or constraints change.
