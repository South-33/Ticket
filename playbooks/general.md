# general.md

Global cross-domain guidance for travel/ticket research.

## Purpose
- Keep this doc domain-agnostic and reusable.
- Capture reusable strategy patterns used across flights, trains, and concerts.
- Prefer principles over vendor-specific details.

## Curation Rules
- Every high-impact tactic should have corroborating sources.
- Mark uncertain tactics as draft until validated.
- Add expiration windows for fast-changing tactics.
- Keep entries concise and operational (what to do, when to do it, why it works).

## Playbook Catalog

Use this catalog to decide which playbook to load for a thread.

- `general.md`
  - Scope: always-on baseline guidance.
  - Contains: behavior rules, questioning strategy, ranking standards, caveat communication standards.
- `flights.md`
  - Scope: conditional, load for airfare/award/itinerary optimization tasks.
  - Contains: flight workflow, tactic bank, validation checks, evidence/risk output conventions.
- `train.md`
  - Scope: conditional, load for rail route and ticket optimization tasks.
  - Contains: train-specific search workflow, transfer logic, fare and policy checks.
- `concert.md`
  - Scope: conditional, load for event-ticket discovery and ranking tasks.
  - Contains: on-sale windows, inventory patterns, authenticity/risk checks.
- `flights_grey_tactics.md`
  - Scope: opt-in only (never default).
  - Contains: legal-but-grey airfare tactics with higher volatility/risk caveats.
  - Guardrail: load only after explicit user consent (`allow_grey`, default scope is current thread).

## Suggested Sections
- Query decomposition patterns
- Validation/checklist templates
- Ranking and tradeoff heuristics
- Freshness and recheck policies
- Risk/caveat communication standards

## Notes
- Domain-specific content belongs in `flights.md`, `train.md`, `concert.md`, or `flights_grey_tactics.md`.
- Runtime canonical skill slug is `general` (legacy `skills` is accepted as an alias for compatibility).
- Runtime reads playbooks from Convex `playbooks` table; `playbooks/*.md` files are source-of-truth and must be synced.
