import * as lamovie from "./lamovie.js";
import * as hackstore from "./hackstore.js";

/** Sources in priority order. */
export const SOURCES = [lamovie, hackstore];

export const sourceById = (id) => SOURCES.find((s) => s.id === id) || null;
