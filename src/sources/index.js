import * as lamovie from "./lamovie.js";
import * as hackstore from "./hackstore.js";
import * as cinecalidad from "./cinecalidad.js";
import * as seriesmetro from "./seriesmetro.js";
import * as seriesflix from "./seriesflix.js";
import * as embed69 from "./embed69.js";
import * as zoowomaniacos from "./zoowomaniacos.js";
import * as deepflix from "./deepflix.js";
import * as pelisplus from "./pelisplus.js";
import * as pelispanda from "./pelispanda.js";
import * as tioplus from "./tioplus.js";
import * as cncverse from "./cncverse.js";

/** Sources in priority order. A `fallback` source (CNCVerse) is asked only when the others found nothing. */
export const SOURCES = [lamovie, hackstore, cinecalidad, seriesmetro, seriesflix, embed69, zoowomaniacos, deepflix, pelisplus, pelispanda, tioplus, cncverse];

export const sourceById = (id) => SOURCES.find((s) => s.id === id) || null;
