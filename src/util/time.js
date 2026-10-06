// Time limits. QuickJS has no setTimeout: every wait is kino.sleep, in short steps that stop as soon as the work they
// guard is done.

/** Waits up to `ms` with kino.sleep in short steps; returns early once `done()` says so. */
export async function waitFor(kino, ms, done = () => false) {
  const end = Date.now() + ms;
  while (!done()) {
    const left = end - Date.now();
    if (left <= 0) return;
    await kino.sleep(Math.min(250, left));
  }
}

/** `promise`'s outcome as `{ v }` or `{ e }`, or `{ v: fallback, late: true }` when it has not settled within `ms`; never throws. */
export async function within(kino, promise, ms, fallback) {
  let settled = false;
  const guarded = Promise.resolve(promise).then((v) => { settled = true; return { v }; }, (e) => { settled = true; return { e }; });
  const r = await Promise.race([guarded, waitFor(kino, ms, () => settled).then(() => null, () => null)]);
  return r || { v: fallback, late: true };
}

/** `run()`'s value, or a `timeout` error when it takes longer than `ms` (at once when `ms` is not positive). */
export async function bounded(kino, run, ms, what) {
  await null; // Kino 0.9.49 and older: nothing may throw before the first await
  if (!(ms > 0)) throw kino.error("timeout", `${what}: no time left`);
  const r = await within(kino, Promise.resolve().then(run), ms, undefined);
  if (r.late) throw kino.error("timeout", `${what}: over ${Math.round(ms)} ms`);
  if (r.e) throw r.e;
  return r.v;
}

// What Kino gives each export (engine-limits.md); a scoped search is a search Kino waits 6 s for (contract.md).
export const LIMIT_MS = {
  search: 15000, scopedSearch: 6000, home: 20000, section: 20000, browse: 20000, categories: 20000, episodes: 20000,
  details: 20000, resolve: 20000, action: 30000, settingsStatus: 10000, validateSettings: 20000,
};
// An approved hidden browser gives resolve 75 s; the plugin keeps itself well under that.
export const BROWSER_RESOLVE_MS = 45000;

/**
 * The deadline of one export call, taken when it starts: Kino's limit for that export minus a margin to answer in.
 * `{ end, left() }`, `end` in epoch ms.
 */
export function callDeadline(kino, call) {
  const limit = call === "resolve" && kino && kino.browser ? BROWSER_RESOLVE_MS : LIMIT_MS[call] || 15000;
  const margin = limit <= 6000 ? 1000 : 1500;
  const end = Date.now() + limit - margin;
  return { end, left: () => Math.max(0, end - Date.now()) };
}
