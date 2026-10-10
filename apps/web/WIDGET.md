# GoalBrew Today widget for Android (KWGT)

A home-screen widget showing the most important figures from the **Today** page:
- betting on, off or paused
- Live profit or loss today
- Betfair balance
- money out
- alerts in the last hour
- picks not placed
- any warning

It reads a small read-only summary from GoalBrew. Tapping it opens the full Today page.

## 1. Make a widget key (once)

1. Make a long random key. On a PC run: `python -c "import secrets; print(secrets.token_urlsafe(32))"`
2. In DigitalOcean, open the app → **web** component → Environment variables. Add **`WIDGET_KEY`** with that value, mark it encrypted, then save and wait for the redeploy.
3. Your widget address is then:
   ```
   https://seashell-app-z8xl5.ondigitalocean.app/api/widget?key=YOUR_KEY
   ```
   Open it in your phone's browser once. You should see figures like `"status":"On"` and `"livePL":"+£3.20"`.

What the key can and can't do:
- It opens **only** this summary. It can't change settings, place bets or see members.
- It sits in the address, so don't share the address.
- If it ever leaks, change `WIDGET_KEY` in DigitalOcean and paste the new address into the widget.

## 2. Install KWGT

From the Play Store: **KWGT Kustom Widget Maker**, plus **KWGT Pro Key** (about £5, one-off). The Pro key is needed to show data from a web address.

## 3. Build the widget

1. Long-press your home screen → **Widgets** → **KWGT** → drag a **4×2** widget onto the screen, then tap it to open the editor.
2. Choose **Create** (start empty).
3. Set the address once. Open **Globals** (the globe tab) → **+** → **Text**. Name it `gb` and set its value to the widget address from step 1.
4. Add **Text** items (the **+** button → Text). For each one, tap the text, then the formula button, and enter the formula from the table.

| Shows | Formula |
|---|---|
| Betting status | `Betting $wg(gv(gb), json, ".status")$` |
| Today's Live P/L | `Today $wg(gv(gb), json, ".livePL")$` |
| Balance | `Balance $wg(gv(gb), json, ".balance")$` |
| Money out | `Out $wg(gv(gb), json, ".moneyOut")$` |
| Alerts | `$wg(gv(gb), json, ".alertsHour")$ alerts/hr` |
| Not placed | `Not placed $wg(gv(gb), json, ".notPlaced")$` |
| Warning (blank when all is well) | `$wg(gv(gb), json, ".warning")$` |
| Last updated | `$wg(gv(gb), json, ".updated")$` |

5. **Colours that follow the figures:** select an item → **Paint** → tap the colour → formula, and enter:
   - status text: `$wg(gv(gb), json, ".statusColor")$`, which is green when On, amber when Paused and red when Off
   - P/L text: `$wg(gv(gb), json, ".livePLColor")$`, which is green when up and red when down
   - warning text: `$wg(gv(gb), json, ".warningColor")$`
6. **Tap to open Today:** select the whole widget (the root) → **Touch** → **+** → action **Open Link** → `https://seashell-app-z8xl5.ondigitalocean.app/more/admin/today`
7. Save (the disk icon, top right).

**Want something simpler?** Use one text item with two lines:
```
$wg(gv(gb), json, ".line1")$
$wg(gv(gb), json, ".line2")$
```
`line1` reads like "Betting On · Today +£3.20". `line2` shows the warning if there is one, otherwise the balance, alerts per hour and the time.

## Good to know

- **How often it updates:** KWGT fetches web data on its own timer, usually every 15–30 minutes, and Android may stretch that when the phone is idle. For up-to-the-minute figures, tap the widget to open Today, which refreshes every 15 seconds.
- **"Unknown" or blank figures:** check the address in the `gb` global, and that `WIDGET_KEY` is set and the web component has redeployed.
- **Other fields:** you can also show `betsToday` (bets placed on Betfair today), `simPL`, `exposure`, `waiting`, `suggestions` (how many strategy suggestions there are) and `liveSettled`. Open the address in a browser to see them all.
