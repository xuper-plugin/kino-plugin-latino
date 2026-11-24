// The Home's rows carry the type tag Kino shelves titles by (Películas, Series, Infantil), not only a generic one.
import test from "node:test";
import assert from "node:assert/strict";
import { HOME_ROWS } from "../src/catalog.js";

test("the Home has rows tagged peliculas, series and infantil, and the infantil one is the kids genre titled Infantil", () => {
  const tags = new Set(HOME_ROWS.map((r) => r.genre));
  for (const g of ["peliculas", "series", "infantil"]) assert.ok(tags.has(g), g);
  const kids = HOME_ROWS.find((r) => r.genre === "infantil");
  assert.equal(kids.genreSlug, "kids");
  assert.equal(kids.titleKey, "g_kids");
});
