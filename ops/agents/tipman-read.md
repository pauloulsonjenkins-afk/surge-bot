# TipMan read (scheduled Claude task, not yet created)

TipMan (tipmantips.com) publishes its bets as cards on its website. GoalBrew tracks each card as the tipster sets it up
(`apps/src/tips/tipman-cards.ts`): stake in points, combined price, each leg. The engine holds **no TipMan login** (the
horse site is a different site), so the page is read in the owner's own signed-in browser and posted to GoalBrew.

Suggested schedule: 11:30, 14:30, 18:00 and 19:45 UK, daily (`30 11,14,18 * * *` plus a 19:45 run). Premium bets are
published at various times from late morning to the evening (the Telegram posts show bookings and bet builders at about 19:00).

## What the task does

1. In the browser pane, in a tab signed in to tipmantips.com, open
   `https://www.tipmantips.com/premium-football-tips/` and `https://www.tipmantips.com/football-betting-tips/`, and on each run:

```js
const t=e=>e?e.textContent.replace(/\s+/g,' ').trim():'';JSON.stringify([...document.querySelectorAll('.custom-card')].filter(c=>c.querySelector('.bets .bet')).map(c=>{const k=String(c.className);return{id:(/tip-id-(\d+)/.exec(k)||[])[1]||'',free:/\bfree\b/.test(k),name:t(c.querySelector('.widget__card-header .name, .name')),hdr:t(c.querySelector('.widget__card-header')),note:[t(c.querySelector('.widget__card-body > p')),t(c.querySelector('[class*=stake],[class*=point],[class*=pts]'))].filter(Boolean).join(' '),legs:[...c.querySelectorAll('.bets .bet')].map(b=>({w:t(b.querySelector('.left .d-none')),s:t(b.querySelector('h2')),m:t(b.querySelector('.market')),o:t(b.querySelector('.right .odds'))})),links:[...c.querySelectorAll('a[href]')].filter(a=>/betfair|paddypower|skybet|bet365|betmgm|betsbk/i.test(a.href)).map(a=>({u:a.href.slice(0,700),t:t(a)}))}}))
```

   Check `document.body.className.includes('logged-in')` on the premium page; if false, stop and tell the owner to sign in.
   An empty premium list early in the day is normal (nothing published yet).

2. In a tab signed in to the GoalBrew admin, post everything found (at most 30 cards):

```js
fetch('/api/admin/tipman',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'ingest',cards:CARDS})}).then(r=>r.text())
```

3. Report how many cards were on each page, how many were new, and for each new premium card its category, points, price and legs.

Never type or ask for a password; never click Log in, Start Your Free Month or any offer or buy button. Nothing is bet.

## What GoalBrew does with it

- Parses each card (odds from fractions, category from the card's name, points from "1pt"-style wording, UK kick-off times).
- Sends a phone notification for each new premium card.
- Every 10 minutes looks up the legs Betfair's Exchange lists (match result, both teams to score, goals over/under) and
  settles them from the Exchange's result; a card is lost as soon as a leg loses, won when all have won.
- Bookings, cards, corners, player bets and most bet builders are not on the Exchange: the owner marks those cards
  won/lost/void on the TipMan page (More > Strategies > TipMan).
- Profit is in points (pts x (price - 1) won, -pts lost) and in pounds at the owner's £ per point (default £1).

## If the markup is different on premium

The extraction was written against the free page's cards, which are the same component as the premium ones. If the
premium page's cards differ (no `.custom-card` with `.bets .bet`), report what the page contains and adjust the snippet
here, in the task, and `RawCard` handling in `tipman-cards.ts`.
