# What Do? — Google Places Worker setup (your 10-second steps)

The app is already wired: it asks Google first, falls back to OpenStreetMap
when Google is down, and keeps the hand-built packs on top. Until this
Worker is live, the app behaves exactly as it does today — nothing breaks.

## 1. Create the Worker

Cloudflare dashboard → Workers & Pages → Create → Worker → name it
**exactly `whatdo-places`** (the app calls
`https://whatdo-places.orlandochaidez.workers.dev/nearby`).

## 2. Paste the code

Delete the starter code, paste in the whole `worker.js` file from this
folder, Deploy.

## 3. Set the secret (same key as Grub)

Worker → Settings → Variables and Secrets → Add:
- Name: `GOOGLE_PLACES_KEY`
- Type: Secret, Production checked
- Value: the same Google Places API key you used for `grub-places`.
  (Find it in Google Cloud Console → APIs & Services → Credentials,
  or wherever you saved it. Don't paste it in chat — it goes straight
  into Cloudflare, I never see it.)

Save, then tell me it's live (or just send the Worker URL).

## 4. That's it — it lights up on its own

> v2 note (2026-11-16): after the first live test, Google's `includedTypes`
> turned out to be a preference, not a strict filter — the v1 Worker also
> returned insurance agencies, pet stores, and restaurants next to the
> real spots. The app now filters those out itself (allowlist, same list
> as the Worker v2 code in `worker.js`), so your deployed v1 Worker works
> fine as-is. Re-pasting `worker.js` is optional — it just trims the junk
> server-side too. No rush, do it whenever.

No app update needed. The next search in What Do? will pull real Google
places for any city, with OSM as backup. Tell me once it's deployed and
I'll test it end to end (92126 + "san diego" + a random small town).

## Cost guardrails (already in place)

- Pro-tier fields only (name/address/location/type) — 5,000 free
  Nearby Search calls/mo, shared with grub-places. One fresh area
  search ≈ 12 calls; the app caches each area 7 days per visitor.
- Hours mode (open-now) is Enterprise ($35/1k, 1,000 free/mo) and the
  app doesn't call it yet — the Worker is ready for it when we want it.
- Same $300 Google trial as Grub (expires ~2027-01-19) covers any
  overage until then; the $5 budget alarm on the project is the seatbelt.
