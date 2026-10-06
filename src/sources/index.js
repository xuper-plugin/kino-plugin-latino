import * as lamovie from "./lamovie.js";
import * as hackstore from "./hackstore.js";
import * as cinecalidad from "./cinecalidad.js";
import * as seriesmetro from "./seriesmetro.js";
import * as seriesflix from "./seriesflix.js";

/** Sources in priority order. */
export const SOURCES = [lamovie, hackstore, cinecalidad, seriesmetro, seriesflix];

export const sourceById = (id) => SOURCES.find((s) => s.id === id) || null;
