import test from "node:test";
import assert from "node:assert/strict";
import * as plugin from "../src/plugin.js";
test("panel exports exist", () => {
  for (const n of ["panel", "panelAction", "playerEvent"]) assert.equal(typeof plugin[n], "function", n);
});
