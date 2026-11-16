// What Do? Places proxy — Cloudflare Worker (v1)
// Holds the Google Places API key server-side (secret: GOOGLE_PLACES_KEY).
// Same pattern as GrubRoulette's grub-places worker, same Google Cloud
// project/key — the 5,000 free Nearby Search calls/mo are SHARED between
// the two apps. The web app calls: GET /nearby?lat=32.91&lon=-117.14
// Returns: { places: [{ name, address, lat, lon, type, id }] }
//
// Google caps one Nearby Search at 20 results, and the 20 *closest*
// spots in a dense area crowd out whole categories. So the Worker fans
// out one search per activity type (12 calls), merges and de-dupes the
// results, and returns them all. Cost per fresh area lookup is 12 API
// calls — with the app's 7-day per-visitor cache, real use stays far
// inside the shared 5,000/month free Pro allowance.
//
// Field mask is Pro-tier only (name/address/location/type/id). Hours
// mode (opt-in, ?hours=1) adds places.currentOpeningHours — an
// Enterprise-SKU field (1,000 free calls/mo, then $35/1k) — so the
// default path NEVER requests it. The app only calls hours mode when an
// open-now filter is on. (v1 app doesn't call it yet; the Worker is
// ready for it.)

const ALLOWED_ORIGINS = ["https://orlandochaidez.com", "https://orlandochaidez.github.io"];
const TYPE_GROUPS = [
  "tourist_attraction", "museum", "park", "zoo",
  "aquarium", "art_gallery", "amusement_park", "bowling_alley",
  "movie_theater", "night_club", "bar", "cafe",
];
const PRO_MASK = "places.displayName,places.formattedAddress,places.location,places.primaryType,places.id";
const HOURS_MASK = PRO_MASK + ",places.currentOpeningHours";
// v2: allowlist on primaryType. Google's includedTypes is a preference,
// not a strict filter — a "park" search also returns the insurance
// agency next to the park, pet stores, restaurants. Anything not in this
// set is dropped here (the app enforces the same list as a second gate).
// Restaurants/food are excluded on purpose (GrubRoulette's lane).
const ALLOWED_TYPES = new Set([
  "tourist_attraction", "historical_landmark", "cultural_landmark", "monument",
  "church", "hindu_temple", "mosque", "synagogue", "marina",
  "museum", "art_museum", "planetarium", "observatory",
  "park", "city_park", "dog_park", "picnic_ground",
  "national_park", "state_park", "nature_preserve", "hiking_area", "campground",
  "botanical_garden", "zoo", "aquarium", "art_gallery",
  "amusement_park", "water_park", "amusement_center",
  "bowling_alley", "movie_theater", "performing_arts_theater",
  "night_club", "bar", "wine_bar", "sports_bar", "lounge_bar", "bar_and_grill", "brewery", "pub", "casino",
  "cafe", "coffee_shop", "tea_house", "bakery", "donut_shop", "ice_cream_shop",
  "stadium", "sports_club", "fitness_center", "playground", "library", "ski_resort",
]);

async function searchOne(env, type, lat, lon, hours) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.GOOGLE_PLACES_KEY,
      // Default: Pro-tier fields only = 5,000 free calls/mo counted per
      // call (shared with grub-places). Hours mode adds
      // currentOpeningHours, an Enterprise field (1,000 free/mo, $35/1k)
      // — requested ONLY when the caller passes hours=1.
      "X-Goog-FieldMask": hours ? HOURS_MASK : PRO_MASK,
    },
    body: JSON.stringify({
      includedTypes: [type],
      maxResultCount: 20,
      rankPreference: "DISTANCE",
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lon }, radius: 10000 },
      },
    }),
  });
  if (!r.ok) throw new Error("google " + r.status + " (" + type + "): " + (await r.text()).slice(0, 200));
  const data = await r.json();
  return data.places || [];
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);
    if (url.pathname !== "/nearby") return json({ error: "not found" }, 404, cors);

    const lat = parseFloat(url.searchParams.get("lat"));
    const lon = parseFloat(url.searchParams.get("lon"));
    if (!isFinite(lat) || !isFinite(lon)) return json({ error: "lat and lon are required" }, 400, cors);
    const hours = url.searchParams.get("hours") === "1";

    let groups;
    try {
      groups = await Promise.all(TYPE_GROUPS.map((t) => searchOne(env, t, lat, lon, hours)));
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502, cors);
    }

    const seen = new Set();
    const places = [];
    for (const p of groups.flat()) {
      const name = (p.displayName && p.displayName.text) || "";
      const address = p.formattedAddress || "";
      if (!ALLOWED_TYPES.has(p.primaryType || "")) continue; // v2: drop shops/offices/restaurants
      const key = name + "|" + address;
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const place = {
        name,
        address,
        lat: p.location ? p.location.latitude : null,
        lon: p.location ? p.location.longitude : null,
        type: p.primaryType || "",
        id: p.id || null, // Google place_id (stable key for future ratings)
      };
      if (hours) {
        // Enterprise hours block; absent/null when Google has no hours
        // for this place — the app treats that as "unknown", never closed.
        const coh = p.currentOpeningHours || null;
        place.openNow = coh && typeof coh.openNow === "boolean" ? coh.openNow : null;
        place.nextClose = coh && coh.nextCloseTime ? coh.nextCloseTime : null;
        place.nextOpen = coh && coh.nextOpenTime ? coh.nextOpenTime : null;
      }
      places.push(place);
    }
    return json({ places }, 200, cors);
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
