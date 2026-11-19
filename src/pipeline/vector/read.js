// Lecture exacte d'une partition PDF née numérique : du relevé brut (extract.js) à la musique.
// Portées, systèmes, barres de mesure, clés, armures, chiffrages, notes (hauteur et durée),
// silences, voix, liaisons de prolongation, paroles ; puis un arbre MusicXML par système,
// joints par join.js comme les pages lues par copista.

import { shapeSymbols } from "./shapes.js";
import { El } from "../copisteria/xml.js";
import { familiesOf, mscoreUsesSmufl, symbolOf } from "./fonts.js";

const DIV = 48; // divisions par noire : croches de triolet et doubles croches exactes

// ---------------------------------------------------------------- outils

const median = (a) => {
	if (!a.length) return null;
	const s = [...a].sort((x, y) => x - y);
	return s[s.length >> 1];
};
const cluster = (vals, tol) => {
	const s = [...vals].sort((a, b) => a - b);
	const out = [];
	for (const v of s) {
		const last = out[out.length - 1];
		if (last && v - last[last.length - 1] <= tol) last.push(v);
		else out.push([v]);
	}
	return out;
};

/** Étendue verticale d'un polygone à l'abscisse x (null s'il ne la traverse pas). */
function spanAt(poly, x) {
	let lo = Infinity;
	let hi = -Infinity;
	const n = poly.length;
	for (let i = 0; i < n; i++) {
		const [ax, ay] = poly[i];
		const [bx, by] = poly[(i + 1) % n];
		if ((ax <= x && x <= bx) || (bx <= x && x <= ax)) {
			const y = ax === bx ? Math.min(ay, by) : ay + ((x - ax) / (bx - ax)) * (by - ay);
			const y2 = ax === bx ? Math.max(ay, by) : y;
			lo = Math.min(lo, y, y2);
			hi = Math.max(hi, y, y2);
		}
	}
	return lo === Infinity ? null : [lo, hi];
}


/**
 * Encore (police Anastasia) dessine les portées et les hampes avec des caractères : une portée
 * « = » (cinq lignes, un corps de haut), des morceaux de hampe « « » (vers le haut, à droite de la
 * tête) et « » » (vers le bas, à gauche). On les rend en traits, comme les autres logiciels.
 */
export function withGlyphLines(raw) {
	const segs = [...raw.segs];
	let added = 0;
	for (const g of raw.glyphs) {
		if (!/Anastasia/i.test(g.font)) continue;
		const sp = g.size / 4;
		if (g.uni === 0x3d) {
			for (let i = 0; i < 5; i++) segs.push({ x0: g.x, y0: g.y - i * sp, x1: g.x + g.adv, y1: g.y - i * sp, w: 0.1 });
			added++;
		} else if (g.uni === 0xab) {
			segs.push({ x0: g.x + g.adv, y0: g.y - sp, x1: g.x + g.adv, y1: g.y, w: 0.1 });
			added++;
		} else if (g.uni === 0xbb) {
			segs.push({ x0: g.x, y0: g.y, x1: g.x, y1: g.y + sp, w: 0.1 });
			added++;
		}
	}
	return added ? { ...raw, segs } : raw;
}

// ---------------------------------------------------------------- portées

function findStaves(raw) {
	const hs = [];
	for (const s of raw.segs) {
		if (Math.abs(s.y0 - s.y1) < 0.25 && Math.abs(s.x1 - s.x0) > 4) {
			hs.push({ y: (s.y0 + s.y1) / 2, x0: Math.min(s.x0, s.x1), x1: Math.max(s.x0, s.x1) });
		}
	}
	for (const f of raw.fills) {
		if (!f.curved && f.y1 - f.y0 < 1.2 && f.x1 - f.x0 > 20) {
			hs.push({ y: (f.y0 + f.y1) / 2, x0: f.x0, x1: f.x1 });
		}
	}
	// lignes groupées par hauteur
	hs.sort((a, b) => a.y - b.y);
	const rows = [];
	for (const h of hs) {
		const r = rows[rows.length - 1];
		if (r && h.y - r.y <= 0.2) {
			r.x0 = Math.min(r.x0, h.x0);
			r.x1 = Math.max(r.x1, h.x1);
			r.len += h.x1 - h.x0;
			r.parts.push(h);
		} else rows.push({ y: h.y, x0: h.x0, x1: h.x1, len: h.x1 - h.x0, parts: [h] });
	}
	// plus long trait continu de chaque rangée (des morceaux bout à bout comptent pour un)
	for (const r of rows) {
		const ps = r.parts.sort((a, b) => a.x0 - b.x0);
		let best = 0;
		let a = ps[0].x0;
		let b = ps[0].x1;
		for (const p of ps.slice(1)) {
			if (p.x0 <= b + 0.6) b = Math.max(b, p.x1);
			else {
				best = Math.max(best, b - a);
				a = p.x0;
				b = p.x1;
			}
		}
		r.max = Math.max(best, b - a);
	}
	// lignes de portée : de longs traits (les lignes supplémentaires, courtes, sont écartées)
	const long = rows.filter((r) => r.max > 18);
	const gaps = [];
	for (let i = 1; i < long.length; i++) {
		const d = long[i].y - long[i - 1].y;
		if (d > 2 && d < 16) gaps.push(Math.round(d * 20) / 20);
	}
	const freq = new Map();
	gaps.forEach((g) => freq.set(g, (freq.get(g) ?? 0) + 1));
	const staves = [];
	const used = new Set();
	const candidates = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
	for (const g of candidates.slice(0, 3)) {
		for (let i = 0; i < long.length; i++) {
			if (used.has(i)) continue;
			const pick = [i];
			let y = long[i].y;
			for (let j = i + 1; j < long.length && pick.length < 5; j++) {
				if (used.has(j)) continue;
				const d = long[j].y - y;
				if (Math.abs(d - g) <= 0.15 * g) {
					pick.push(j);
					y = long[j].y;
				} else if (d > g * 1.2) break;
			}
			if (pick.length !== 5) continue;
			const ls = pick.map((k) => long[k]);
			const x0 = Math.max(...ls.map((l) => l.x0));
			const x1 = Math.min(...ls.map((l) => l.x1));
			if (x1 - x0 < 8 * g) continue;
			pick.forEach((k) => used.add(k));
			staves.push({
				lines: ls.map((l) => l.y),
				top: ls[0].y,
				bot: ls[4].y,
				sp: (ls[4].y - ls[0].y) / 4,
				x0: Math.min(...ls.map((l) => l.x0)),
				x1: Math.max(...ls.map((l) => l.x1)),
			});
		}
	}
	return staves.sort((a, b) => a.top - b.top);
}

// ---------------------------------------------------------------- éléments verticaux

export function verticals(raw, sp) {
	const v = [];
	for (const s of raw.segs) {
		if (Math.abs(s.x0 - s.x1) < 0.3 && Math.abs(s.y1 - s.y0) > 0.8 * sp) {
			v.push({ x: (s.x0 + s.x1) / 2, y0: Math.min(s.y0, s.y1), y1: Math.max(s.y0, s.y1), w: s.w });
		}
	}
	for (const f of raw.fills) {
		if (!f.curved && f.x1 - f.x0 < 0.9 * sp && f.y1 - f.y0 > 0.8 * sp && (f.y1 - f.y0) > 2.5 * (f.x1 - f.x0)) {
			v.push({ x: (f.x0 + f.x1) / 2, y0: f.y0, y1: f.y1, w: f.x1 - f.x0, fill: true });
		}
	}
	// traits bout à bout sur la même verticale (hampes et barres dessinées en morceaux) : un seul
	const groups = new Map();
	for (const s of v) {
		const key = `${Math.round(s.x * 5)}|${s.fill ? 1 : 0}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(s);
	}
	const out = [];
	for (const g of groups.values()) {
		g.sort((a, b) => a.y0 - b.y0);
		let cur = null;
		for (const s of g) {
			if (cur && s.y0 <= cur.y1 + 0.6) cur.y1 = Math.max(cur.y1, s.y1);
			else {
				cur = { ...s };
				out.push(cur);
			}
		}
	}
	return out;
}

function findSystems(staves, V, raw) {
	const systems = [];
	for (const st of staves) {
		const prev = systems[systems.length - 1];
		const last = prev?.[prev.length - 1];
		const sp = st.sp;
		const linked =
			last &&
			st.top - last.bot < 25 * sp &&
			(V.some((v) => v.y0 <= last.bot + 0.5 * sp && v.y1 >= st.top - 0.5 * sp && v.x < st.x0 + 6 * sp) ||
				raw.fills.some((f) => f.curved && f.y0 <= last.bot + sp && f.y1 >= st.top - sp && f.x1 < st.x0 + 2 * sp && f.x1 > st.x0 - 4 * sp));
		if (linked) prev.push(st);
		else systems.push([st]);
	}
	return systems;
}

export function barlines(sys, V, heads) {
	const n = sys.length;
	const sp = sys[0].sp;
	const hits = [];
	sys.forEach((st, k) => {
		for (const v of V) {
			if (v.y0 <= st.top + 0.3 * sp && v.y1 >= st.bot - 0.3 * sp && v.x >= st.x0 - sp && v.x <= st.x1 + sp) {
				// une hampe touche une tête à l'une de ses extrémités
				const stemLike = heads.some(
					(h) =>
						(Math.abs(h.x - v.x) < 0.35 * sp || Math.abs(h.x + h.w - v.x) < 0.35 * sp) &&
						(Math.abs(h.y - v.y0) < 0.7 * sp || Math.abs(h.y - v.y1) < 0.7 * sp),
				);
				hits.push({ x: v.x, k, stemLike });
			}
		}
	});
	const xs = [];
	for (const c of cluster(hits.map((h) => h.x), 0.5 * sp)) {
		const here = hits.filter((h) => c.includes(h.x));
		const staffs = new Set(here.map((h) => h.k));
		const stemOnly = here.every((h) => h.stemLike);
		const need = n === 1 ? 1 : Math.max(2, Math.ceil(0.6 * n));
		if (staffs.size >= need && !stemOnly) xs.push(median(c));
	}
	const x0 = Math.min(...sys.map((s) => s.x0));
	const x1 = Math.max(...sys.map((s) => s.x1));
	const all = [x0, ...xs, x1].sort((a, b) => a - b);
	const merged = [];
	for (const x of all) {
		if (!merged.length || x - merged[merged.length - 1] > 1.2 * sp) merged.push(x);
		else merged[merged.length - 1] = Math.max(merged[merged.length - 1], x);
	}
	return merged;
}

// ---------------------------------------------------------------- hauteurs

const STEPS = "CDEFGAB";
const CLEF_BASE = { clefG: 30, clefG8: 23, clefG8va: 37, clefF: 18, clefF8: 11, clefC: 24 }; // indice diatonique de la ligne du bas (E4=30)
const CLEF_XML = {
	clefG: { sign: "G", line: 2 },
	clefG8: { sign: "G", line: 2, oct: -1 },
	clefG8va: { sign: "G", line: 2, oct: 1 },
	clefF: { sign: "F", line: 4 },
	clefF8: { sign: "F", line: 4, oct: -1 },
	clefC: { sign: "C", line: 3 },
};
const SHARPS = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
const FLATS = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

function keyAlter(fifths, step) {
	if (fifths > 0) return SHARPS.slice(0, fifths).includes(step) ? 1 : 0;
	if (fifths < 0) return FLATS.slice(0, -fifths).includes(step) ? -1 : 0;
	return 0;
}


/** Les caractères d'un même mot, écrits un à un, réunis ; une espace sépare les mots. */
/**
 * Un mot écrit d'un seul bloc mais dont les syllabes sont écartées (sous les notes) :
 * on le recoupe là où un blanc visible sépare deux lettres, d'après la position de chaque lettre.
 */
function splitRuns(runs, glyphs) {
	return runs.flatMap((r) => {
		if (r.g0 === undefined || r.g1 - r.g0 < 2) return [r];
		const gs = glyphs.slice(r.g0, r.g1);
		const out = [];
		let cur = null;
		for (const g of gs) {
			if (/^\s*$/.test(g.ch)) {
				// une espace : fin du mot (position exacte de chaque mot)
				if (cur) out.push(cur);
				cur = null;
				continue;
			}
			if (cur && g.x - cur.x1 <= 0.25 * r.size && g.x >= cur.x - 0.5) {
				cur.str += g.ch;
				cur.x1 = Math.max(cur.x1, g.x + g.adv);
			} else {
				if (cur) out.push(cur);
				cur = { ...r, str: g.ch, x: g.x, x1: g.x + g.adv };
			}
		}
		if (cur) out.push(cur);
		return out;
	});
}

/** Tirets entre syllabes (écrits à part) : marque début, milieu et fin de mot. */
function markHyphens(texts, segs = []) {
	const flat = segs.filter((g) => Math.abs(g.y1 - g.y0) < 0.2 && Math.abs(g.x1 - g.x0) > 0.5);
	const lines = new Map();
	for (const t of texts) {
		const k = Math.round(t.y * 2);
		const key = [...lines.keys()].find((q) => Math.abs(q - k) <= 1) ?? k;
		if (!lines.has(key)) lines.set(key, []);
		lines.get(key).push(t);
	}
	const isHy = (t) => /^[-–]+$/.test(t.str);
	for (const line of lines.values()) {
		line.sort((a, b) => a.x - b.x);
		for (let i = 0; i < line.length; i++) {
			const t = line[i];
			if (isHy(t) || !/\p{L}/u.test(t.str)) continue;
			const next = line[i + 1];
			const prev = line[i - 1];
			if (/[-–]$/.test(t.str) || (next && isHy(next) && next.x - t.x1 < 4 * t.size)) t.hypAfter = true;
			// tiret dessiné en trait (MuseScore) entre cette syllabe et la suivante
			if (!t.hypAfter && next && /\p{L}/u.test(next.str)) {
				const dash = flat.some((g) => {
					const a = Math.min(g.x0, g.x1);
					const b = Math.max(g.x0, g.x1);
					return a >= t.x1 - 0.5 && b <= next.x + 0.5 && b - a < 1.2 * t.size && g.y0 < t.y - 0.1 * t.size && g.y0 > t.y - 0.6 * t.size;
				});
				if (dash) {
					t.hypAfter = true;
					next.hypBefore = true;
				}
			}
			if (prev && (isHy(prev) && t.x - prev.x1 < 4 * t.size || prev.hypAfter)) t.hypBefore = true;
		}
	}
	return texts;
}

function mergeTexts(runs) {
	const rs = [...runs].sort((a, b) => a.y - b.y || a.x - b.x);
	const out = [];
	for (const r of rs) {
		const last = out[out.length - 1];
		const x1 = r.x1 ?? r.x + 0.5 * r.size;
		if (last && last.font === r.font && Math.abs(last.y - r.y) < 0.3 && r.x - last.x1 < 0.15 * r.size && r.x >= last.x1 - 0.5 && !/\s$/.test(last.str) && !/^\s/.test(r.str)) {
			last.str += r.str;
			last.x1 = x1;
		} else out.push({ ...r, x1 });
	}
	return out.flatMap((r) => {
		// une suite contenant des espaces : un mot par morceau (position estimée)
		if (!/\s/.test(r.str.trim())) return r.str.trim() ? [{ ...r, str: r.str.trim() }] : [];
		const parts = r.str.split(/(\s+)/);
		const per = (r.x1 - r.x) / Math.max(1, r.str.length);
		let x = r.x;
		const res = [];
		for (const p of parts) {
			if (p.trim()) res.push({ ...r, str: p, x, x1: x + per * p.length });
			x += per * p.length;
		}
		return res;
	});
}

// ---------------------------------------------------------------- page

const HEADS = { head1: 1, head1x: 1, head2: 2, head4: 4, head0: 8 };
const RESTS = { rest0: 8, rest4: 4, rest2: 2, rest1: 1, rest8: 0.5, rest16: 0.25, rest32: 0.125 };
const ACC = { flat: -1, sharp: 1, natural: 0, dflat: -2, dsharp: 2 };
const DYN = /^(p+|f+|m[pf]|sf+z?|fp|sfp|rf+z?|cresc\.?|dim\.?|decresc\.?|rit\.?|a tempo|poco|più|piu|molto|subito)$/i;

/**
 * Lit une page relevée. Renvoie { systems: [{ staves, measures, tree? }], report }.
 * `state` garde d'une page à l'autre la clé, l'armure et le chiffrage de chaque portée.
 */
export function readPage(raw, state = { keys: [], times: null }) {
	const report = { unknown: new Map(), notes: 0, rests: 0 };
	raw = withGlyphLines(raw);
	const staves = findStaves(raw);
	if (!staves.length) return { systems: [], report, staves };
	const sp = median(staves.map((s) => s.sp));
	// glyphes musicaux
	const mscoreSmufl = mscoreUsesSmufl(raw.glyphs);
	const fams = familiesOf(raw.glyphs);
	const familyOf = (f) => (fams.has(f) ? fams.get(f) : null);
	const syms = [];
	for (const g of raw.glyphs) {
		const fam = familyOf(g.font);
		if (!fam) continue;
		const s = symbolOf(g, fam, mscoreSmufl);
		if (!s) {
			const k = `${g.font.replace(/^[A-Z]{6}\+/, "")}:${(g.uni ?? g.code ?? 0).toString(16)}`;
			report.unknown.set(k, (report.unknown.get(k) ?? 0) + 1);
			continue;
		}
		syms.push({ s, x: g.x, y: g.y, size: g.size, adv: g.adv || 1.2 * sp, font: g.font });
	}
	// clés d'une police inconnue (O salutaris de Rossini : « p », « P », « l ») : un caractère d'une
	// petite police, au début de chaque portée, posé sur la ligne de sol, d'ut ou de fa
	{
		const codes = new Map();
		for (const g of raw.glyphs) {
			if (familyOf(g.font)) continue;
			if (!codes.has(g.font)) codes.set(g.font, new Set());
			codes.get(g.font).add(g.uni ?? g.code);
		}
		const found = [];
		for (const g of raw.glyphs) {
			if (familyOf(g.font) || (codes.get(g.font)?.size ?? 99) > 6) continue;
			for (const st of staves) {
				if (g.x < st.x0 - 0.5 * st.sp || g.x > st.x0 + 4 * st.sp) continue;
				const line = (st.bot - g.y) / st.sp;
				if (g.y < st.top - 2 * st.sp || g.y > st.bot + 2 * st.sp) continue;
				if (Math.abs(line - 1) < 0.15) found.push({ g, kind: "G" });
				else if (Math.abs(line - 3) < 0.15) found.push({ g, kind: "F" });
				else if (Math.abs(line - 2) < 0.15) found.push({ g, kind: "C" });
			}
		}
		const gCodes = new Map();
		for (const f of found.filter((f) => f.kind === "G")) gCodes.set(f.g.uni, (gCodes.get(f.g.uni) ?? 0) + 1);
		const gMain = [...gCodes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
		for (const { g, kind } of found) {
			const s = kind === "F" ? "clefF" : kind === "C" ? "clefC" : g.uni === gMain ? "clefG" : "clefG8";
			syms.push({ s, x: g.x, y: g.y, size: g.size, adv: g.adv, font: g.font });
		}
	}
	// pas de police musicale : la musique est dessinée en formes (abcm2ps…)
	if (syms.filter((x) => x.s in HEADS).length < 8) {
		const shp = shapeSymbols(raw, staves, sp);
		if (shp.filter((x) => x.s in HEADS).length >= 8) {
			syms.push(...shp);
			report.shapes = true;
		}
	}
	// têtes de notes (les petites : notes d'agrément, ignorées)
	const bigHead = median(syms.filter((s) => s.s in HEADS).map((s) => s.size)) ?? 4 * sp;
	const heads = syms
		.filter((s) => s.s in HEADS && s.size > 0.8 * bigHead)
		.map((s, i) => ({ id: i, kind: s.s, x: s.x, y: s.y, w: s.s === "head4" ? 1.7 * sp : s.s === "head0" ? 2.2 * sp : 1.18 * sp }));
	const V = verticals(raw, sp);
	const systems = findSystems(staves, V, raw);
	const out = [];
	const texts = markHyphens(mergeTexts(splitRuns(raw.texts.filter((t) => !familyOf(t.font)), raw.glyphs)), raw.segs);

	systems.forEach((sys, si) => {
		const top = sys[0].top - 8 * sp;
		const bot = sys[sys.length - 1].bot + 8 * sp;
		const prevBot = si > 0 ? systems[si - 1][systems[si - 1].length - 1].bot : -Infinity;
		const nextTop = si + 1 < systems.length ? systems[si + 1][0].top : Infinity;
		const lim0 = Math.max(top, (prevBot + sys[0].top) / 2);
		const lim1 = Math.min(bot, (sys[sys.length - 1].bot + nextTop) / 2);
		const inSys = (y) => y >= lim0 && y < lim1;
		const staffOf = (y) => {
			let best = 0;
			let bd = Infinity;
			sys.forEach((st, k) => {
				const d = y < st.top ? st.top - y : y > st.bot ? y - st.bot : 0;
				if (d < bd) {
					bd = d;
					best = k;
				}
			});
			return best;
		};
		const sSyms = syms.filter((s) => inSys(s.y));
		const sHeads = heads.filter((h) => inSys(h.y)).map((h) => ({ ...h, k: staffOf(h.y) }));
		const bars = barlines(sys, V, sHeads);
		const sV = V.filter((v) => v.y1 >= lim0 && v.y0 < lim1);

		// --- reprises : deux points dans les 2e et 3e interlignes, contre une barre
		// (le point de reprise SMuFL a son origine sur la ligne, une demi-interligne sous son centre)
		const repDots = sSyms.filter((d) => d.s === "dot" || d.s === "seg").map((d) => (d.s === "seg" ? Object.assign(d, { yc: d.y - 0.5 * (sys.find((st) => d.y > st.top - sp && d.y < st.bot + sp)?.sp ?? sp) }) : Object.assign(d, { yc: d.y })));
		const dotsAt = (b, side) => {
			let n = 0;
			for (const st of sys) {
				const ok = [1.5, 2.5].every((q) =>
					repDots.some((d) => Math.abs(d.yc - (st.bot - q * st.sp)) < 0.35 * st.sp && (side < 0 ? d.x < b - 0.1 * sp && d.x > b - 2.4 * sp : d.x > b + 0.1 * sp && d.x < b + 2.4 * sp)),
				);
				if (ok) n++;
			}
			return n >= Math.max(1, Math.ceil(0.6 * sys.length));
		};
		const markRep = (b, side) => {
			for (const d of repDots) if (side < 0 ? d.x < b - 0.1 * sp && d.x > b - 2.4 * sp : d.x > b + 0.1 * sp && d.x < b + 2.4 * sp) if (sys.some((st) => [1.5, 2.5].some((q) => Math.abs(d.yc - (st.bot - q * st.sp)) < 0.35 * st.sp))) d.rep = true;
		};
		const reps = bars.slice(0, -1).map(() => ({}));
		bars.forEach((b, i) => {
			if (i > 0 && dotsAt(b, -1)) {
				reps[i - 1].back = true;
				markRep(b, -1);
			}
			if (i < bars.length - 1 && dotsAt(b, 1)) {
				reps[i].fwd = true;
				markRep(b, 1);
			}
		});
		// reprise au début de la ligne, après la clé et l'armure (la barre n'est pas une barre de mesure)
		if (!reps[0]?.fwd) {
			const start = sV.filter((v) => v.x > bars[0] + sp && v.x < bars[0] + 9 * sp && sys.every((st) => v.y0 <= st.top + 0.3 * sp || v.y1 < st.top) && v.y0 <= sys[0].top + 0.3 * sp && v.y1 >= sys[0].bot - 0.3 * sp);
			for (const v of start) if (dotsAt(v.x, 1)) {
				reps[0].fwd = true;
				markRep(v.x, 1);
				break;
			}
		}
		// 1re et 2e fois : un crochet au-dessus de la portée du haut, avec son numéro
		const voltaSegs = raw.segs.filter((g) => Math.abs(g.y1 - g.y0) < 0.2 * sp && Math.abs(g.x1 - g.x0) > 5 * sp && g.y0 < sys[0].top - 0.8 * sp && g.y0 > sys[0].top - 7 * sp && Math.min(g.x0, g.x1) >= bars[0] - sp);
		for (const g of voltaSegs) {
			const xa = Math.min(g.x0, g.x1);
			const xb = Math.max(g.x0, g.x1);
			const hook = (x) => raw.segs.some((v) => Math.abs(v.x1 - v.x0) < 0.2 * sp && Math.abs(v.x0 - x) < 0.4 * sp && Math.min(v.y0, v.y1) <= g.y0 + 0.3 * sp && Math.max(v.y0, v.y1) > g.y0 + 0.8 * sp);
			if (!hook(xa)) continue;
			// pas un cadre (numéro de repère encadré)
			if (raw.segs.some((h) => h !== g && Math.abs(h.y1 - h.y0) < 0.2 * sp && h.y0 > g.y0 + 0.8 * sp && h.y0 < g.y0 + 2.5 * sp && h.y0 < sys[0].top - 0.3 * sp && Math.abs(Math.min(h.x0, h.x1) - xa) < 0.5 * sp)) continue;
			const num = texts.find((t) => /^[1-9][.,]?$/.test(t.str.trim()) && t.x > xa - 0.2 * sp && t.x < xa + 1.5 * sp && t.y > g.y0 && t.y < g.y0 + 3.5 * sp);
			if (!num) continue;
			const ms = reps.map((_, m) => m).filter((m) => bars[m + 1] > xa + 0.5 * sp && bars[m] < xb - 0.5 * sp);
			if (!ms.length) continue;
			const n = num.str.trim().replace(/[.,]/, "");
			reps[ms[0]].endStart = n;
			reps[ms[ms.length - 1]].endStop = { n, closed: hook(xb) };
		}

		// --- clés, armures, chiffrages par portée
		const staffInfo = sys.map((st, k) => {
			const mine = sSyms.filter((s) => staffOf(s.y) === k);
			const clefs = mine.filter((s) => s.s in CLEF_BASE).sort((a, b) => a.x - b.x).map((c) => ({ ...c }));
			// un petit « 8 » sous une clé de sol : clé de ténor (une octave plus bas)
			for (const c of clefs) {
				if (c.s !== "clefG") continue;
				if (mine.some((o) => o.s === "oct8" && Math.abs(o.x - c.x) < 2 * sp && o.y > sys[k].bot && o.y < sys[k].bot + 4 * sp)) c.s = "clefG8";
			}
			const accs = mine.filter((s) => s.s in ACC);
			// accidents attachés à une note : une tête à droite, à la même hauteur
			const attached = new Set();
			for (const a of accs) {
				const h = sHeads
					.filter((h) => h.k === k && h.x > a.x && h.x - a.x < 3.2 * sp && Math.abs(h.y - a.y) < 0.35 * sp)
					.sort((p, q) => p.x - q.x)[0];
				if (h) {
					attached.add(a);
					(h.acc ??= []).push(a);
				}
			}
			// armures : accidents non attachés, en grappe
			const free = accs.filter((a) => !attached.has(a)).sort((a, b) => a.x - b.x);
			const keys = [];
			for (const a of free) {
				const last = keys[keys.length - 1];
				if (last && a.x - last.x1 < 1.6 * sp) {
					last.items.push(a);
					last.x1 = a.x;
				} else keys.push({ x: a.x, x1: a.x, items: [a] });
			}
			const keySigs = keys.map((g) => {
				const f = g.items.filter((a) => a.s === "flat").length;
				const s = g.items.filter((a) => a.s === "sharp").length;
				return { x: g.x, fifths: s > f ? s : -f };
			});
			// chiffrages
			// chiffres de mesure : dans la portée, en grand (un petit « 3 » au-dessus d'une ligature : triolet)
			const digits = mine.filter((s) => (/^t\d$/.test(s.s) || s.s === "tC" || s.s === "tCut") && s.y > sys[k].top - 0.6 * sp && s.y < sys[k].bot + 3 * sp && s.size > 0.75 * bigHead);
			const times = [];
			for (const c of cluster(digits.map((d) => d.x), 1.5 * sp)) {
				const ds = digits.filter((d) => c.includes(d.x));
				const mid = (sys[k].top + sys[k].bot) / 2;
				if (ds.some((d) => d.s === "tC")) times.push({ x: c[0], beats: 4, type: 4 });
				else if (ds.some((d) => d.s === "tCut")) times.push({ x: c[0], beats: 2, type: 2 });
				else {
					const num = ds.filter((d) => d.y < mid).sort((a, b) => a.x - b.x).map((d) => d.s.slice(1)).join("");
					const den = ds.filter((d) => d.y > mid).sort((a, b) => a.x - b.x).map((d) => d.s.slice(1)).join("");
					if (num && den) times.push({ x: c[0], beats: Number(num), type: Number(den) });
				}
			}
			return { clefs, keySigs, times, mine };
		});

		// la clé en vigueur pour chaque tête (changements de clé en cours de ligne, clé de précaution en fin de mesure)
		for (const h of sHeads) {
			const cl = staffInfo[h.k].clefs.filter((c) => c.x < h.x).pop() ?? staffInfo[h.k].clefs[0];
			h.clef = cl?.s ?? null;
			h.pos = Math.round((sys[h.k].bot - h.y) / (sys[h.k].sp / 2));
		}

		// --- hampes, ligatures, crochets : les accords
		const beams = [];
		for (const f of raw.fills) {
			if (f.used || f.curved || f.stroked || f.pts.length >= 12 || !inSys((f.y0 + f.y1) / 2)) continue;
			if (f.x1 - f.x0 < 0.6 * sp) continue;
			const mid = spanAt(f.pts, (f.x0 + f.x1) / 2);
			if (!mid) continue;
			const th = mid[1] - mid[0];
			// Encore double chaque morceau de liaison d'un polygone droit : pas une ligature
			const twin = raw.fills.some((c) => c.curved && Math.abs(c.x0 - f.x0) < 0.25 * sp && Math.abs(c.x1 - f.x1) < 0.25 * sp && Math.abs(c.y0 - f.y0) < 0.25 * sp && Math.abs(c.y1 - f.y1) < 0.25 * sp);
			if (th > 0.25 * sp && th < 0.9 * sp && !twin) beams.push(f);
		}
		for (const s of raw.segs) {
			if (s.w > 0.3 * sp && s.w < 0.9 * sp && Math.abs(s.x1 - s.x0) > 0.6 * sp && inSys((s.y0 + s.y1) / 2)) {
				const hw = s.w / 2;
				beams.push({ pts: [[s.x0, s.y0 - hw], [s.x1, s.y1 - hw], [s.x1, s.y1 + hw], [s.x0, s.y0 + hw]], x0: Math.min(s.x0, s.x1), x1: Math.max(s.x0, s.x1) });
			}
		}
		const isBar = (v) => bars.some((b) => Math.abs(b - v.x) < 0.3 * sp) && sys.some((st) => v.y0 <= st.top + 0.3 * sp && v.y1 >= st.bot - 0.3 * sp);
		const stems = sV.filter((v) => v.y1 - v.y0 > 1.5 * sp && v.y1 - v.y0 < 14 * sp && v.w < 0.3 * sp && !isBar(v));
		const flags = sSyms.filter((s) => /^flag/.test(s.s));
		const chords = [];
		for (const st of stems) {
			const near = sHeads.filter(
				(h) =>
					(Math.abs(h.x - st.x) < 0.35 * sp || Math.abs(h.x + h.w - st.x) < 0.35 * sp) &&
					h.y >= st.y0 - 0.7 * sp &&
					h.y <= st.y1 + 0.7 * sp &&
					h.kind !== "head4" &&
					h.kind !== "head0",
			);
			if (!near.length) continue;
			const rightEdge = (h) => Math.abs(h.x + h.w - st.x) < 0.35 * sp;
			const leftEdge = (h) => Math.abs(h.x - st.x) < 0.35 * sp;
			const atBot = near.filter((h) => Math.abs(h.y - st.y1) < 0.7 * sp);
			const atTop = near.filter((h) => Math.abs(h.y - st.y0) < 0.7 * sp);
			// sens de la hampe : à droite de la tête de base, elle monte ; à gauche, elle descend
			let up;
			if (atBot.length && !atTop.length) up = true;
			else if (atTop.length && !atBot.length) up = false;
			else if (atBot.some(rightEdge) && !atTop.some(leftEdge)) up = true;
			else if (atTop.some(leftEdge) && !atBot.some(rightEdge)) up = false;
			else {
				const my = near.reduce((a, h) => a + h.y, 0) / near.length;
				up = my > (st.y0 + st.y1) / 2;
			}
			const base = up ? st.y1 : st.y0;
			const end = up ? st.y0 : st.y1;
			const len = st.y1 - st.y0;
			// une tête au bout libre de la hampe appartient à une autre voix (deux voix entrecroisées)
			const on0 = near.filter((h) => Math.abs(h.y - base) <= Math.max(0.7 * sp, len - 1.8 * sp) + 0.01);
			// deux têtes superposées (unisson de deux voix, une tête par voix) : une seule par hampe
			const on = on0.filter((h, i) => !on0.slice(0, i).some((g) => Math.abs(g.x - h.x) < 0.25 * sp && Math.abs(g.y - h.y) < 0.2 * sp));
			if (!on.length) continue;
			const my = on.reduce((a, h) => a + h.y, 0) / on.length;
			// têtes du côté normal de la hampe (pour placer l'accord)
			const main = on.filter((h) => (up ? rightEdge(h) : leftEdge(h)));
			const onStem = [];
			for (const b of beams) {
				if (st.x < b.x0 - 0.2 * sp || st.x > b.x1 + 0.2 * sp) continue;
				const sp_ = spanAt(b.pts, Math.min(Math.max(st.x, b.x0 + 0.01), b.x1 - 0.01));
				if (!sp_) continue;
				const c = (sp_[0] + sp_[1]) / 2;
				if (up ? c >= end - 0.5 * sp && c <= end + 3.2 * sp : c <= end + 0.5 * sp && c >= end - 3.2 * sp) onStem.push({ b, c });
			}
			// une ligature d'une autre voix (ou de l'autre portée) qui croise la hampe : pente différente
			const slope = (b) => {
				const a = spanAt(b.pts, b.x0 + 0.01);
				const z = spanAt(b.pts, b.x1 - 0.01);
				return a && z && b.x1 - b.x0 > 0.5 ? ((z[0] + z[1]) / 2 - (a[0] + a[1]) / 2) / (b.x1 - b.x0) : 0;
			};
			let nb = onStem.length;
			if (nb > 1) {
				const prim = onStem.sort((p, q) => Math.abs(p.c - end) - Math.abs(q.c - end))[0];
				const s0 = slope(prim.b);
				nb = onStem.filter((o) => o === prim || Math.abs(slope(o.b) - s0) < 0.06 || o.b.x1 - o.b.x0 < 2 * sp).length;
			}
			let nf = 0;
			for (const f of flags) {
				const along = f.y >= st.y0 - 2 * sp && f.y <= st.y1 + 2 * sp;
				const fx = Math.abs(f.x - st.x) < 0.5 * sp || (Math.abs(f.x - (on[0]?.x ?? -99)) < 0.3 * sp && /Anastasia/.test(f.font ?? ""));
				if (fx && (Math.abs(f.y - end) < 2 * sp || (along && /Anastasia/.test(f.font ?? "")))) nf = Math.max(nf, /16/.test(f.s) ? 2 : /32/.test(f.s) ? 3 : 1);
			}
			const kind = on.some((h) => h.kind === "head2") ? "head2" : "head1";
			const beamsN = nb + nf;
			chords.push({
				x: (main.length ? main : on)[0].x,
				heads: on,
				main,
				up,
				stem: st,
				beams: beamsN,
				dur: kind === "head2" ? 2 : 1 / 2 ** beamsN,
				k: staffOf(my),
			});
		}
		// rondes et brèves (sans hampe), et têtes restées seules
		const taken = new Set(chords.flatMap((c) => c.heads.map((h) => h.id)));
		// la tête doublée d'un unisson (une par voix) est prise avec sa jumelle
		const takenHeads = chords.flatMap((c) => c.heads);
		for (const h of sHeads) if (!taken.has(h.id) && takenHeads.some((g) => g.k === h.k && Math.abs(g.x - h.x) < 0.25 * sp && Math.abs(g.y - h.y) < 0.2 * sp)) taken.add(h.id);
		const lone = sHeads.filter((h) => !taken.has(h.id));
		const loneChords = [];
		for (const c of cluster(lone.map((h) => h.x), 0.5 * sp)) {
			const hs = lone.filter((h) => c.includes(h.x));
			for (const k of new Set(hs.map((h) => h.k))) {
				const mine = hs.filter((h) => h.k === k);
				const kind = mine[0].kind;
				// une seconde : la tête décalée à côté de l'autre appartient au même accord
				const prev = loneChords.find((o) => o.k === k && o.heads[0].kind === kind && mine[0].x - o.x > 0 && mine[0].x - o.x < 2.3 * sp && o.heads.some((a) => mine.some((b) => Math.abs(a.y - b.y) <= 0.55 * sp)));
				if (prev) prev.heads.push(...mine);
				else loneChords.push({ x: mine[0].x, heads: mine, up: null, beams: 0, dur: HEADS[kind] ?? 1, k, lone: kind === "head1" || kind === "head2" });
			}
		}
		chords.push(...loneChords);
		// têtes partagées entre deux hampes (voix à la seconde ou à l'unisson) : une tête blanche ne va
		// pas avec des noires ; elle reste à l'accord dont toutes les têtes sont de son espèce
		for (const ch of chords) {
			if (!ch.stem) continue;
			const kinds = new Set(ch.heads.map((h) => (h.kind === "head2" ? 2 : 1)));
			if (kinds.size < 2) continue;
			const other = (h) => chords.some((o) => o !== ch && o.heads.includes(h) && o.heads.every((x) => (x.kind === "head2") === (h.kind === "head2")));
			let keep = ch.heads.filter((h) => !other(h));
			// sinon : l'espèce des têtes du côté normal de la hampe
			if (keep.length === ch.heads.length && ch.main?.length) {
				const k0 = ch.main[0].kind === "head2";
				if (ch.main.every((h) => (h.kind === "head2") === k0)) keep = ch.heads.filter((h) => (h.kind === "head2") === k0);
			}
			if (keep.length && keep.length < ch.heads.length) {
				ch.heads = keep;
				const half = keep.every((h) => h.kind === "head2");
				ch.dur = half ? 2 : 1 / 2 ** ch.beams;
			}
		}
		// points de prolongation : chaque point à l'accord dont une tête est la plus proche
		const dots = sSyms.filter((s) => s.s === "dot" && !s.rep);
		for (const ch of chords) ch.dots = 0;
		const dotCols = new Map();
		for (const d of dots) {
			const cand = [];
			for (const ch of chords) {
				const right = Math.max(...ch.heads.map((h) => h.x + h.w));
				const ssp = sys[ch.k].sp; // l'interligne de cette portée (orgue plus grand que le chœur…)
				if (d.x <= right - 0.1 * ssp || d.x >= right + 2.2 * ssp) continue;
				const dy = Math.min(...ch.heads.map((h) => Math.abs(d.y - h.y)));
				// tête sur une ligne : son point est dans l'interligne voisin
				const dyl = Math.min(...ch.heads.map((h) => (h.pos % 2 === 0 ? Math.abs(Math.abs(d.y - h.y) - 0.5 * ssp) : Math.abs(d.y - h.y))));
				if (dy < 0.65 * ssp) cand.push({ ch, dy: Math.min(dy, dyl), right });
			}
			if (!cand.length) continue;
			const bd = Math.min(...cand.map((c) => c.dy));
			// à égalité (tête partagée par deux voix) : le point vaut pour les deux,
			// sauf si l'une des têtes est décalée (seconde) : le point suit la plus à droite
			let near = cand.filter((c) => c.dy <= bd + 0.1 * sp);
			const rmax = Math.max(...near.map((c) => c.right));
			near = near.filter((c) => c.right >= rmax - 0.3 * sp);
			for (const { ch } of near) {
				if (!dotCols.has(ch)) dotCols.set(ch, []);
				dotCols.get(ch).push(d.x);
				if (near.length > 1) ch.sharedDot = true;
			}
		}
		for (const [ch, xs] of dotCols) {
			const n = Math.min(2, cluster(xs, 0.3 * sp).length);
			ch.dur *= n === 1 ? 1.5 : 1.75;
			ch.dots = n;
		}
		// silences
		const rests = [];
		for (const s of sSyms) {
			let d = null;
			if (s.s in RESTS) d = RESTS[s.s];
			else if (s.s === "restBox") {
				const st = sys[staffOf(s.y)];
				d = (st.bot - s.y) / (sp / 2) > 5 ? 4 : 2;
			}
			if (d === null) continue;
			const k = staffOf(s.y);
			const ds = dots.filter((t) => t.x > s.x + 0.5 * sp && t.x < s.x + 2.5 * sp && Math.abs(t.y - s.y) < 1.2 * sp);
			const n = cluster(ds.map((t) => t.x), 0.3 * sp).length;
			rests.push({ x: s.x, y: s.y, dur: d * (n === 1 ? 1.5 : n === 2 ? 1.75 : 1), k, whole: s.s === "rest4" || (s.s === "restBox" && d === 4), rest: true });
		}
		// triolets : un « 3 » (glyphe de n-olet ou texte) au-dessus ou au-dessous d'un groupe lié
		const threes = [
			...sSyms.filter((s) => s.s === "tu3"),
			...sSyms.filter((s) => s.s === "t3" && s.size < 0.75 * bigHead),
			...texts.filter((t) => t.str.trim() === "3" && inSys(t.y)).map((t) => ({ x: t.x, y: t.y })),
		];
		for (const t of threes) {
			// les accords dont la hampe aboutit à une ligature
			const onB = (b) =>
				chords.filter((c) => {
					if (!c.beams) return false; // une noire dont la hampe frôle la ligature voisine
					if (!c.stem || c.stem.x < b.x0 - 0.3 * sp || c.stem.x > b.x1 + 0.3 * sp) return false;
					const sp_ = spanAt(b.pts, Math.min(Math.max(c.stem.x, b.x0 + 0.01), b.x1 - 0.01));
					if (!sp_) return false;
					const end = c.up ? c.stem.y0 : c.stem.y1;
					return end >= sp_[0] - 0.6 * sp && end <= sp_[1] + 0.6 * sp;
				});
			// un triolet vaut trois valeurs égales : 3 doubles, 3 croches, 3 noires (ou 2 notes et un silence)
			const tripletLike = (g) => {
				if (!g.length || g.some((c) => c.tuplet)) return false;
				const sum = g.reduce((a, c) => a + c.dur, 0);
				if ([0.375, 0.75, 1.5, 3].some((v) => Math.abs(sum - v) < 1e-6)) return true;
				// deux notes égales : le silence complète le triolet
				return g.length === 2 && Math.abs(g[0].dur - g[1].dur) < 1e-6 && !g.some((c) => c.dots);
			};
			const b = beams
				.filter((b) => t.x >= b.x0 - sp && t.x <= b.x1 + sp)
				.map((b) => {
					const sp_ = spanAt(b.pts, Math.min(Math.max(t.x, b.x0 + 0.01), b.x1 - 0.01));
					return { b, d: sp_ ? Math.min(Math.abs(sp_[0] - t.y), Math.abs(sp_[1] - t.y)) : 1e9 };
				})
				.filter((o) => o.d < 3.5 * sp && tripletLike(onB(o.b)))
				.sort((p, q) => p.d - q.d)[0]?.b;
			let group = [];
			// crochet de n-olet : traits horizontaux à la hauteur du « 3 », de part et d'autre
			const hseg = raw.segs.filter((g) => Math.abs(g.y0 - g.y1) < 0.6 * sp && Math.abs((g.y0 + g.y1) / 2 - t.y) < 1.3 * sp && Math.abs(g.x1 - g.x0) > 0.4 * sp && Math.abs(g.x1 - g.x0) < 12 * sp);
			const left = hseg.filter((g) => Math.max(g.x0, g.x1) <= t.x + 0.2 * sp && Math.max(g.x0, g.x1) > t.x - 2.5 * sp);
			const right = hseg.filter((g) => Math.min(g.x0, g.x1) >= t.x && Math.min(g.x0, g.x1) < t.x + 3 * sp);
			const kOf = sys.map((st, j) => ({ j, d: t.y < st.top ? st.top - t.y : t.y > st.bot ? t.y - st.bot : 0 })).sort((p, q) => p.d - q.d)[0].j;
			if (!b && left.length && right.length) {
				const x0 = Math.min(...left.map((g) => Math.min(g.x0, g.x1)));
				const x1 = Math.max(...right.map((g) => Math.max(g.x0, g.x1)));
				const inside = chords.filter((c) => c.x >= x0 - 0.5 * sp && c.x <= x1 + 0.2 * sp);
				// la portée dont les notes (têtes ou bouts de hampe) sont les plus proches du crochet
				const dist = (c) => Math.min(...c.heads.map((h) => h.y).concat(c.stem ? [c.stem.y0, c.stem.y1] : []).map((y) => Math.abs(y - t.y)));
				const kk = inside.length ? inside.sort((p, q) => dist(p) - dist(q))[0].k : kOf;
				group = inside.filter((c) => c.k === kk);
				group.push(...rests.filter((r) => r.k === kk && r.x >= x0 - 0.5 * sp && r.x <= x1 + 0.2 * sp));
			} else if (b) {
				group = onB(b);
				// un triolet qui commence ou finit par un silence : deux notes liées et ce silence
				if (group.length === 2) {
					const xs = group.map((c) => c.x).sort((a, b) => a - b);
					const r = rests
						.filter((r) => r.k === group[0].k && !r.tuplet && ((r.x < xs[0] && xs[0] - r.x < 3 * sp) || (r.x > xs[1] && r.x - xs[1] < 3 * sp)))
						.sort((a, b) => Math.abs(a.x - t.x) - Math.abs(b.x - t.x))[0];
					if (r) group.push(r);
				}
			}
			else {
				// triolet sans ligature : la note sous le « 3 » et ses deux voisines de la même portée
				const reach = (c) => {
					const ys = c.heads.map((h) => h.y).concat(c.stem ? [c.stem.y0, c.stem.y1] : []);
					return Math.min(...ys.map((y) => Math.abs(y - t.y))) + 0.5 * Math.abs(c.x - t.x);
				};
				const near = chords.filter((c) => Math.abs(c.x - t.x) < 8 * sp && reach(c) < 6 * sp).sort((p, q) => reach(p) - reach(q));
				if (near.length) {
					const k = near[0].k;
					const row = chords.filter((c) => c.k === k).sort((p, q) => p.x - q.x);
					const i = row.indexOf(near[0]);
					// le « 3 » est au milieu du groupe
					const cand = [row.slice(i - 1, i + 2), row.slice(i, i + 3), row.slice(i - 2, i + 1)].filter((g) => g.length === 3);
					cand.sort((a, b) => Math.abs((a[0].x + a[2].x) / 2 - t.x) - Math.abs((b[0].x + b[2].x) / 2 - t.x));
					group = cand[0] ?? [];
				}
			}
			for (const c of group) if (!c.tuplet) {
				c.dur = (c.dur * 2) / 3;
				c.tuplet = true;
			}
		}
		// un point partagé ne va pas à une note de triolet (c'est celui de l'autre voix)
		for (const c of chords) {
			if (c.tuplet && c.sharedDot && c.dots === 1) {
				c.dur /= 1.5;
				c.dots = 0;
			}
		}
		// triolets « simile » : après des triolets marqués, les groupes de croches suivants de même
		// allure (trois croches liées, ou deux et un demi-soupir) sont des triolets sans le « 3 »
		const onBeam = (b) =>
			chords.filter((c) => {
				if (!c.stem || c.stem.x < b.x0 - 0.3 * sp || c.stem.x > b.x1 + 0.3 * sp) return false;
				const sp_ = spanAt(b.pts, Math.min(Math.max(c.stem.x, b.x0 + 0.01), b.x1 - 0.01));
				if (!sp_) return false;
				const end = c.up ? c.stem.y0 : c.stem.y1;
				return end >= sp_[0] - 0.6 * sp && end <= sp_[1] + 0.6 * sp;
			});
		for (const b of beams) {
			const g = onBeam(b);
			if (!g.length || g.length > 3 || g.some((c) => c.tuplet || Math.abs(c.dur - 0.5) > 1e-6)) continue;
			const k = g[0].k;
			const up = g[0].up;
			const marked = chords.some((c) => c.tuplet && c.k === k && c.up === up && Math.abs(c.dur - 1 / 3) < 1e-6);
			if (!marked) continue;
			let grp = g;
			if (g.length === 2) {
				const xs = g.map((c) => c.x).sort((a, z) => a - z);
				const r = rests.find((r) => r.k === k && !r.tuplet && Math.abs(r.dur - 0.5) < 1e-6 && ((r.x < xs[0] && xs[0] - r.x < 3 * sp) || (r.x > xs[1] && r.x - xs[1] < 3 * sp)));
				if (!r) continue;
				grp = [...g, r];
			}
			for (const c of grp) {
				c.dur = (c.dur * 2) / 3;
				c.tuplet = true;
			}
		}
		// liaisons de prolongation
		// une courbe, ou une courbe aplatie en polygone de nombreux points ; les morceaux bout à bout
		// (Encore dessine une liaison en plusieurs tronçons, chacun en double) sont réunis
		const tiePieces = raw.fills
			.filter((f) => !f.used && (f.curved || f.pts.length >= 12) && inSys((f.y0 + f.y1) / 2))
			.map((f) => ({ x0: f.x0, x1: f.x1, y0: f.y0, y1: f.y1 }))
			.sort((a, b) => a.x0 - b.x0);
		const curves = [];
		for (const f of tiePieces) {
			const dup = curves.find((c) => Math.abs(c.x0 - f.x0) < 0.3 * sp && Math.abs(c.x1 - f.x1) < 0.3 * sp && Math.abs(c.y0 - f.y0) < 0.4 * sp);
			if (dup) continue;
			// pas à travers une note : deux liaisons qui s'enchaînent restent deux liaisons
			const prev = curves.find(
				(c) =>
					Math.abs(c.x1 - f.x0) < 0.3 * sp &&
					Math.abs(c.y0 - f.y0) < 0.6 * sp &&
					Math.abs(c.y1 - f.y1) < 0.6 * sp &&
					!sHeads.some((h) => h.x < f.x0 + 0.5 * sp && h.x + h.w > f.x0 - 1.5 * sp && Math.abs(h.y - (f.y0 + f.y1) / 2) < 1.5 * sp),
			);
			if (prev) {
				prev.x1 = Math.max(prev.x1, f.x1);
				prev.y0 = Math.min(prev.y0, f.y0);
				prev.y1 = Math.max(prev.y1, f.y1);
			} else curves.push({ ...f });
		}
		for (const f of curves) {
			const w = f.x1 - f.x0;
			if (w < 0.8 * sp || f.y1 - f.y0 > 2 * sp) continue;
			const cy = (f.y0 + f.y1) / 2;
			const a = sHeads.filter((h) => Math.abs(h.x + h.w - f.x0) < 1.2 * sp && Math.abs(h.y - cy) < 1.5 * sp).sort((p, q) => Math.abs(p.y - cy) - Math.abs(q.y - cy))[0];
			const b = sHeads.filter((h) => Math.abs(h.x - f.x1) < 1.2 * sp && Math.abs(h.y - cy) < 1.5 * sp).sort((p, q) => Math.abs(p.y - cy) - Math.abs(q.y - cy))[0];
			if (a && b && a !== b && Math.abs(a.y - b.y) < 0.2 * sp && a.k === b.k) {
				a.tieStart = true;
				b.tieStop = true;
			} else if (a && !b && f.x1 > Math.max(...sys.map((s) => s.x1)) - 2 * sp) a.tieStart = true;
			// demi-liaison en début de ligne : elle aboutit à la première note de la portée (après clé et armure)
			else if (b && !a && f.x0 < bars[1] && (f.x0 < Math.min(...sys.map((q) => q.x0)) + 8 * sp || (f.x1 - f.x0 < 4 * sp && Math.abs(b.y - cy) < sp)) && !sHeads.some((h) => h.x < b.x - 0.5 * sp && h.k === b.k)) b.tieStop = true;
		}
		// paroles : textes sous chaque portée
		const lyr = sys.map(() => []);
		for (const t of texts) {
			if (!inSys(t.y)) continue;
			const k = sys.findIndex((st, j) => t.y > st.bot + 0.8 * sp && t.y < (j + 1 < sys.length ? sys[j + 1].top - 0.3 * sp : st.bot + 9 * sp));
			if (k < 0) continue;
			const str = t.str.trim();
			if (DYN.test(str) || t.x < sys[k].x0 || !/\p{L}/u.test(str)) continue; // chiffres (triolets, doigtés) : pas des paroles
			lyr[k].push({ ...t, str });
		}
		// couplets : une ligne de paroles par couplet, numérotées de haut en bas sur tout le système
		for (const L of lyr) {
			const ys = cluster(L.map((l) => l.y), 0.6 * sp);
			for (const l of L) l.verse = ys.findIndex((c) => c.includes(l.y)) + 1;
		}

		// --- mesures
		const nM = bars.length - 1;
		const measures = [];
		for (let m = 0; m < nM; m++) {
			const xa = bars[m];
			const xb = bars[m + 1];
			const ms = sys.map((st, k) => {
				const info = staffInfo[k];
				const inM = (x) => x >= xa - 0.2 * sp && x < xb - 0.2 * sp;
				const evs = [...chords.filter((c) => c.k === k && inM(c.x)), ...rests.filter((r) => r.k === k && inM(r.x))];
				const clef = [...info.clefs].filter((c) => c.x < xb).pop();
				const clefIn = info.clefs.filter((c) => inM(c.x) || (m === 0 && c.x < xa + 0.2 * sp));
				const keyIn = info.keySigs.filter((g) => inM(g.x) || (m === 0 && g.x < xa));
				const timeIn = info.times.filter((g) => inM(g.x));
				return { evs, clef: clef?.s ?? null, clefIn: clefIn.pop()?.s ?? null, keyIn: keyIn.pop()?.fifths ?? null, timeIn: timeIn[0] ?? null, lyrics: lyr[k].filter((t) => inM(t.x + 0.5 * sp)) };
			});
			measures.push(ms);
		}
		// accolades (piano, orgue) : un glyphe « { », ou une courbe pleine haute et étroite à gauche
		const braces = [];
		for (const g of syms.filter((x) => x.s === "brace" && x.x < sys[0].x0 + sp)) braces.push({ y0: g.y - g.size, y1: g.y });
		const pieces = raw.fills
			.filter((f) => (f.curved || f.pts.length >= 12) && f.x1 <= sys[0].x0 + 0.5 * sp && f.x1 > sys[0].x0 - 5 * sp && f.y1 - f.y0 > 3 * sp && f.x1 - f.x0 < 3 * sp && inSys((f.y0 + f.y1) / 2))
			.sort((a, b) => a.y0 - b.y0);
		// une accolade dessinée en deux moitiés : réunies
		for (const f of pieces) {
			const last = braces[braces.length - 1];
			if (last && last.curve && f.y0 <= last.y1 + 0.5 && Math.abs(f.x0 - last.x0) < sp) last.y1 = Math.max(last.y1, f.y1);
			else braces.push({ y0: f.y0, y1: f.y1, x0: f.x0, curve: true });
		}
		// un crochet de chœur n'est pas une accolade : les portées avec paroles restent séparées
		const sung = sys.map((_, k) => lyr[k].length > 0);
		// indications de tempo au-dessus du système : « ♩ = 120 »
		const tempos = [];
		for (const eq of raw.glyphs) {
			if (eq.ch !== "=" || familyOf(eq.font)) continue;
			if (!(eq.y < sys[0].top && eq.y > lim0 - 4 * sp)) continue;
			const line = raw.glyphs.filter((g) => Math.abs(g.y - eq.y) < 0.4 * eq.size);
			const num = line.filter((g) => g.x > eq.x && g.x < eq.x + 3.5 * eq.size && /\d/.test(g.ch) && !familyOf(g.font)).sort((a, b) => a.x - b.x);
			let digits = "";
			for (const g of num) {
				if (digits && g.x - num[num.indexOf(g) - 1].x > eq.size) break;
				digits += g.ch;
			}
			const bpm = Number(digits);
			if (!(bpm >= 20 && bpm <= 300)) continue;
			const left = line.filter((g) => g.x < eq.x && g.x > eq.x - 3 * eq.size).sort((a, b) => b.x - a.x);
			let unit = 1;
			for (const g of left) {
				const u = g.uni;
				if (u === 0xe1d3 || u === 0xe1d4 || u === 0xeca3 || u === 0xeca4 || g.ch === "h") unit = 2;
				else if (u === 0xe1d7 || u === 0xe1d8 || u === 0xeca7 || u === 0xeca8 || g.ch === "e") unit = 0.5;
				else if (u === 0xe1d5 || u === 0xe1d6 || u === 0xeca5 || u === 0xeca6 || g.ch === "q") unit = 1;
				else continue;
				if (left.some((d) => d.x > g.x && d.x < eq.x && (d.uni === 0xe1e7 || d.uni === 0xecb7 || d.ch === "."))) unit *= 1.5;
				break;
			}
			tempos.push({ x: eq.x, bpm: Math.round(bpm * unit) });
		}
		// numéro de mesure imprimé au-dessus de la 1re mesure du système (pour numéroter comme la partition)
		const mnum = (() => {
			const top = sys[0].top;
			const c = texts
				.filter((t) => /^\d{1,3}$/.test(t.str.trim()) && t.size < 3 * sp && t.y < top - 0.2 * sp && t.y > top - 4.5 * sp && t.x > bars[0] - 2 * sp && t.x < bars[1] - 0.5 * sp)
				.filter((t) => !texts.some((u) => u !== t && /[=♩]/.test(u.str) && Math.abs(u.y - t.y) < sp && Math.abs(u.x - t.x) < 4 * sp))
				.filter((t) => !voltaSegs.some((g) => Math.abs(Math.min(g.x0, g.x1) - t.x) < 2 * sp && t.y > g.y0 && t.y < g.y0 + 3.5 * sp))
				.sort((a, b) => a.x - b.x);
			return c.length ? Number(c[0].str.trim()) : null;
		})();
		out.push({ staves: sys, bars, reps, mnum, measures, chords, rests, braces: braces.filter((b) => b.y1 - b.y0 > 6 * sp), sung, tempos });
	});
	report.notes = out.reduce((a, s) => a + s.chords.reduce((b, c) => b + c.heads.length, 0), 0);
	report.rests = out.reduce((a, s) => a + s.rests.length, 0);
	return { systems: out, report, staves, sp };
}

// ---------------------------------------------------------------- MusicXML

const TYPES = [
	[8, "breve"], [4, "whole"], [2, "half"], [1, "quarter"], [0.5, "eighth"], [0.25, "16th"], [0.125, "32nd"],
];
function noteType(dur, dots, tuplet) {
	let base = dur / (dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1);
	if (tuplet) base = (base * 3) / 2;
	const t = TYPES.find(([d]) => Math.abs(d - base) < 1e-6);
	return t ? t[1] : null;
}

/**
 * Les voix d'une portée dans une mesure. Chaque colonne (événements alignés) commence à un temps :
 * le plus petit des temps « fin d'un événement précédent » qui suit la colonne d'avant ; puis les
 * événements s'enchaînent en voix (une voix continue là où elle s'arrête), hampes en haut d'abord.
 * Renvoie [{ start, evs }].
 */
function voicesOf(evs, sp) {
	if (!evs.length) return [];
	const xs = cluster(evs.map((e) => e.x), 0.45 * sp);
	const cols0 = xs.map((c) => evs.filter((e) => c.includes(e.x)));
	// deux voix à l'unisson (ou à la seconde) décalées l'une de l'autre : un seul temps
	const cols = [];
	for (const col of cols0) {
		const prev = cols[cols.length - 1];
		const dirs = (c) => new Set(c.filter((e) => !e.rest).map((e) => e.up));
		const ys = (c) => c.flatMap((e) => (e.heads ? e.heads.map((h) => h.y) : []));
		const gap = prev ? col[0].x - Math.max(...prev.map((e) => e.x)) : Infinity;
		// écart toléré : une tête ; davantage si un point ou une tête large (blanche, ronde) les sépare
		const wide = prev && (prev.some((e) => !e.rest && (e.dots || e.dur >= 2)) || col.some((e) => !e.rest && e.dur >= 2 && !e.dots));
		const second = prev && ys(col).some((y) => ys(prev).some((z) => Math.abs(y - z) <= 0.6 * sp));
		if (
			prev &&
			col.every((e) => !e.rest) &&
			((second && gap < (wide ? 2.4 : 1.5) * sp && ![...dirs(col)].some((d) => dirs(prev).has(d))) || (gap < 0.9 * sp && Math.min(...col.map((e) => e.dur), ...prev.map((e) => e.dur)) >= 1))
		) prev.push(...col);
		else cols.push([...col]);
	}
	const times = [0];
	for (let i = 1; i < cols.length; i++) {
		const prev = times[i - 1];
		let best = Infinity;
		for (let j = 0; j < i; j++) for (const e of cols[j]) {
			const t = times[j] + e.dur;
			if (t > prev + 1e-6 && t < best) best = t;
		}
		times.push(best === Infinity ? prev + Math.min(...cols[i - 1].map((e) => e.dur)) : best);
	}
	const voices = [];
	const rank = (e) => (e.up === true ? 0 : e.up === null || e.up === undefined ? (e.rest && !e.high ? 2 : 1) : 2);
	cols.forEach((col, i) => {
		const T = times[i];
		const order = [...col].sort((a, b) => rank(a) - rank(b) || (a.heads?.[0]?.y ?? a.y) - (b.heads?.[0]?.y ?? b.y));
		const usedHere = new Set();
		for (const e of order) {
			const free = voices.filter((v) => !usedHere.has(v) && Math.abs(v.end - T) < 1e-6);
			let v = free.find((w) => w.dir === rank(e)) ?? free[0];
			if (!v) {
				// une voix qui reprend après un silence non écrit, ou qui commence plus tard
				v = voices.filter((w) => !usedHere.has(w) && w.end < T - 1e-6).sort((a, b) => b.end - a.end)[0];
				if (v) v.evs.push({ gap: T - v.end });
				else {
					v = { start: T, end: T, evs: [], dir: rank(e) };
					voices.push(v);
				}
			}
			v.evs.push(e);
			v.end = T + e.dur;
			v.dir = rank(e);
			usedHere.add(v);
		}
		// deux voix sur une seule hampe (accord) : la voix restée sans note prend sa tête
		const lastY = (v) => {
			for (let i = v.evs.length - 1; i >= 0; i--) {
				const e = v.evs[i];
				if (e.heads?.length) return e.heads.reduce((s, h) => s + h.y, 0) / e.heads.length;
			}
			return null;
		};
		for (const v of voices) {
			if (usedHere.has(v) || Math.abs(v.end - T) > 1e-6) continue;
			const vy = lastY(v);
			if (vy === null) continue;
			let owner = voices.find((w) => usedHere.has(w) && w.evs.length && w.evs[w.evs.length - 1].heads?.length > 1 && col.includes(w.evs[w.evs.length - 1]));
			if (!owner) {
				// une seule note pour les deux voix qui se rejoignent (unisson implicite)
				const solo = col.length === 1 && !col[0].rest && col[0].heads?.length === 1 ? col[0] : null;
				const last = v.evs[v.evs.length - 1];
				owner = solo && last?.heads ? voices.find((w) => w !== v && w.evs[w.evs.length - 1] === solo) : null;
				if (owner) {
					v.evs.push({ ...solo, split: true });
					v.end = T + solo.dur;
					usedHere.add(v);
				}
				continue;
			}
			const ch = owner.evs[owner.evs.length - 1];
			const oy = lastY({ evs: owner.evs.slice(0, -1) });
			if (oy === null || Math.abs(oy - vy) < 1e-6) continue;
			const hs = [...ch.heads].sort((a, b) => a.y - b.y);
			const below = vy > oy;
			const mine = below ? hs.slice(-1) : hs.slice(0, 1);
			const keep = below ? hs.slice(0, -1) : hs.slice(1);
			owner.evs[owner.evs.length - 1] = { ...ch, heads: keep };
			v.evs.push({ ...ch, heads: mine, split: true });
			v.end = T + ch.dur;
			v.dir = below ? 2 : 0;
			usedHere.add(v);
		}
		// un silence écrit une fois pour deux voix : rendu à chacune
		for (const r of col.filter((e) => e.rest)) {
			for (const v of voices) {
				if (!usedHere.has(v) && Math.abs(v.end - T) < 1e-6) {
					v.evs.push({ ...r });
					v.end = T + r.dur;
					usedHere.add(v);
				}
			}
		}
	});
	return voices;
}

/**
 * Arbres MusicXML (un par système), à joindre avec joinTrees.
 * `ctx` porte d'un système à l'autre la clé, l'armure et le chiffrage de chaque partie.
 */
export function systemTrees(page, ctx) {
	const trees = [];
	const sp = page.sp;
	for (const sys of page.systems) {
		const n = sys.staves.length;
		const root = new El("score-partwise", { version: "4.0" });
		const pl = root.sub("part-list");
		// une accolade réunit deux portées (piano, orgue) : une partie sur deux portées
		const groups = [];
		for (let k = 0; k < n; k++) {
			if (k + 1 < n && !sys.sung?.[k] && !sys.sung?.[k + 1] && sys.braces?.some((b) => b.y0 <= sys.staves[k].top + sp && b.y1 >= sys.staves[k + 1].bot - sp && b.y0 >= sys.staves[k].top - 3 * sp && b.y1 <= sys.staves[k + 1].bot + 3 * sp)) {
				groups.push([k, k + 1]);
				k++;
			} else groups.push([k]);
		}
		const parts = groups.map((g, i) => {
			const sc = pl.sub("score-part", null, { id: `P${i + 1}` });
			sc.sub("part-name", `Part ${i + 1}`);
			return root.sub("part", null, { id: `P${i + 1}` });
		});
		// les hauts silences (au-dessus de la ligne du milieu) : voix du haut
		for (const r of sys.rests) {
			const st = sys.staves[r.k];
			r.high = r.y < (st.top + st.bot) / 2 - 0.2 * sp;
		}
		sys.measures.forEach((ms, m) => {
			groups.forEach((grp, gi) => {
			const meas = parts[gi].sub("measure", null, { number: m + 1 });
			const attrs = new El("attributes");
			if (m === 0) attrs.sub("divisions", DIV);
			if (m === 0 && grp.length > 1) attrs.sub("staves", grp.length);
			meas.children.push(attrs);
			const rp = sys.reps?.[m] ?? {};
			if (rp.fwd || rp.endStart) {
				const bl = meas.sub("barline", null, { location: "left" });
				if (rp.fwd) bl.sub("bar-style", "heavy-light");
				if (rp.endStart) bl.sub("ending", null, { number: rp.endStart, type: "start" });
				if (rp.fwd) bl.sub("repeat", null, { direction: "forward" });
			}
			let cursor = 0;
			if (gi === 0) {
				const tp = (sys.tempos ?? []).find((t) => (m === 0 && t.x < sys.bars[1]) || (t.x >= sys.bars[m] && t.x < sys.bars[m + 1]));
				if (tp) {
					const dir = meas.sub("direction", null, { placement: "above" });
					const met = dir.sub("direction-type").sub("metronome");
					met.sub("beat-unit", "quarter");
					met.sub("per-minute", tp.bpm);
					dir.sub("sound", null, { tempo: tp.bpm });
				}
			}
			grp.forEach((k, si) => {
				const c = (ctx.staff[k] ??= { clef: null, fifths: 0, time: null });
				const cell = ms[k];
				const voiceBase = 4 * si;
				const staffNo = grp.length > 1 ? si + 1 : null;
				if (si > 0 && cursor > 1e-6) meas.sub("backup").sub("duration", Math.round(cursor * DIV));
				if (cell.keyIn !== null && (m === 0 || cell.keyIn !== c.fifths)) c.fifths = cell.keyIn;
				else if (m === 0 && cell.keyIn === null && ctx.firstSystem) c.fifths = c.fifths ?? 0;
				if (si === 0 && (m === 0 || cell.keyIn !== null)) attrs.sub("key").sub("fifths", c.fifths);
				const tm = cell.timeIn ?? (k > 0 ? ms.find((x) => x.timeIn)?.timeIn : null) ?? ms.find((x) => x.timeIn)?.timeIn;
				if (tm) c.time = tm;
				else if (ctx.time && !c.time) c.time = ctx.time;
				if (si === 0 && c.time && (m === 0 || tm)) {
					const t = attrs.sub("time");
					t.sub("beats", c.time.beats);
					t.sub("beat-type", c.time.type);
					ctx.time = c.time;
				}
				const clefName = cell.clefIn ?? (m === 0 ? cell.clef : null);
				if (clefName) c.clef = clefName;
				if (m === 0 || cell.clefIn) {
					const cx = CLEF_XML[c.clef ?? "clefG"];
					const cl = attrs.sub("clef", null, staffNo ? { number: staffNo } : {});
					cl.sub("sign", cx.sign);
					cl.sub("line", cx.line);
					if (cx.oct) cl.sub("clef-octave-change", cx.oct);
				}
				// notes
				const st = sys.staves[k];
				const measLen = c.time ? (c.time.beats * 4) / c.time.type : null;
				const voices = voicesOf(cell.evs, st.sp ?? sp);
				const carried = new Map(); // altérations accidentelles de la mesure
				const accidentals = [...cell.evs.filter((e) => !e.rest).flatMap((e) => e.heads)].sort((a, b) => a.x - b.x);
				for (const h of accidentals) {
					const base = CLEF_BASE[h.clef ?? c.clef ?? "clefG"];
					const d = base + Math.round((st.bot - h.y) / (st.sp / 2));
					h.diat = d;
					const a = h.acc?.sort((p, q) => q.x - p.x)[0];
					c.ties ??= new Map();
					if (a) carried.set(d, ACC[a.s]);
					// une note liée à la précédente garde son altération (même d'une mesure à l'autre)
					if (!a && h.tieStop && c.ties.has(d)) h.alter = c.ties.get(d);
					else h.alter = carried.has(d) ? carried.get(d) : keyAlter(c.fifths, ((d % 7) + 7) % 7);
					if (h.tieStart) c.ties.set(d, h.alter);
					else if (!h.tieStop) c.ties.delete(d);
				}
				const lyrics = cell.lyrics;
				voices.forEach((voice, vi) => {
					const evs = voice.evs;
					// une pause seule vaut la mesure entière, quel que soit le chiffrage
					if (evs.length === 1 && evs[0].rest && evs[0].whole && measLen) voice.end = voice.start + measLen;
					if (vi > 0) {
						const back = voices[vi - 1].end;
						if (back > 0) meas.sub("backup").sub("duration", Math.round(back * DIV));
					}
					cursor = voice.end;
					if (voice.start > 1e-6) meas.sub("forward").sub("duration", Math.round(voice.start * DIV));
					for (const e of evs) {
						if (e.gap) {
							const fw = meas.sub("forward");
							fw.sub("duration", Math.round(e.gap * DIV));
							fw.sub("voice", voiceBase + vi + 1);
							continue;
						}
						let dur = e.dur;
						if (e.rest && e.whole && measLen && evs.length === 1) {
							dur = measLen;
							voice.end = voice.start + measLen;
						}
						const dv = Math.round(dur * DIV);
						if (e.rest) {
							const nt = meas.sub("note");
							nt.sub("rest");
							nt.sub("duration", dv);
							nt.sub("voice", voiceBase + vi + 1);
							const ty = noteType(dur, 0, false);
							if (ty && !(e.whole && evs.length === 1)) nt.sub("type", ty);
							if (staffNo) nt.sub("staff", staffNo);
						} else {
							const hs = [...e.heads].sort((a, b) => b.y - a.y);
							hs.forEach((h, j) => {
								const nt = meas.sub("note");
								if (j > 0) nt.sub("chord");
								const p = nt.sub("pitch");
								p.sub("step", STEPS[((h.diat % 7) + 7) % 7]);
								if (h.alter) p.sub("alter", h.alter);
								p.sub("octave", Math.floor(h.diat / 7));
								nt.sub("duration", dv);
								if (h.tieStop) nt.sub("tie", null, { type: "stop" });
								if (h.tieStart) nt.sub("tie", null, { type: "start" });
								nt.sub("voice", voiceBase + vi + 1);
								const ty = noteType(e.dur, e.dots ?? 0, e.tuplet);
								if (ty) nt.sub("type", ty);
								for (let q = 0; q < (e.dots ?? 0); q++) nt.sub("dot");
								if (e.tuplet) {
									const tmod = nt.sub("time-modification");
									tmod.sub("actual-notes", 3);
									tmod.sub("normal-notes", 2);
								}
								if (e.up !== null && e.up !== undefined) nt.sub("stem", e.up ? "up" : "down");
								if (staffNo) nt.sub("staff", staffNo);
								if (h.tieStart || h.tieStop) {
									const no = nt.sub("notations");
									if (h.tieStop) no.sub("tied", null, { type: "stop" });
									if (h.tieStart) no.sub("tied", null, { type: "start" });
								}
								const near = (l) => Math.abs(l.x + (l.x1 - l.x) / 2 - (h.x + h.w / 2)) < 1.8 * sp;
								// la syllabe va à la 1re voix ; à une autre voix seulement si la 1re n'a pas de note là
								const v0has = (l) => (voices[0]?.evs ?? []).some((q) => q.heads?.length && Math.abs(l.x + (l.x1 - l.x) / 2 - (q.heads[0].x + q.heads[0].w / 2)) < 1.8 * sp);
								if (j === 0 && (vi === 0 || lyrics.some((l) => !l.used && near(l) && !v0has(l)))) {
									// paroles : la syllabe alignée sur cette note
									const mine = lyrics.filter((l) => !l.used && near(l) && (vi === 0 || !v0has(l)));
									mine.forEach((l) => {
										l.used = true;
										const ly = nt.sub("lyric", null, { number: l.verse ?? 1 });
										const s = l.str.replace(/[-–]$/, "");
										ly.sub("syllabic", l.hypAfter ? (l.hypBefore ? "middle" : "begin") : l.hypBefore ? "end" : "single");
										ly.sub("text", s);
									});
								}
							});
						}
					}
				});
			});
			if (rp.back || rp.endStop) {
				const bl = meas.sub("barline", null, { location: "right" });
				if (rp.back) bl.sub("bar-style", "light-heavy");
				if (rp.endStop) bl.sub("ending", null, { number: rp.endStop.n, type: rp.endStop.closed ? "stop" : "discontinue" });
				if (rp.back) bl.sub("repeat", null, { direction: "backward" });
			}
			if (!attrs.children.length) meas.children = meas.children.filter((x) => x !== attrs);
			else {
				const ORDER = ["divisions", "key", "time", "staves", "clef"];
				attrs.children.sort((a, b) => ORDER.indexOf(a.tag) - ORDER.indexOf(b.tag));
			}
			});
		});
		trees.push({ tree: root, measures: sys.measures.length });
	}
	return trees;
}
