# flights_grey_tactics.md

**Load this file only when the user has explicitly set `allow_grey` risk tolerance.**

These tactics are legal but involve booking nuances that carry minor risks (pricing inconsistency, policy changes, card fees, potential ToS grey areas). They are not default recommendations.

---

## Grey Tactics

### Country-of-Sale Comparison (`country_of_sale_compare`)
Airlines price the same route differently depending on where the booking originates. Prioritize checking: the departure country, the arrival country, the airline's home hub country, and a low-demand market (Vietnam and Turkey are documented as producing lower fares for regional routes).

Well-documented cases:
- Round-the-World tickets on Star Alliance: booking from Oslo (OSL) has historically been cheapest.
- Domestic Vietnam flights: local Vietnam Airlines site shows "Saver" buckets restricted to the Vietnamese market.
- Turkey: Pegasus and Turkish Airlines domestic hops priced lower on local-IP access.

Caveats:
- Requires a payment method that works in that market (or use a no-FX-fee card).
- Savings are route-specific — verify before claiming.
- Always include card foreign transaction fees in the net calculation.

### Currency Checkout Comparison (`currency_checkout_compare`)
Pay in the carrier's local currency rather than letting your card auto-convert. Many OTAs apply a 3-5% markup on currency conversion. Evaluate whether `P_local × R_spot < P_home` before recommending.

Caveats:
- Run the `fx_spread_guardrail` check first — card FX fees (1-3%) + any dynamic currency conversion spread often wipe out apparent savings.
- Do not surface this unless the net saving is material (>3-5% after all fees).
- Argentina (ARS) increasingly difficult due to government currency controls.

### FX Spread Guardrail (`fx_spread_guardrail`)
Before claiming any currency-based saving: subtract card foreign transaction fee (typically 1-3%) + DCC spread if applicable. Many apparent savings disappear after this step.

### POS Simulation — Four-Market Check (`pos_four_market_scan`)
For high-value routes, simulate searches from four points of sale: (1) departure city, (2) arrival city, (3) airline's home hub, (4) a known low-demand market (Vietnam or Turkey for Asian routes; a lower-income EU country for European routes). Compare all-in costs including payment fees.

This is documented as more repeatable for intra-Asian, Middle Eastern, and South American routes than for transatlantic or transpacific.

Caveats:
- Major carriers have anti-fraud and IP-tracking measures. This is most reliable for regional/budget carriers.
- Include all payment friction before declaring a saving.
- Label findings as `mixed` evidence tier unless you can confirm on the specific route.

### Trip.com for East Asian Routes (`tripcom_east_asia_check`)
For routes involving Chinese hubs (Shanghai, Beijing, Guangzhou) or intra-East Asian corridors (e.g., Incheon-Osaka, Tokyo-Seoul), Trip.com has been documented as 15-20% cheaper than global aggregators. In mid-2025, Incheon-Osaka was ~20,000 KRW cheaper on Trip.com vs. rival platforms.

Context: The platform is under a Chinese anti-monopoly probe (as of Jan 2026) for suspected below-cost pricing to maintain market dominance. This creates an arbitrage window that may not persist.

Caveats:
- Relevant primarily for East Asian corridors and Chinese hub routes.
- Customer service during disruptions may be harder to access for non-Chinese-speaking travelers.
- Label as `mixed` — the pricing advantage may narrow if the regulatory probe results in pricing changes.
- Confirm at checkout; the discount may not apply to all fare classes.

### Market-Specific Promotions (`market_specific_promos`)
Some carriers run promotions only visible in specific markets. Worth checking the carrier's regional site if a route has a strong hub in a specific country.

Caveats:
- Promo fares are time-limited and volatile. Always label as `mixed` evidence tier.

---

## Output Notes for Grey Tactics

When surfacing any finding from this file:
- Set `risk_class: grey_common` in the output.
- Add a plain-language caveat explaining the grey nature of the tactic.
- Always show the net saving *after* fees, not the gross saving.
- Do not recommend VPN use for carriers with sophisticated fraud detection — stick to legitimate market-site access.
