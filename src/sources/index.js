import * as lamovie from "./lamovie.js";
import * as hackstore from "./hackstore.js";
import * as cinecalidad from "./cinecalidad.js";
import * as seriesmetro from "./seriesmetro.js";
import * as seriesflix from "./seriesflix.js";
import * as embed69 from "./embed69.js";
import * as peliserieshoy from "./peliserieshoy.js";
import * as zoowomaniacos from "./zoowomaniacos.js";
import * as deepflix from "./deepflix.js";
import * as xupalace from "./xupalace.js";
import * as pelisplus from "./pelisplus.js";

/** Sources in priority order. */
export const SOURCES = [lamovie, hackstore, cinecalidad, seriesmetro, seriesflix, embed69, peliserieshoy, zoowomaniacos, deepflix, xupalace, pelisplus];

export const sourceById = (id) => SOURCES.find((s) => s.id === id) || null;
