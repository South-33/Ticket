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
- India: local consolidator pricing and INR-denominated fares produce 10–25% savings on routes touching Indian subcontinent.
- Brazil (BRL): domestic and some international routes priced meaningfully lower via Brazilian POS.

Award POS differences: British Airways and Iberia awards show meaningful YQ differences by departure country — flights originating from Hong Kong or Brazil (where surcharges are legally capped) save hundreds of dollars versus the same routing originating from London.

Caveats:
- Requires a payment method that works in that market (or use a no-FX-fee card).
- Savings are route-specific — verify before claiming.
- Always include card foreign transaction fees in the net calculation.
- Major carriers have anti-fraud and IP-tracking measures. Most reliable for regional/budget carriers.

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

### Brazilian Loyalty Programs — Smiles & Azul Fidelidade (`brazil_loyalty_arbitrage`)

Brazil has two major domestic loyalty ecosystems with meaningfully different international partner access. Understanding which to use for which route is non-obvious.

**Smiles (GOL)** connects to SkyTeam partners (Delta, Air France/KLM, Aeromexico). Smiles&Money option allows partial points + cash co-pay for partner awards — useful for accessing Etihad or Korean Air Business at below-market effective cost. Brazilian forums (Melhores Destinos, 99milhas) document Smiles miles purchasable at ~R$16 per 1,000 during promotional windows, with Miami Business Class redemptions at ~197,000 miles (~R$2,865 effective cost via Clube subscription) versus cash fares of R$14,000+. Savings of 70–85% versus market rate — but requires Brazilian CPF and local payment method.

**Azul Fidelidade** connects to Star Alliance-adjacent partners (United, TAP, Lufthansa, Turkish). Best for transatlantic via TAP (Lisbon stopover allowed free) or United/Lufthansa Business Class. Azul Fidelidade's "Companion Pass" offers a complimentary companion ticket on domestic routes — strongest domestic Brazil benefit.

**Since GOL/Azul codeshare matured in 2024**, members can credit to either program regardless of which airline operated the flight. Strategic move: earn in whichever program has the better redemption for your next international trip.

**Key difference**: Smiles = SkyTeam international access. Azul = Star Alliance international access. An AI defaulting to "Smiles is the Brazilian program" will recommend the wrong program for Star Alliance redemptions.

Caveats:
- Smiles flash sales and Clube bonuses rotate quarterly — timing matters.
- Brazilian CPF required for Smiles account; Azul accessible to non-Brazilians more easily.
- Label as `mixed` — savings magnitudes vary significantly by route and purchase window.

### West African Booking Channels (`west_africa_local_ota`)
For routes involving Nigerian or West African carriers, global aggregators apply currency conversion mark-ups and often miss local financing options. Use regional OTAs for accurate pricing.

- **Wakanow** (wakanow.com): Best channel for Air Peace in Nigeria. Supports Naira payment and "Pay Small Small" installment financing (10% deposit locks fare). Lagos–London round-trip savings of $120–280 vs. British Airways on comparable dates.
- **Travelstart** (West Africa): Covers Air Senegal, Air Peace, and regional carriers across anglophone/francophone West Africa.

Caveats:
- Wakanow typically requires Nigerian payment method for financing; international Visa/Mastercard supported at standard rates.
- Strict 24-hour cancellation window on Air Peace — flag to user.
- Label as `mixed` — pricing advantage is documented but varies by route.
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
