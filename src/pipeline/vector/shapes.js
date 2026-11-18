// Lecture exacte, PDF « en tracés » : la musique est dessinée en formes (abcm2ps, LilyPond sans police,
// impressions vers PDF…), sans police musicale. On reconnaît chaque forme par sa taille, rapportée à
// l'interligne, et on en fait les mêmes symboles que ceux d'une police (tête noire, blanche, point,
// crochet, clé, altération, silence, chiffre de mesure) : la suite de la lecture est inchangée.

const FONT = "(tracés)";

function inside(a, b, tol) {
	return a.x0 >= b.x0 - tol && a.x1 <= b.x1 + tol && a.y0 >= b.y0 - tol && a.y1 <= b.y1 + tol;
}

/**
 * @param raw page extraite (fills, segs, glyphs)
 * @param staves portées trouvées (x0, x1, top, bot, sp)
 * @param sp interligne médian
 * @returns symboles {s, x, y, size, adv, font}
 */
export function shapeSymbols(raw, staves, sp) {
	const syms = [];
	const size = 4 * sp;
	const staffOf = (y) => staves.find((st) => y > st.top - 4 * st.sp && y < st.bot + 4 * st.sp) ?? null;
	const W = (f) => (f.x1 - f.x0) / sp;
	const H = (f) => (f.y1 - f.y0) / sp;
	const fills = raw.fills.filter((f) => !f.stroked);
	const verts = raw.segs.filter((g) => Math.abs(g.x1 - g.x0) < 0.15 * sp && Math.abs(g.y1 - g.y0) > 1.2 * sp);
	const stemNear = (x0, x1, y) =>
		verts.some((g) => (Math.abs(g.x0 - x0) < 0.35 * sp || Math.abs(g.x0 - x1) < 0.35 * sp) && Math.min(g.y0, g.y1) < y + 0.5 * sp && Math.max(g.y0, g.y1) > y - 0.5 * sp);

	// têtes : ovales d'environ 1,2 × 0,7 interligne ; une tête creuse est un ovale dans un ovale
	const headLike = fills.filter((f) => f.curved && W(f) >= 0.95 && W(f) <= 2.2 && H(f) >= 0.4 && H(f) <= 1.1 && staffOf((f.y0 + f.y1) / 2));
	const inner = new Set();
	const hollow = new Set();
	for (const a of headLike) {
		for (const b of headLike) {
			if (a === b || inner.has(b)) continue;
			if (W(b) < W(a) && inside(b, a, 0.05 * sp)) {
				inner.add(b);
				hollow.add(a);
			}
		}
	}
	// une tête creuse dessinée d'un seul tracé (anneau) : plus de points qu'un ovale plein
	for (const f of headLike) {
		if (inner.has(f)) continue;
		const y = (f.y0 + f.y1) / 2;
		let s = "head1";
		if (hollow.has(f)) s = W(f) >= 1.45 || !stemNear(f.x0, f.x1, y) ? "head4" : "head2";
		else if (W(f) >= 1.45) continue; // trop large pour une tête noire
		syms.push({ s, x: f.x0, y, size, adv: f.x1 - f.x0, font: FONT });
		f.used = true;
	}
	for (const f of inner) f.used = true;

	// points de prolongation
	for (const f of fills) {
		if (f.used || !f.curved) continue;
		const w = W(f);
		const h = H(f);
		if (w >= 0.2 && w <= 0.65 && h >= 0.2 && h <= 0.65 && Math.abs(w - h) < 0.25 && staffOf(f.y0)) {
			syms.push({ s: "dot", x: f.x0, y: (f.y0 + f.y1) / 2, size, adv: f.x1 - f.x0, font: FONT });
			f.used = true;
		}
	}

	// clés : grande forme courbe (sol : plus de 5,5 interlignes ; fa : environ 3, large)
	for (const f of fills) {
		if (f.used || !f.curved) continue;
		const st = staffOf((f.y0 + f.y1) / 2);
		if (!st) continue;
		const w = W(f);
		const h = H(f);
		if (h >= 5.5 && h <= 9 && w >= 1.2 && w <= 3.5) {
			syms.push({ s: "clefG", x: f.x0, y: st.bot - st.sp, size, adv: f.x1 - f.x0, font: FONT });
			f.used = true;
		} else if (h >= 2.5 && h <= 4.6 && w >= 1.6 && w <= 3.5 && f.y0 < st.top + 0.6 * st.sp) {
			syms.push({ s: "clefF", x: f.x0, y: st.bot - 3 * st.sp, size, adv: f.x1 - f.x0, font: FONT });
			f.used = true;
		}
	}

	// crochets : forme courbe étroite et haute qui part d'un bout de hampe
	const flags = [];
	for (const f of fills) {
		if (f.used || !f.curved) continue;
		const w = W(f);
		const h = H(f);
		if (w < 0.45 || w > 1.5 || h < 1.5 || h > 4.5) continue;
		const stem = verts.find((g) => Math.abs(g.x0 - f.x0) < 0.4 * sp && Math.min(g.y0, g.y1) < f.y1 && Math.max(g.y0, g.y1) > f.y0);
		if (!stem) continue;
		const top = Math.min(stem.y0, stem.y1);
		const up = Math.abs(top - f.y0) < Math.abs(Math.max(stem.y0, stem.y1) - f.y1);
		flags.push({ f, x: stem.x0, up, y: up ? f.y0 : f.y1 });
		f.used = true;
	}
	const flagGroups = [];
	for (const fl of flags) {
		const g = flagGroups.find((q) => Math.abs(q.x - fl.x) < 0.3 * sp && q.up === fl.up && Math.abs(q.y - fl.y) < 3 * sp);
		if (g) {
			g.n++;
			g.y = fl.up ? Math.min(g.y, fl.y) : Math.max(g.y, fl.y);
		} else flagGroups.push({ ...fl, n: 1 });
	}
	for (const g of flagGroups) {
		const n = g.n >= 3 ? 32 : g.n === 2 ? 16 : 8;
		syms.push({ s: `flag${g.up ? "U" : "D"}${n}`, x: g.f.x0, y: g.y, size, adv: g.f.x1 - g.f.x0, font: FONT });
	}

	// bémols : un trait vertical et une panse courbe en bas à droite
	for (const f of fills) {
		if (f.used || !f.curved || W(f) > 1 || H(f) > 1.4 || H(f) < 0.5) continue;
		const st = verts.find((g) => Math.abs(g.x0 - f.x0) < 0.3 * sp && Math.abs(Math.max(g.y0, g.y1) - f.y1) < 0.5 * sp && Math.abs(g.y1 - g.y0) < 3 * sp);
		if (!st) continue;
		syms.push({ s: "flat", x: st.x0, y: (f.y0 + f.y1) / 2, size, adv: sp, font: FONT });
		f.used = true;
		st.used = true;
	}

	// dièses et bécarres : deux barres épaisses courtes, l'une au-dessus de l'autre, et deux traits verticaux
	const bars = raw.segs.filter((g) => g.w >= 0.18 * sp && Math.abs(g.x1 - g.x0) >= 0.35 * sp && Math.abs(g.x1 - g.x0) <= 1.3 * sp && Math.abs(g.y1 - g.y0) < 0.6 * sp);
	// les mêmes barres dessinées en parallélogrammes pleins
	for (const f of fills) {
		if (f.used || f.curved || W(f) < 0.5 || W(f) > 1.3 || H(f) < 0.25 || H(f) > 0.85) continue;
		const cy = (f.y0 + f.y1) / 2;
		bars.push({ x0: f.x0, x1: f.x1, y0: cy, y1: cy, fill: f });
	}
	const usedBar = new Set();
	for (const a of bars) {
		if (usedBar.has(a)) continue;
		const ax = Math.min(a.x0, a.x1);
		const ay = (a.y0 + a.y1) / 2;
		const b = bars.find((c) => c !== a && !usedBar.has(c) && Math.abs(Math.min(c.x0, c.x1) - ax) < 0.3 * sp && Math.abs((c.y0 + c.y1) / 2 - ay) > 0.3 * sp && Math.abs((c.y0 + c.y1) / 2 - ay) < 1.3 * sp);
		if (!b) continue;
		usedBar.add(a);
		usedBar.add(b);
		if (a.fill) a.fill.used = true;
		if (b.fill) b.fill.used = true;
		const by = (b.y0 + b.y1) / 2;
		const y = (ay + by) / 2;
		const vs = verts.filter((g) => g.x0 > ax - 0.4 * sp && g.x0 < ax + 1.5 * sp && Math.min(g.y0, g.y1) < y && Math.max(g.y0, g.y1) > y && Math.abs(g.y1 - g.y0) < 3.5 * sp);
		let s = "sharp";
		if (vs.length >= 2) {
			const tops = vs.map((g) => Math.min(g.y0, g.y1)).sort((p, q) => p - q);
			if (tops[tops.length - 1] - tops[0] > 0.5 * sp) s = "natural";
		}
		for (const g of vs) g.used = true;
		syms.push({ s, x: Math.min(ax, ...vs.map((g) => g.x0)), y, size, adv: sp, font: FONT });
	}

	// silences : soupir (forme haute au milieu de la portée, sans hampe), demi-soupir, pause et demi-pause
	for (const f of fills) {
		if (f.used) continue;
		const st = staffOf((f.y0 + f.y1) / 2);
		if (!st) continue;
		const w = W(f);
		const h = H(f);
		const cy = (f.y0 + f.y1) / 2;
		const mid = (st.top + st.bot) / 2;
		if (f.curved && w >= 0.6 && w <= 1.3 && h >= 2.2 && h <= 3.4 && Math.abs(cy - mid) < 1.2 * st.sp) {
			syms.push({ s: "rest1", x: f.x0, y: cy, size, adv: f.x1 - f.x0, font: FONT });
			f.used = true;
		} else if (f.curved && w >= 0.5 && w <= 1.3 && h >= 1.2 && h < 2.2 && Math.abs(cy - mid) < 1.5 * st.sp && !stemNear(f.x0, f.x1, cy)) {
			syms.push({ s: "rest8", x: f.x0, y: cy, size, adv: f.x1 - f.x0, font: FONT });
			f.used = true;
		} else if (!f.curved && w >= 0.8 && w <= 1.6 && h >= 0.3 && h <= 0.7) {
			// pendue sous la 4e ligne : pause ; posée sur la 3e : demi-pause
			const top = Math.abs(f.y0 - (st.top + st.sp)) < 0.25 * st.sp;
			const onMid = Math.abs(f.y1 - mid) < 0.25 * st.sp;
			if (top || onMid) {
				syms.push({ s: top ? "rest4" : "rest2", x: f.x0, y: cy, size, adv: f.x1 - f.x0, font: FONT });
				f.used = true;
			}
		}
	}

	// chiffres de mesure écrits en texte, en grand, dans la portée
	for (const g of raw.glyphs) {
		if (!/^[0-9]$/.test(g.ch)) continue;
		const st = staffOf(g.y);
		if (!st || g.size < 1.6 * st.sp || g.y < st.top || g.y > st.bot + 0.3 * st.sp) continue;
		syms.push({ s: `t${g.ch}`, x: g.x, y: g.y - 0.35 * g.size, size, adv: g.adv, font: FONT });
	}
	return syms;
}
