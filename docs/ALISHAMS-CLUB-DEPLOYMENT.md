# Alishams Club deployment

The Club code is committed to the `main` branch. The public website files can deploy through the site's existing hosting pipeline; the Supabase database migration and Edge Function still need to be deployed to the linked Supabase project.

## 1. Apply the database migration

From the repository root, with the Supabase CLI linked to project `srfldjfrzmtnlabusssq`:

```bash
supabase db push
```

Alternatively, run the complete migration file in the Supabase SQL Editor:

`supabase/migrations/202611060001_alishams_club.sql`

The migration expects the existing Alishams tables `client_orders`, `project_payments`, `client_projects`, `referral_attributions`, `plus_purchase_records`, and `plus_payment_intents` to exist. These are already referenced by the current application.

## 2. Deploy the Club Edge Function

```bash
supabase functions deploy club-api --project-ref srfldjfrzmtnlabusssq
```

The repository's `supabase/config.toml` sets `verify_jwt = false` for this function so the homepage can request the public leaderboard. Private actions validate the user's access token inside the function; administrative actions additionally verify the existing admin identity.

The function uses the existing Supabase environment variables `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

## 3. Verify the rollout

- Open `https://alishams.ir/` and confirm the Alishams League section renders.
- Sign in at `https://alishams.ir/account.html`, open «باشگاه مشتریان», and save a display name.
- Confirm a successful Plus+ payment adds 200 points and the first-purchase bonus adds 100 points once.
- Confirm a project payment adds points only after `confirmed = true`.
- Confirm a qualified referral adds 150 points.
- Redeem a reward and use its `CLUB-` code on a new order; the fixed credit is applied when the order quote is set.
- Reach Diamond in a test account and confirm only one teaser request can be submitted in the same week.
- Open `https://alishams.ir/club-admin.html` as the admin and update a teaser request.

## Points and tier rules

- 10 points per 100,000 toman of confirmed project payment.
- 200 points per approved Plus+ purchase/renewal.
- 100 points once for the first confirmed purchase.
- 150 points for a qualified referral.
- Bronze: 0–499; Silver: 500–1,499; Gold: 1,500–3,499; Diamond: 3,500+.
- Tier and public league use lifetime positive points earned. Redeeming points reduces spendable balance but does not reduce lifetime rank.
- Diamond members may submit one free motion-graphics teaser request per calendar week. Unused weekly quota does not roll over.

The public leaderboard displays only the nickname selected by the member, never email addresses or account identifiers.
