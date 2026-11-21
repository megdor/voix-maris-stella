// Chœur Maris Stella : portées courbées redressées. Près d'une reliure (spirale,
// livre photographié), les lignes de portée ne sont pas seulement penchées,
// elles se courbent : la lecture perd des portées entières. On mesure, bande
// verticale par bande verticale, de combien les lignes montent ou descendent
// par rapport au milieu de la page (corrélation des profils d'encre d'une bande
// à la suivante, par zones de hauteur), puis on décale chaque colonne d'autant.
// Une page plate ou droite ressort telle quelle (null).

const WORK_W = 1000; // largeur de travail
const STRIPS = 40; // bandes verticales
const ZONES = 10; // zones de hauteur (une page courbée ne se courbe pas partout pareil)
const MAX_STEP = 4; // décalage au plus entre deux bandes voisines (px de travail)
const MIN_SHIFT = 1.5; // en dessous (px de travail) : rien à corriger

function inkMask({ data, width, height }) {
	const step = Math.max(1, Math.round(width / WORK_W));
	const w = Math.floor(width / step);
	const h = Math.floor(height / step);
	const ink = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = 4 * (y * step * width + x * step);
			const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
			ink[y * w + x] = lum < 128 ? 1 : 0;
		}
	}
	return { ink, w, h, step };
}

/** Row profiles of each vertical strip. */
function profiles({ ink, w, h }) {
	const sw = w / STRIPS;
	const P = [];
	for (let s = 0; s < STRIPS; s++) {
		const x0 = Math.round(s * sw);
		const x1 = Math.round((s + 1) * sw);
		const p = new Float32Array(h);
		for (let y = 0; y < h; y++) {
			let n = 0;
			for (let x = x0; x < x1; x++) {
				n += ink[y * w + x];
			}
			p[y] = n;
		}
		P.push(p);
	}
	return P;
}

/**
 * Offsets (work px) of the lines in strip s, zone z, relative to the middle
 * strip: D[z][s]. Null when nothing to straighten.
 */
export function measureCurl(image) {
	const m = inkMask(image);
	const { h } = m;
	const P = profiles(m);
	const zh = h / ZONES;
	const D = [];
	let worst = 0;
	for (let z = 0; z < ZONES; z++) {
		const y0 = Math.round(z * zh);
		const y1 = Math.round((z + 1) * zh);
		// shift of strip s against strip s-1, with how sure we are
		const step = [0];
		const sure = [0];
		for (let s = 1; s < STRIPS; s++) {
			const a = P[s - 1];
			const b = P[s];
			let best = 0;
			let bestV = -1;
			let zero = 0;
			let second = 0;
			for (let k = -MAX_STEP; k <= MAX_STEP; k++) {
				let v = 0;
				for (let y = Math.max(y0, -k); y < Math.min(y1, h - k); y++) {
					v += a[y] * b[y + k];
				}
				if (k === 0) {
					zero = v;
				}
				if (v > bestV) {
					second = bestV;
					bestV = v;
					best = k;
				} else if (v > second) {
					second = v;
				}
			}
			// too little ink (a margin, a blank band), or no clear peak: keep level
			let ink = 0;
			for (let y = y0; y < y1; y++) {
				ink += a[y] + b[y];
			}
			const ok = ink > 0.02 * (y1 - y0) * (m.w / STRIPS) && bestV > 1.15 * zero;
			step.push(ok ? best : 0);
			sure.push(ok ? 1 : 0);
		}
		const cum = [0];
		for (let s = 1; s < STRIPS; s++) {
			cum.push(cum[s - 1] + step[s]);
		}
		const mid = cum[STRIPS >> 1];
		const row = cum.map((c) => c - mid);
		D.push(row);
	}
	// smooth across zones and strips (one wrong peak should not tear the page)
	const S = D.map((row, z) =>
		row.map((_, s) => {
			let sum = 0;
			let n = 0;
			for (let dz = -1; dz <= 1; dz++) {
				for (let ds = -1; ds <= 1; ds++) {
					const r = D[z + dz];
					if (r && r[s + ds] !== undefined) {
						sum += r[s + ds];
						n++;
					}
				}
			}
			return sum / n;
		}),
	);
	for (const row of S) {
		for (const v of row) {
			worst = Math.max(worst, Math.abs(v));
		}
	}
	return worst < MIN_SHIFT ? null : { D: S, scale: m.step, zh, sw: m.w / STRIPS };
}

/** The page with its staff lines straightened, or null when they already are. */
export function dewarpPage(image) {
	const curl = measureCurl(image);
	if (!curl) {
		return null;
	}
	// une forte courbure se mesure par défaut (décalage borné d'une bande à
	// l'autre, lissage) : on remesure sur la page corrigée et on additionne,
	// puis la page n'est rééchantillonnée qu'une fois
	let D = curl.D.map((row) => row.slice());
	for (let pass = 1; pass < 3; pass++) {
		const again = measureCurl(remap(image, { ...curl, D }));
		if (!again) {
			break;
		}
		D = D.map((row, z) => row.map((v, s) => v + again.D[z][s]));
	}
	return remap(image, { ...curl, D });
}

function remap(image, { D, scale, zh, sw }) {
	const { data, width, height } = image;
	const out = new Uint8ClampedArray(data.length);
	// offset at (x, y), full-size px: bilinear between strip / zone centres
	const S0 = new Int32Array(width);
	const S1 = new Int32Array(width);
	const TS = new Float32Array(width);
	for (let x = 0; x < width; x++) {
		const fs = Math.min(STRIPS - 1, Math.max(0, x / scale / sw - 0.5));
		S0[x] = Math.floor(fs);
		S1[x] = Math.min(STRIPS - 1, S0[x] + 1);
		TS[x] = fs - S0[x];
	}
	for (let y = 0; y < height; y++) {
		const fz = Math.min(ZONES - 1, Math.max(0, y / scale / zh - 0.5));
		const z0 = Math.floor(fz);
		const z1 = Math.min(ZONES - 1, z0 + 1);
		const tz = fz - z0;
		const A = D[z0];
		const B = D[z1];
		for (let x = 0; x < width; x++) {
			const ts = TS[x];
			const top = A[S0[x]] * (1 - ts) + A[S1[x]] * ts;
			const bot = B[S0[x]] * (1 - ts) + B[S1[x]] * ts;
			const sy = y + (top * (1 - tz) + bot * tz) * scale;
			const y0 = Math.floor(sy);
			const t = sy - y0;
			const o = 4 * (y * width + x);
			if (y0 < 0 || y0 + 1 >= height) {
				out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255;
				continue;
			}
			const a = 4 * (y0 * width + x);
			const b = a + 4 * width;
			out[o] = data[a] + (data[b] - data[a]) * t;
			out[o + 1] = data[a + 1] + (data[b + 1] - data[a + 1]) * t;
			out[o + 2] = data[a + 2] + (data[b + 2] - data[a + 2]) * t;
			out[o + 3] = data[a + 3] + (data[b + 3] - data[a + 3]) * t;
		}
	}
	return { data: out, width, height };
}
