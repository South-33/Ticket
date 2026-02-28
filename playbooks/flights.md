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
| Air France-KLM | €21.00/way | Up to 25% fare benefits on NDC buckets | 2026 |
| IAG (BA / Iberia) | £13–€15/sector | Distribution Technology Charge on legacy GDS | 2026 |
| LATAM Airlines | See breakdown below | Per-GDS, per-region pricing | May 2025 |

**LATAM GDS Surcharge Breakdown** (effective May 2025, most granular of any carrier):

| Channel | Protocol | Surcharge | Applies To |
|---|---|---|---|
| Amadeus | EDIFACT | $15.96/segment | North & Central America POS |
| Amadeus | EDIFACT | €15.33/segment | Europe, Middle East, Africa POS |
| Amadeus | EDIFACT | $10.61/segment | South America POS |
| Sabre | EDIFACT | $14.19/segment | Universal |
| Travelport | EDIFACT | $11.00/segment | Universal (lowest EDIFACT rate) |
| Sabre | NDC | $4.00/segment | All fares except Basic |
| Amadeus | NDC | $3.00 / $6.00 | Domestic / International split |
| Travelport | NDC | $2.50/segment | Non-lowest available fares |

LATAM note: Lowest "Basic" and "Light" fare families are withheld from EDIFACT entirely — paying the surcharge does not surface them. Must use NDC-connected aggregator or direct site.

---

### Dark Inventory Checklist
Carriers that skip aggregators. A search that misses these will miss entire fare options.

| Region | Carriers Missed | Recommended Tool |
|---|---|---|
| North America | Southwest, Allegiant, Flair, Porter | Direct site; Southwest Low Fare Calendar |
| Europe | Ryanair, EasyJet, Vueling | Dohop / Direct site |
| Southeast Asia | AirAsia, Scoot, JetStar, Tiger (some routes) | 12Go / Wego |
| East Asia | Peach, Jeju Air, Spring Airlines | HIS / No.1 Travel (Japan) |
| Africa | Afrijet, Air Peace, ASKY, Air Senegal | Wakanow (Nigeria) / Alternative Airlines |
| Australia/NZ | Jetstar, Rex (Regional Express) | Webjet |
| Caribbean | interCaribbean Airways, Winair | Direct: intercaribbean.com / fly-winair.sx |
| CIS / Caucasus | FlyOne Armenia, FlyOne Moldova, Qazaq Air | Wego, Skyscanner, flyone.eu (English, cards accepted) |
| Pacific Islands | Solomon Airlines, Air Niugini, Air Vanuatu | Direct: flysolomons.com / airniugini.com.pg |

Southwest note: Deliberately not on Google Flights. For 2-passenger searches, check Southwest Companion Pass logic — if one traveler has it, the second flies for fees only (~$6–22 domestic).

Africa note: Air Peace (Nigeria) prices Lagos–London and domestic Nigeria routes 15–25% lower via Wakanow or direct flyairpeace.com with Naira payment than on Kayak/Expedia — savings of $120–280 on London routes. Afrijet and ASKY operate tag fifth-freedom legs (Malabo-Douala, Abidjan-Dakar) that rarely appear in Western tools. These can save 12+ hours vs. hubbing through Addis or Paris for intra-African routing.

Caribbean note: Caribbean Airlines exited BVI routes in early 2026. interCaribbean (27 cities across the islands) and Winair have filled the gap with new routes from Barbados hub — book direct as these carriers have minimal aggregator presence.

CIS note: FlyOne Armenia/Moldova appear on Wego, Skyscanner, and Alternative Airlines with full English booking and worldwide card acceptance (flyone.eu). Fares typically 20–40% below full-service alternatives on the same city pairs (e.g., Yerevan–Istanbul €39–59 vs €90+). Qazaq Air is findable on Yandex Travel.

---

### Fifth-Freedom Route Table
These routes use long-haul aircraft on shorter hops, are often underpriced, and are missed by aggregators prioritizing non-stop home-carrier results. Always verify the route is still operating before recommending.

| Route | Carrier | Aircraft | Tip | Status |
|---|---|---|---|---|
| JFK – FRA | Singapore Airlines | A380 / 777-300ER | 60k Aeroplan pts for Business | Active 2026 |
| JFK – MXP | Emirates | A380 | Popular trans-Atlantic hacker route | Active 2026 |
| JFK – YVR | Cathay Pacific | B777 | 17.5k Alaska miles cheapest routing | Active 2026 |
| EWR – ATH | Emirates | 777-300ER | Only non-US carrier on this route | Active 2026 |
| LAX – PPT (Tahiti) | Air France | 777 / 787 | 77k Flying Blue miles for Business | Active 2026 |
| LAX – DUB | Ethiopian | B787 | Cheapest transatlantic J option | Active 2026 |
| MIA – BOG | Emirates | 777 | F-class available on 3hr hop; book standalone 20–35% below long-haul pricing | Active 2026 |
| GRU – EZE | Ethiopian / Swiss / Turkish / Air Canada | Widebody | Competition drives cash fares to ~$131 OW | Active 2026 |
| GRU – EZE | Turkish Airlines | A350 | Best widebody crossing South America | Active 2026 |
| SIN – PNH | Emirates | 777-300ER | Emirates First Class on a short hop | Active 2026 |
| SIN – DPS (Bali) | KLM | B777 | Better product than LCCs on same route | Active 2026 |
| SYD – CHC | Emirates | A380 | Popular tag; often better service than Air NZ | Active 2026 |
| DXB – HKG | Kenya Airways | B787 | Underreported; high availability | Active 2026 |
| LHR – DEL | Air Canada | 787-9 | Seasonal extension; underpriced in GDS | Seasonal |
| CMN (Casablanca) – LAX | Royal Air Maroc | B787 | Launch June 2026; only Africa–US West Coast nonstop; priced aggressively vs. European hub connections | Launch Jun 2026 |
| Lome hub (various) | ASKY / Ethiopian | Widebody | Dense intra-Africa tags (e.g., Cotonou–Abidjan, Bamako–Dakar); invisible to Western GDS — book via Ethiopian app direct | Active 2026 |

---

### Award Release Windows

| Program | Release Window | Notes |
|---|---|---|
| Finnair Plus | T-361 days | Accesses JAL/Cathay space before AA AAdvantage |
| Avianca LifeMiles | T-360 days | Sees LH First Class space at T-360 |
| Korean Air SkyPass | T-361 days | Among earliest releases |
| Air France/KLM Flying Blue | T-359 days | Best access to Delta One partner space |
| British Airways / Cathay Pacific | T-360 days | Among the earliest releases |
| Aeroplan | T-355 days | 18–23 day head start on ANA over United MileagePlus |
| Qantas Frequent Flyer | T-353 days | Releases in batches, not rolling daily calendar |
| ANA | T-355 days | Aeroplan sees this; United MileagePlus only at T-330 |
| American Airlines | T-331 days | Lags Cathay/Iberia by ~29 days |
| United Airlines | T-330 days | Consistently lags Star Alliance partners by 18–23 days |
| Etihad Guest | T-330 days | |

The 18–23 day delta between programs like Aeroplan/Finnair (T-355/361) and United/American (T-330/331) means holders of early-release programs will consistently outcompete late-release holders for premium partner space on ANA, JAL, and EVA Air. Always monitor the operating carrier's release calendar, not the partner's cached data.

---

### T-Minus Patterns (Last-Minute Inventory)

**T-85 / T-30 (Lufthansa Group)**: Lufthansa and Swiss release unsold Business Class to award partners at T-85 days. First Class releases to partners at T-30. Best programs to catch these: Aeroplan, Miles & More. The T-30 First Class window is narrow — monitor closely.

**T-14 Business Class Dump**: JAL and ANA frequently open remaining J/F seats at T-14 if cabins are more than 50% empty. Best programs: Aeroplan, JMB. Pattern weakened on some routes in 2025 — treat as `mixed`.

**T-7 to T-3 (Qatar Airways)**: Qatar often releases last-minute QSuites space in this window. Unpredictable volume but consistently reported on underperforming routes.

**T-1 month (British Airways short-haul)**: BA releases short-haul Business Class in Avios batches exactly 1 month before departure. Most reliable on European routes with historically low load factors.

**T-3 Last-Minute Release**: Some carriers release seats into the lowest award buckets 72 hours before departure. Most common on routes with historically low load factors.

---

### Active Award Sweet Spots
Verify current program rates before recommending — devaluations happen with little notice.

| Program | Route / Use Case | Points | Notes |
|---|---|---|---|
| Virgin Atlantic Flying Club | US → Mexico (Aeromexico metal) | 11,500 (Eco) / 40,000 (Biz) | One of the last standing high-value sweet spots |
| Iberia Plus (off-peak) | US East Coast → Madrid (Business) | 40,500 Avios one-way | Verified Apr 2026 window. Most tools quote devalued 57.5k+ — the off-peak chart still holds at 40.5k. Taxes ~$200. Book iberia.com or Finnair Plus. |
| Aegean Miles+Bonus | US → Europe on Turkish or United (Business) | 45,000 miles one-way | English sources focus on short-haul Aegean metal; partner chart requires manual zone lookup. No stopovers; max 23hr connections. |
| Aegean Miles+Bonus | South Korea → Australia (Business) | 55,000 miles one-way | One-way allowed. ~40% below United or Air Canada equivalent. |
| Aegean Miles+Bonus | Within North America — United Polaris (Business) | 21,000 miles one-way | Underreported outside European travel communities. |
| Aegean Miles+Bonus | Europe → South America — Lufthansa First | 75,000 miles one-way | Survives as a sweet spot as of 2026. Verify before recommending. |
| Finnair Plus (Avios) | Asia/Singapore → Europe (Business) | 62,500 Avios one-way | ~€120 surcharge. Consistent JAL/Cathay availability; accesses space before AA AAdvantage. |
| Finnair Plus (Avios) | North America → Europe (Business) | 62,500 Avios one-way | ~€100 surcharge. Transfers 1:1 from Amex MR and Capital One. |
| Finnair Plus (Avios) | Asia → Europe via Cathay Pacific (Business) | 72,500 Avios one-way | ~€150 surcharge. Higher cost but accesses Cathay space reliably. |
| Korean Air SkyPass | US mainland → Hawaii on Delta (Economy) | 25,000 miles RT / 12,500 OW | Hawaii treated as North America zone — 50–70% fewer miles than Delta SkyMiles dynamic rates. Round-trip only on partner metal. |
| Aeroplan | US → Japan on ANA (Business) | ~55,000–65,000 pts | Best program for ANA; T-355 advantage. No YQ on partners. |
| Flying Blue | Transatlantic (Business) | ~50,000 pts | Elites get better rates; saver space has decreased |
| Alaska Mileage Plan | US → South Africa on Qatar (Business) | ~75,000 pts | Limited Qatar space; strong value when available |
| SAS EuroBonus | Long-haul Business (SAS metal) | 60,000 pts one-way | Devalued 20% from 50k in Dec 2025. Still surcharge-washing: passes actual taxes only (€6–100), no YQ. Tokyo/SFO availability described as scarce — mainly last-minute releases. |
| Asiana Club | Korea → US / Europe / Oceania (Business) | 115,000 pts RT off-peak | Time-sensitive: Asiana merging into Korean Air. Promotions (e.g., ICN–CDG Business drop to 115k RT) active in early 2026. Star Alliance access until merger completes. |
| Etihad Guest | Short-haul within 500-mile band (Economy) | 6,000 miles | Introduced post-2023 restructuring. Niche but useful for Gulf region hops. |

**Geographic No-YQ Rule**: Award flights departing from Brazil, Hong Kong, Australia, or the Philippines incur low-to-zero fuel surcharges due to national consumer protection laws — regardless of which carrier or program. Where possible, position the ticketing origin to one of these countries.

**Surcharge-Washing Programs** (book partner flights through these to avoid YQ):
- Air Canada Aeroplan: no YQ on any partner (LH, SQ, ANA, etc.)
- Avianca LifeMiles: no YQ on Star Alliance partners
- United MileagePlus: no YQ on any award including non-alliance
- SAS EuroBonus: no YQ on SkyTeam partners (following 2025 alliance move)

**Degraded — do not recommend:**
- ANA Round-the-World "Global J" under 150k miles: restricted 2025.
- Turkish Airlines Miles&Smiles fixed chart: dynamic pricing rollout completing mid-2026 (Q3). Current fixed rates (e.g., Europe–Africa Business) are time-sensitive — expected 30–60% increase post-shift. Book now or not at all.

---

### Dead Hacks
Do not recommend these.

- **Fuel dumping**: Largely neutralized by GDS audits. High cancellation risk.
- **Incognito mode lowers fares**: Debunked. Pricing driven by fare bucket availability and POS, not device tracking.
- **Tuesday midnight booking rule**: Debunked. Pricing is dynamic and automated — day of week is not a reliable predictor.
- **"Friday is cheapest for international / book 31–45 days out"**: Expedia-derived statistical averages across millions of routes. Meaningless for any specific booking. Do not cite.
- **Hidden city ticketing (Skiplagged)**: Risk significantly increased in 2026. Airlines tracking no-show segments and freezing FF accounts of repeat offenders. Not surfaced by this skill.
- **Turkish Airlines domestic US at 7.5k miles on United metal**: devalued 2025.
- **Turkish Miles&Smiles fixed chart sweet spots**: Dynamic pricing completing Q3 2026. Do not recommend current fixed rates as stable.

---

## Reference File
- `flights_grey_tactics.md` — Load only when user sets `allow_grey`. Contains country-of-sale, POS simulation, currency arbitrage, and Trip.com East Asia tactics.
