# flights.md

Flight optimization skill for finding high-value itineraries.

## When To Use
- User asks for flights, airfare, award availability, or route/cost tradeoffs.
- Do not use for trains, hotels, or non-flight travel planning.

## Required Inputs
- Origin and destination (city or airport)
- Travel date or range
- Cabin class

## Optional Inputs (ask only if they change the recommendation)
- Date flexibility (+/- days)
- Nearby airport tolerance
- Baggage requirements
- Loyalty program / points balances
- Number of passengers
- Risk tolerance: `safe_only` (default) | `allow_grey` (default consent scope: current thread)

If optional inputs are unknown, proceed with safe defaults and state your assumptions.

---

## Execution Workflow

### Step 1 — Baseline Search
Search the exact route, date, cabin, and passenger count. Establish an all-in price (base fare + taxes + standard baggage).

**Do not rely solely on Google Flights or Skyscanner.** Several major carriers impose GDS surcharges or withhold inventory from aggregators — always cross-check the carrier's direct site for routes on AA, Lufthansa, Emirates, SQ, or Air France-KLM. See NDC Surcharge Table below.

Also run a **dark inventory check** for any route where LCCs are plausible. Southwest, Ryanair, AirAsia and others don't appear on standard aggregators. See Dark Inventory Checklist below.

### Step 2 — Expand the Search Space
Apply 2-3 tactics from the Tactic Bank. Pick the ones most likely to yield savings for this specific route type.

Recommended combos by use case:
- **Budget economy**: `date_window_scan` + `nearby_destination_radius` + `fare_family_gap_check`
- **Group travel (2+ pax)**: always run `group_bucket_split` first
- **Premium / business class**: `cash_award_parallel` + `ghost_award_validation` + `tax_surcharge_compare`
- **Award travel**: `release_window_timing` + `partner_space_crosscheck` + `ghost_award_validation`
- **Complex itinerary**: `open_jaw_probe` + `fifth_freedom_probe` + `multi_city_fare_probe`
- **Grey tactics** (only if user opts in): load `flights_grey_tactics.md`

### Step 3 — Verify Before Recommending
1. Confirm the fare is still live at checkout — not just in search results.
2. Build true all-in cost: base fare + taxes + baggage + seat fees.
3. Flag connections under 60 min domestic or 90 min international.
4. For award options: cross-validate space on 2 independent tools before recommending any points transfer. See Ghost Availability note below.
5. Assign risk class: `safe_compliant` | `grey_common`

---

## Tactic Bank

Pick 2-3 per run. Do not apply all at once.

### Search Expansion
- `date_window_scan`: Check +/- 1 to 3 days. Fare buckets shift meaningfully across dates.
- `nearby_origin_radius`: Try secondary origin airports within realistic travel distance.
- `nearby_destination_radius`: Include alternate airports in the same destination metro.
- `open_jaw_probe`: Fly into one city, out of another — often cheaper for regional trips.
- `one_way_vs_roundtrip`: Price outbound and return separately before combining.
- `dark_inventory_check`: Always check carriers that skip aggregators. See Dark Inventory Checklist below.

### Fare Construction
- `ndc_direct_check`: For AA, Lufthansa, Emirates, SQ, Air France-KLM — always check the carrier's direct site. GDS surcharges on these carriers are €13–25 per booking. AA withholds ~40% of inventory from GDS entirely. See NDC Surcharge Table below.
- `group_bucket_split`: For 2+ passengers, search for 1 passenger AND 2+ passengers separately. Airlines require all passengers in one booking to share the same fare bucket. If Price(2 pax) > 2 × Price(1 pax), book two separate single-passenger tickets. **100% repeatable across all GDS carriers.**
- `fare_family_gap_check`: Compare base vs. mid vs. flex — check if the price gap is worth the change/refund benefit.
- `reposition_to_hub`: Add a cheap feeder to a major hub, then take the main long-haul leg.
- `fifth_freedom_probe`: Check if the route has a fifth-freedom option — often widebody aircraft on short hops, systematically underpriced. See Fifth-Freedom Route Table below.
- `ota_vs_direct_delta`: Compare OTA total vs. booking direct — especially critical for NDC carriers.

### Loyalty & Awards
- `cash_award_parallel`: Run cash and award searches in parallel. Normalize to out-of-pocket cost.
- `ghost_award_validation`: Before recommending a points transfer, verify award inventory on the operating carrier's own tool AND at least one independent partner tool. Ghost availability — where a partner shows seats the operating carrier already sold — results in non-refundable point transfers going to waste.
- `release_window_timing`: Award seats release at specific T-minus windows. ANA at T-355, BA/Cathay at T-360, United at T-330. An Aeroplan holder has a 25-day advantage over a United MileagePlus user for the same ANA seat. See Award Release Windows below.
- `last_minute_biz_check`: For business class, check T-14 and T-3 windows. See T-Minus Patterns below.
- `sweet_spot_check`: Before pricing an award at market rates, check Active Award Sweet Spots below.
- `transfer_bonus_window`: Check if an active transfer bonus changes the points math.
- `tax_surcharge_compare`: Net out-of-pocket after carrier surcharges, not points value alone. Critical for Emirates and BA awards.

### Self-Transfer Safety
- `self_transfer_buffer_rule`: Minimum 4 hours for international self-transfers; more if terminal change required.
- `misconnect_recovery_cost`: Estimate fallback cost before recommending a tight split-ticket.
- `baggage_recheck_penalty`: Include recheck friction and fees for any split-ticket construction.

---

## Output Format

```json
{
  "assumptions": ["list any defaults applied"],
  "options": [
    {
      "category": "cheapest | best_value | most_convenient",
      "itinerary": "plain text route and timing",
      "total_price": "all-in cost including fees",
      "value_rationale": "why this option ranks here",
      "evidence_tier": "verified | mixed",
      "risk_class": "safe_compliant | grey_common",
      "caveats": ["list any catches"],
      "source": "where this was found (e.g. 'AA direct site, checked this session')"
    }
  ]
}
```

- `evidence_tier: verified` = corroborated, repeatable. `mixed` = works in some markets/periods, inconsistent.
- Never fabricate prices. If you can't confirm a live fare, say so and direct the user to verify.

---

## What NOT To Do
- Do not use grey tactics unless user explicitly sets `allow_grey`.
- Do not claim "book on Tuesday" or "incognito saves money" — both are debunked. See Dead Hacks below.
- Do not surface hidden city ticketing or fuel dumping — out of scope for this skill.
- Do not recommend a points transfer until ghost availability is validated on 2 independent sources.

---

## Reference Data

### NDC Surcharge Table
Carriers that impose surcharges on GDS/aggregator bookings. Always cross-check the direct site for these.

| Carrier | GDS Surcharge (approx.) | Key Note | Data Date |
|---|---|---|---|
| Lufthansa Group (LH, LX, OS, SN) | €18.50–24.00 | NDC opt-in removes fee entirely | 2026 |
| American Airlines | $18.00–25.00 | Withholds ~40% of inventory from GDS | Mar 2024 |
| Emirates | $14.00–25.00 | NDC incentives on select India-UAE routes | Apr 2024 |
| Singapore Airlines | $12.00–15.00 | NDC access via select aggregators | Jun 2024 |
| Air France-KLM | €13.00–17.00 | Up to 25% fare benefits on NDC buckets | 2025 |
| LATAM Airlines | $12.00/segment | Via Amadeus/Sabre/Travelport | May 2025 |

---

### Dark Inventory Checklist
Carriers that skip aggregators. A search that misses these will miss entire fare options.

| Region | Carriers Missed | Recommended Tool |
|---|---|---|
| North America | Southwest, Allegiant, Flair, Porter | Direct site; Southwest Low Fare Calendar |
| Europe | Ryanair, EasyJet, Vueling | Dohop / Direct site |
| Southeast Asia | AirAsia, Scoot, JetStar, Tiger (some routes) | 12Go / Wego |
| East Asia | Peach, Jeju Air, Spring Airlines | HIS / No.1 Travel (Japan) |
| Africa | Afrijet, Air Peace, ASKY, Air Senegal | Alternative Airlines |
| Australia/NZ | Jetstar, Rex (Regional Express) | Webjet |

Southwest note: Deliberately not on Google Flights. For 2-passenger searches, check Southwest Companion Pass logic — if one traveler has it, the second flies for fees only (~$6–22 domestic).

Africa note: Carriers like Afrijet and Air Peace operate tag fifth-freedom legs (Malabo-Douala, Abidjan-Dakar) that rarely appear in Western tools. These can save 12+ hours vs. hubbing through Addis or Paris for intra-African routing.

---

### Fifth-Freedom Route Table
These routes use long-haul aircraft on shorter hops, are often underpriced, and are missed by aggregators prioritizing non-stop home-carrier results. Always verify the route is still operating before recommending.

| Route | Carrier | Aircraft | Tip | Status |
|---|---|---|---|---|
| JFK – FRA | Singapore Airlines | A380 / 777-300ER | 60k Aeroplan pts for Business | Active 2026 |
| JFK – MXP | Emirates | A380 | Popular trans-Atlantic hacker route | Active 2026 |
| EWR – ATH | Emirates | 777-300ER | Only non-US carrier on this route | Active 2026 |
| LAX – PPT (Tahiti) | Air France | 777 / 787 | 77k Flying Blue miles for Business | Active 2026 |
| GRU – EZE | Ethiopian / Swiss / Turkish / Air Canada | Widebody | Competition drives cash fares to ~$131 OW | Active 2026 |
| SIN – PNH | Emirates | 777-300ER | Emirates First Class on a short hop | Active 2026 |
| SYD – CHC | Emirates | A380 | Popular tag; often better service than Air NZ | Active 2026 |
| LHR – DEL | Air Canada | 787-9 | Seasonal extension; underpriced in GDS | Seasonal |

---

### Award Release Windows

| Carrier (Operating) | Release Window | Notes |
|---|---|---|
| British Airways / Cathay Pacific | T-360 days | Among the earliest releases |
| ANA | T-355 days | Aeroplan sees this; United MileagePlus only at T-330 |
| American Airlines | T-331 days | |
| United Airlines | T-330 days | |

The 25-day gap between ANA releasing (T-355) and United seeing it (T-330) means an Aeroplan holder will consistently outcompete a United MileagePlus user for ANA Business Class. Always monitor the operating carrier's release calendar, not the partner's cached data.

---

### T-Minus Patterns (Last-Minute Inventory)

**T-14 Business Class Dump**: Lufthansa and JAL frequently open unsold Business Class into the "I" award bucket exactly 14 days before departure if J/C cabins are more than 50% empty. Best programs to catch this: Aeroplan, Miles & More, JMB. Pattern weakened on some routes in 2025 — treat as `mixed`.

**T-3 Last-Minute Release**: Some carriers release seats into the lowest award buckets 72 hours before departure. Most common on routes with historically low load factors.

---

### Active Award Sweet Spots
Verify current program rates before recommending — devaluations happen with little notice.

| Program | Route / Use Case | Points | Notes |
|---|---|---|---|
| Virgin Atlantic Flying Club | US → Mexico (Aeromexico metal) | 11,500 (Eco) / 40,000 (Biz) | One of the last standing high-value sweet spots |
| Iberia Plus (off-peak) | NYC / ORD → Madrid (Business) | 34,000–50,000 Avios | Aggregators miss off-peak dates; big saving vs. peak chart |
| Aeroplan | US → Japan on ANA (Business) | ~55,000–65,000 pts | Best program for ANA; T-355 advantage |
| Flying Blue | Transatlantic (Business) | ~50,000 pts | Elites get better rates; saver space has decreased |
| Alaska Mileage Plan | US → South Africa on Qatar (Business) | ~75,000 pts | Limited Qatar space; strong value when available |

**Degraded — do not recommend:**
- ANA Round-the-World "Global J" under 150k miles: restricted 2025.
- Turkish Airlines domestic US at 7.5k miles on United metal: devalued 2025.

---

### Dead Hacks
Do not recommend these.

- **Fuel dumping**: Largely neutralized by GDS audits. High cancellation risk.
- **Incognito mode lowers fares**: Debunked. Pricing driven by fare bucket availability and POS, not device tracking.
- **Tuesday midnight booking rule**: Debunked. Pricing is dynamic and automated — day of week is not a reliable predictor.
- **Hidden city ticketing (Skiplagged)**: Risk significantly increased in 2026. Airlines tracking no-show segments and freezing FF accounts of repeat offenders. Not surfaced by this skill.

---

## Reference File
- `flights_grey_tactics.md` — Load only when user sets `allow_grey`. Contains country-of-sale, POS simulation, currency arbitrage, and Trip.com East Asia tactics.
