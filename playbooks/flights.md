# flights.md

Flight-only procedural playbook for finding high-value itineraries in 2026.

Design goals (aligned with SkillsBench guidance):
- Keep this skill focused, procedural, and reusable across many flight requests.
- Prefer short SOP modules over long theory dumps.
- Include concrete examples and explicit output format.

## When To Use
- User asks for flights, airfare optimization, award availability, or route/cost tradeoffs.
- Do not use for train, hotel, or concert planning.

## Inputs (Minimum)
- Origin (city/airport)
- Destination (city/airport)
- Date or date range
- Cabin/class preference

Optional high-impact inputs:
- Flexibility window (+/- days)
- Nearby airport tolerance
- Baggage needs
- Loyalty programs / points balances
- Risk tolerance (`safe_only`, `allow_grey`, `allow_high_risk`)

## Module 1 - Baseline Search + Expansion
1. Run baseline search for exact route/date/cabin.
2. Expand dates by a small window (default +/- 3 days).
3. Expand route graph:
   - nearby origin airports
   - nearby destination airports
   - open-jaw variants if user is city-flexible
4. Build a candidate set with all-in price intent (not just base fare).

Stop rule:
- If expanded search yields no materially better option, keep baseline and move to Module 3.

## Module 2 - Advanced Optimization Passes
Run only when upside is likely (long-haul, high fare, flexible traveler, or award user).

### Safe / Compliant
- Fare-family comparison (bags, seat, change/refund penalties).
- Repositioning analysis (cheap feeder to stronger hub).
- Award + cash parallel search (same OD/date envelope).
- Transfer bonus check for major loyalty programs.

### Grey-Area (opt-in)
- Country-of-sale and currency comparison.
- Fifth-freedom route sweep.
- Self-transfer constructions with conservative buffers.

Policy:
- Default to safe/compliant tactics.
- Only surface grey tactics when user explicitly opts in.
- High-risk tactics are documented in the appendix and are never default suggestions.
- Experimental tactics are documented in a dedicated section and must be labeled clearly as unproven.

## Module 3 - Verification + Risk Gate
Before final recommendation, verify top candidates:
1. Recheck fare freshness (price still live).
2. Verify total cost components:
   - baggage
   - seat selection
   - change/refund terms
   - self-transfer friction and missed-connection exposure
3. Mark risk class for each itinerary:
   - `safe_compliant`
   - `grey_common`
   - `high_risk_contract`
4. Add plain-language caveats and recheck timestamp.

## Tactic Bank (Tips and Tricks)
Use these as modular tactics. Prefer combining 2-3 tactics per run, not all at once.

Evidence labeling guidance:
- `verified`: corroborated by strong sources and repeatable checks.
- `mixed`: useful in some markets/periods, but inconsistent.
- `experimental`: hypothesis-level; useful for discovery, not for confident claims.

### Search Space Expansion
- `nearby_origin_radius`: Try secondary origin airports within realistic transfer distance.
- `nearby_destination_radius`: Include alternate destination airports in same metro region.
- `date_window_scan`: Scan +/- 1 to 3 days for fare bucket shifts.
- `time_of_day_split`: Compare early/late departures for same route/day.
- `open_jaw_probe`: Compare into one city and out of another for region trips.
- `split_direction_search`: Search outbound and return legs separately before combining.
- `one_way_vs_roundtrip`: Compare OW sum versus RT fare construction.

### Fare Construction and Routing
- `reposition_to_hub`: Add cheap feeder to major hub then long-haul from hub.
- `nested_trip_check`: For frequent repeat destinations, test destination-originating fare patterns.
- `multi_city_fare_probe`: Use multi-city pricing instead of simple RT when legs differ.
- `alliance_mix_test`: Compare same route across alliance and non-alliance carriers.
- `ota_vs_direct_delta`: Compare OTA baseline with direct carrier checkout total.
- `fare_family_gap_check`: Price difference versus included benefits (bags/change/seat).
- `long_layover_tradeoff`: Test longer layovers when savings are material and acceptable.

### Geo and Currency Strategies (Grey)
- `country_of_sale_compare`: Check point-of-sale differences by market.
- `currency_checkout_compare`: Compare local-currency checkout vs card-converted total.
- `fx_spread_guardrail`: Include payment FX spread and card fees before claiming savings.
- `market_specific_promos`: Look for market-targeted fare/promotional rules.

### Loyalty and Awards
- `cash_award_parallel`: Run cash and points searches in parallel and normalize value.
- `transfer_bonus_window`: Incorporate active transfer bonus windows before final ranking.
- `partner_space_crosscheck`: Confirm award space across partner search tools/carrier views.
- `status_locked_award_check`: Treat elite-cardholder-only inventory as conditional.
- `tax_surcharge_compare`: Compare net out-of-pocket after taxes/surcharges, not points alone.
- `fifth_freedom_award_probe`: Check fifth-freedom segments for better premium value.

### Browser-Needed Verification Tactics
- `member_only_fare_check`: Logged-in fare check for carrier/member-only rates.
- `phantom_inventory_guard`: Verify inventory at checkout stage, not search layer only.
- `ancillary_total_price_pass`: Add bags/seats before final recommendation.
- `session_price_drift_check`: Recheck final price after short delay to catch drift.
- `coupon_promo_field_probe`: Validate promo code field behavior where available.

### Self-Transfer and Split-Ticket Safety
- `self_transfer_buffer_rule`: Enforce conservative buffer (default 4h, more for intl/terminal change).
- `misconnect_recovery_cost`: Estimate fallback cost if feeder leg misses onward flight.
- `baggage_recheck_penalty`: Include recheck friction and fees for split tickets.
- `visa_airside_guard`: Confirm transit visa/airside constraints for self-transfer plans.
- `airport_transfer_time_realism`: Include landside transfer time where airport change required.

### Mistake Fare Handling
- `mistake_fare_detection`: Flag if fare is extreme outlier vs recent baseline.
- `cooling_off_rule`: Warn user to delay irreversible add-ons for 7-14 days.
- `ticketing_status_monitor`: Track whether ticket remains honored before chaining plans.

## Experimental (Unproven) Tactics
Use this section for high-upside ideas that are not consistently reproducible.
These can be explored, but should not be framed as reliable unless revalidated on the current route/date.

Execution rules:
- Always label these as `experimental` in results.
- Never use fixed global savings percentages for these tactics.
- Require route, date-window, and source checks before ranking them above verified options.
- If an experimental tactic conflicts with a verified tactic, prefer the verified tactic.

Experimental tactics:
- `ndc_vs_gds_delta_probe` (experimental): Compare direct/NDC surfaced offers versus legacy aggregator output for the same itinerary shape.
- `direct_only_carrier_probe` (experimental): Probe carriers with partial/no index coverage for route-specific misses.
- `regional_blind_spot_scan` (experimental): Test whether a region has persistent metasearch gaps on low-cost or regional operators.
- `price_change_velocity_watch` (experimental): Track short-interval repricing velocity as a proxy for buy-now versus wait.
- `bucket_depletion_proxy_signal` (experimental): Use observable fare-class availability shifts as a rough scarcity signal.
- `new_route_launch_flash_watch` (experimental): Watch newly launched routes for short-lived promotional underpricing.
- `secondary_airport_suppression_probe` (experimental): Test nearby secondary airports for hub-premium suppression effects.
- `pos_currency_lag_probe` (experimental): Compare point-of-sale and checkout currency pathways for temporary conversion lag.

Anti-pitfall note:
- Treat experimental tactics as search expansion, not proof.
- Promote to `mixed` or `verified` only after repeated route-level confirmation.

### Myth Debunk Tactics
- `debunk_incognito_only`: Do not claim incognito mode alone reliably reduces fares.
- `debunk_fixed_booking_day`: Do not claim universal cheapest weekday/hour rule.
- `debunk_single_source_hacks`: Do not elevate viral hacks without corroboration.

## Quick Selection Recipes
- `budget_economy_fast`: `date_window_scan` + `nearby_destination_radius` + `fare_family_gap_check`
- `premium_cabin_value`: `cash_award_parallel` + `partner_space_crosscheck` + `tax_surcharge_compare`
- `complex_itinerary`: `open_jaw_probe` + `multi_city_fare_probe` + `ancillary_total_price_pass`
- `grey_opt_in`: `country_of_sale_compare` + `currency_checkout_compare` + `fx_spread_guardrail`

## Myths To Debunk (Do Not Recommend)
- "Incognito mode alone always lowers fares."
- "Tuesday midnight is always the cheapest booking time."

## Clarifying Questions Policy
Ask only when it changes decision quality materially:
- nearby-airport flexibility
- baggage expectations
- risk tolerance for grey/high-risk tactics
- points vs cash preference

If these are unknown, proceed with safe defaults and state assumptions.

## Output Contract (Flight Skill)
Return ranked options in this structure:

```json
{
  "assumptions": ["..."],
  "options": [
    {
      "category": "cheapest|best_value|most_convenient",
      "itinerary": "...",
      "total_price": "...",
      "value_rationale": "...",
      "evidence_tier": "verified|mixed|experimental",
      "risk_class": "safe_compliant|grey_common|high_risk_contract",
      "caveats": ["..."],
      "last_checked_utc": "ISO-8601"
    }
  ]
}
```

## Worked Example A (Safe-first)
Input:
- O: MNL
- D: NRT
- Date: 2026-11-03
- Cabin: economy
- Flex: +/- 2 days
- Risk: safe_only

Execution:
1. Baseline exact-date search.
2. Expand to nearby dates and airports (`MNL/CRK` and `NRT/HND`).
3. Compare fare families and all-in cost.
4. Revalidate top 3 and output cheapest/best-value/most-convenient.

## Worked Example B (Advanced, opt-in)
Input:
- O: NYC
- D: Europe (city-flexible)
- Date range: late May
- Cabin: business
- Risk: allow_grey

Execution:
1. Baseline award + cash scans.
2. Add repositioning from alternate US gateways.
3. Run country-of-sale/currency comparison for shortlist routes.
4. Exclude high-risk tactics (not opted in).
5. Revalidate and return ranked options with caveats.

## Curation Notes For Knowledge Admin
- Store each tactic as one knowledge item (atomic, testable).
- High-priority active entries require >=2 corroborating sources.
- Add expiry to volatile tactics (promos, loopholes, devaluations).

## Appendix - High-Risk Tactics (Explicit Opt-In Only)
Never suggest by default. Only discuss if the user explicitly asks for high-risk methods.

- `hidden_city_ticketing`: Contract-of-carriage risk, possible account action, disruption risk.
- `repeat_hidden_city_pattern`: Elevated detection risk for frequent-flyer profiles.
- `aggressive_mistake_fare_chaining`: High cancellation risk before honor window stabilizes.
- `policy_edge_exploits`: Any tactic likely to trigger fraud/abuse controls.

When surfaced, always include:
- why it is high-risk,
- potential account/boarding/loyalty consequences,
- safer alternatives.
