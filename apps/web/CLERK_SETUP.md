# Clerk sign-in: setup checklist

What the code does: wraps the site in Clerk, adds a top bar with a **Sign in**
button (signed out) or Clerk's **user button** (signed in). Nothing is locked
behind Clerk yet. The existing admin password gate and the bet feed are unchanged.

## Order matters
Add the two keys on DigitalOcean BEFORE pushing the code. Without them the
site shows an error on every page.

## 1. Create the Clerk app (5 minutes, in the browser)
1. Go to https://dashboard.clerk.com and sign up.
2. Create application -> name it "Goal Brewing Alerts" -> choose the sign-in
   methods you want (Email is enough) -> Create.
3. Open **API keys**. Copy the **Publishable key** (starts `pk_test_`) and the
   **Secret key** (starts `sk_test_`).

## 2. Add the keys on DigitalOcean (web component only)
App Platform -> your app -> the **web** component (named `surge-bot-admin`) ->
Settings -> App-Level or Component Environment Variables -> Edit:

| Key | Value | Scope | Encrypt |
|---|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | the `pk_test_...` key | **Build and Run time** | no |
| `CLERK_SECRET_KEY` | the `sk_test_...` key | Run time (or both) | **yes** |

The publishable key MUST be available at build time, otherwise the header
cannot start. Do not add these to the engine component.

## 3. Copy the files in and push
Drag the `apps` folder from the zip into your repo folder, replace files,
then commit and push in GitHub Desktop. Deploy outside match hours, with
the Sending master switch off.

## 4. Check it worked
- Open the live site: a "Sign in" button is in the top bar.
- Sign up through it. The button turns into your round profile picture.
- /more/admin still asks for the admin password as before.

## Good to know
- The `pk_test_` / `sk_test_` keys are Clerk's development keys. They work on
  the DigitalOcean web address, show a "Development mode" note in the pop-up,
  and are capped at 100 users.
- Clerk's production keys (`pk_live_`) need a domain you own, with DNS records
  added. Not possible on the `ondigitalocean.app` address.
- The private bet feed (/feeds/...) is excluded from Clerk on purpose.
