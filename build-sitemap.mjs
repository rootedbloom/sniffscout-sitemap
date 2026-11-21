// Builds sitemap-listings.xml for SniffScout from the Airtable Places table.
// Includes every listing shown on the site (Listing Status = Verified or
// Needs Verification) plus one city page per city.
//
// Nightly: runs in GitHub Actions with the AIRTABLE_TOKEN secret (read-only).
// Locally:  node build-sitemap.mjs --from-file today.txt   (lines: recId|City|ST)

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const BASE = "appftyqdAtj9V64e4";
const TABLE = "tblPVBIPqTbLvPbqe";
const SITE = "https://www.getsniffscout.com";
const OUT = "sitemap-listings.xml";
const SHOWN = ["Verified", "Needs Verification"];
const MIN_EXPECTED = 20; // safety net: never overwrite the sitemap with a near-empty one

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// Same slug rule the city page uses: "Fort Thomas" + "KY" -> "fort-thomas-ky"
const slugOf = (city, st) =>
  (clean(city) + "-" + clean(st)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function fromAirtable() {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) throw new Error("AIRTABLE_TOKEN is not set");
  const formula = "OR(" + SHOWN.map((s) => `{Listing Status}='${s}'`).join(",") + ")";
  const rows = [];
  let offset;
  do {
    const p = new URLSearchParams({ filterByFormula: formula, pageSize: "100" });
    ["City", "State"].forEach((f) => p.append("fields[]", f));
    if (offset) p.set("offset", offset);
    const res = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?${p}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
    const j = await res.json();
    j.records.forEach((r) => rows.push({ id: r.id, city: r.fields.City, state: r.fields.State }));
    offset = j.offset;
  } while (offset);
  return rows;
}

function fromFile(path) {
  return readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [id, city, state] = l.split("|");
    return { id, city, state };
  });
}

const argFile = process.argv.indexOf("--from-file");
const rows = argFile > -1 ? fromFile(process.argv[argFile + 1]) : await fromAirtable();

if (rows.length < MIN_EXPECTED) {
  throw new Error(`Only ${rows.length} listings came back; refusing to overwrite the sitemap.`);
}

const listingUrls = [...new Set(rows.map((r) => r.id))].sort()
  .map((id) => `${SITE}/place-details?recordId=${id}`);
const citySlugs = [...new Set(rows.filter((r) => clean(r.city) && clean(r.state))
  .map((r) => slugOf(r.city, r.state.toUpperCase())))].sort();
const cityUrls = citySlugs.map((s) => `${SITE}/dog-friendly-places?city=${s}`);

const urls = [...cityUrls, ...listingUrls];
const xml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
  "\n</urlset>\n";

const old = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
if (old === xml) {
  console.log(`No change (${listingUrls.length} listings, ${cityUrls.length} city pages).`);
} else {
  writeFileSync(OUT, xml);
  console.log(`Updated: ${listingUrls.length} listings, ${cityUrls.length} city pages.`);
}
