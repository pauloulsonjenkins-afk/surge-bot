# Strategy search on the pick history, 14 Nov 2026

Data-based analysis only, not betting advice. Source: the "Download every pick" export (13,542 picks, 23 Sep to 14 Nov 2026),
read in the browser while the owner was signed in. Nothing on the site was changed.

## Result
No profitable strategy is supported by this history. Nothing found in the older half held up on the newer half.

## Method
- Base set: settled, not excluded, GoalBrew's own LAY copies, Best Value Cuppa and Telegram tips left out (9,553 alerts).
- Price: only prices that can be trusted (5,580 alerts): the matched Betfair price where a bet was placed, otherwise the
  Betfair price at the alert when it is within -15% / +25% of the alert's own price, otherwise the exchange price.
- Flat 1-unit stakes, 2% commission on winnings.
- Split by date: search on picks before 26 Oct (2,319), test on picks from 26 Oct (3,261).
- Search: 20 features (strategy, market, price, minute, score, goals, pre-match price, momentum, xG, shots on target,
  corners, dangerous attacks, strike rate, hour, weekend, last goal, red cards, country, bookmaker margin), singly and in pairs.

## Findings
| | Alerts | Hit rate | Price implies | Flat return |
|---|---|---|---|---|
| All base alerts, recorded price | 9,553 | 65.1% | 67.9% | -4.6% |
| Trusted Betfair prices | 5,580 | 64.9% | 67.1% | -3.3% |
| Bets actually matched on Betfair | 1,159 | 63.0% | 64.4% | -1.7% |

- The hit rate is below what the price implies in every price band and every week. The alerts carry no edge on average.
- Slices: 1,165 slices had 100+ alerts in the older half. 42 looked good there (+4% or more). On the newer half those 42
  returned -1.9% pooled (all alerts: -3.6%), and 20 of 42 were positive: a coin toss. The correlation between a slice's
  older-half and newer-half return was 0.06.
- Model: a logistic model of the true chance from the price plus the alert's stats, fitted on the older half, predicted
  the newer half slightly worse than the Betfair price alone. Its "value" picks returned -0.9% to -3.7%.
  The stats in the alert are already in the price.
- Minute 46-60 is the one window that did not lose in either half: +2.8% (593) then +0.6% (790). Break-even, not an edge.
  Minutes 61-75 lost in both (-3.7%, -6.8%); first-half alerts lost most.
- Picks sent but not matched won 78.4% against 71.1% implied (245). Matched bets won 63.0% against 64.4%. The alerts
  that are right are the ones where the price has gone before the bet lands.

## Data problems found
- "Betfair price at alert" is the wrong line in roughly one next-goal alert in ten (2 to 3 times the alert's price,
  e.g. Over 1.5 at 0-1 priced 5.0). Any figure built on it without a sanity check is inflated. Worth checking Price check.
- Odds are placeholders on some unpriced rows (1.2 on 119 "Underdog taking charge" rows, 1.1 on 84 "First Half Goal" rows).
  With them, Underdog taking charge reads +8%; at real prices it is +3.7% on 169 with real bets at 1.01 to 1.09.
- "FH Goal 15-30 Spin" reads -15% on 247 alerts, but its recorded prices (about 1.5 for a first-half goal at 0-0 on
  15 minutes) look earlier than the alert, so the true figure is probably nearer break-even.

## What would be worth testing in Sim
1. A 46-60 minute window on the existing next-goal strategies (drops the losing 61-75 and first-half alerts).
2. Offering a price instead of taking one (the drip shadow test), since paying the spread plus commission is about
   the whole of the loss.
3. Why the unmatched picks were not matched, and what price would have got them on.
