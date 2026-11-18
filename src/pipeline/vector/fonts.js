// Ce que signifie chaque caractère d'une police musicale, selon sa famille :
//  - SMuFL (Bravura, Leland, Petaluma, Finale Maestro récent, MuseScore 3 et 4) : codes Unicode standard ;
//  - MuseScore 2 (police « MScore ») : ses propres codes, relevés sur nos PDF ;
//  - Sonata et compatibles (Opus de Sibelius, Maestro de Finale, Anastasia d'Encore, Petrucci…) :
//    un caractère par touche, code d'origine (0 à 255) ou son équivalent Unicode Mac Roman.
// Un symbole est un nom court : head1/head2/head4 (tête noire, blanche, ronde), clefG, clefG8, clefF,
// clefC, flat, sharp, natural, dflat, dsharp, rest1 … rest32, flagU8, flagD8, flagU16, flagD16,
// dot, t0…t9 (chiffres de mesure), tC (C), tCut, staff5 (portée en un caractère), ledger.

const SMUFL = {
	0xe050: "clefG", 0xe052: "clefG8", 0xe053: "clefG8va", 0xe05c: "clefC", 0xe062: "clefF",
	0xe0a0: "head0", 0xe0a2: "head4", 0xe0a3: "head2", 0xe0a4: "head1",
	0xe0b8: "head1", 0xe0f5: "head1",
	0xf4be: "head1", 0xf4bd: "head2", 0xf4bc: "head4", // têtes de Bravura (variantes de MuseScore)
	0xe003: "bracketTop", 0xe004: "bracketBottom", 0xe000: "brace",
	0xe260: "flat", 0xe261: "natural", 0xe262: "sharp", 0xe263: "dsharp", 0xe264: "dflat",
	0xe4e2: "rest0", 0xe4e3: "rest4", 0xe4e4: "rest2", 0xe4e5: "rest1", 0xe4e6: "rest8", 0xe4e7: "rest16", 0xe4e8: "rest32",
	0xe240: "flagU8", 0xe241: "flagD8", 0xe242: "flagU16", 0xe243: "flagD16", 0xe244: "flagU32", 0xe245: "flagD32",
	0xe1e7: "dot",
	0xe080: "t0", 0xe081: "t1", 0xe082: "t2", 0xe083: "t3", 0xe084: "t4", 0xe085: "t5", 0xe086: "t6", 0xe087: "t7", 0xe088: "t8", 0xe089: "t9",
	0xe08a: "tC", 0xe08b: "tCut",
	0xe880: "tu0", 0xe881: "tu1", 0xe882: "tu2", 0xe883: "tu3", 0xe884: "tu4", 0xe885: "tu5", 0xe886: "tu6",
	0xe044: "seg", 0xe4c0: "fermata", 0xe4c1: "fermata",
};

// MuseScore 2 (« MScore ») : relevé sur Down to the River to Pray
const MSCORE2 = {
	0xe12d: "head1", 0xe12c: "head2", 0xe12b: "head4", 0xe12a: "head0",
	0xe19e: "clefG", 0xe19c: "clefF", 0xe19a: "clefC", 0xe1a0: "clefG8",
	0xe114: "flat", 0xe113: "natural", 0xe10f: "sharp", 0xe110: "sharp", 0xe116: "dflat", 0xe111: "dsharp",
	0xe101: "rest2", 0xe100: "rest4", 0xe107: "rest1", 0xe109: "rest8", 0xe10a: "rest16", 0xe10b: "rest32",
	0xe190: "flagU8", 0xe194: "flagD8", 0xe191: "flagU16", 0xe195: "flagD16",
	0xe127: "dot",
	0x30: "t0", 0x31: "t1", 0x32: "t2", 0x33: "t3", 0x34: "t4", 0x35: "t5", 0x36: "t6", 0x37: "t7", 0x38: "t8", 0x39: "t9",
};

// Sonata et compatibles : code d'origine (octet)
const SONATA = {
	0x26: "clefG", 0x56: "clefG8", 0x3f: "clefF", 0x42: "clefC",
	0xcf: "head1", 0xfa: "head2", 0x77: "head4", 0x57: "head0", 0xf6: "head1x",
	0x62: "flat", 0x23: "sharp", 0x6e: "natural", 0xba: "dflat",
	0xe3: "rest0", 0xb7: "rest4", 0xee: "rest2", 0xce: "rest1", 0xe4: "rest8", 0xc5: "rest16", 0xa8: "rest32",
	0x6a: "flagU8", 0x4a: "flagD8", 0x72: "flagU16", 0x52: "flagD16", 0x6b: "flagU16", 0x4b: "flagD16",
	0x2e: "dot", 0xaa: "dot", // point de prolongation (Opus Special)
	0x30: "t0", 0x31: "t1", 0x32: "t2", 0x33: "t3", 0x34: "t4", 0x35: "t5", 0x36: "t6", 0x37: "t7", 0x38: "t8", 0x39: "t9",
	0x63: "tC", 0x43: "tCut",
	0x3d: "staff5", 0x5f: "ledger", 0x55: "fermata", 0x75: "fermata", 0x7b: "brace", 0xa7: "brace", 0xa3: "tu3", // « 3 » de triolet (Sonata)
	0xa5: "oct8", 0xdc: "oct8", // petit « 8 » sous la clé (clé de sol pour ténors)
};

// Unicode -> octet Mac Roman (les polices Sonata déclarent souvent leurs caractères ainsi)
const MAC = (() => {
	const hi = "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";
	const m = new Map();
	[...hi].forEach((c, i) => m.set(c.codePointAt(0), 0x80 + i));
	return m;
})();

export function familyOf(fontName) {
	const n = fontName.replace(/^[A-Z]{6}\+/, "");
	if (/Text/i.test(n) && !/Engraver/i.test(n)) return null; // polices de texte musical (tempo, nuances)
	if (/Bravura|Leland|Petaluma|Sebastian|Gootville|MuseJazz|Finale ?(Maestro|Ash|Broadway|Jazz|Engraver|Legacy)|Golden|Ekmelos/i.test(n)) return "smufl";
	if (/MScore|Emmentaler|Gonville/i.test(n)) return "mscore";
	if (/Opus|Maestro|Anastasia|Petrucci|Sonata|Engraver|Jazz|November|Kousbouk|Broadway|Reprise|Tamburo|Sibelius|Helsinki|Inkpen|Norfolk/i.test(n)) return "sonata";
	return null;
}

/** Le symbole d'un glyphe relevé (ou null), sachant la famille de sa police. */
export function symbolOf(g, family, mscoreIsSmufl) {
	const u = g.uni;
	if (family === "smufl") return SMUFL[u] ?? null;
	if (family === "mscore") {
		if (mscoreIsSmufl) return SMUFL[u] ?? null;
		return MSCORE2[u] ?? null;
	}
	if (family === "sonata") {
		let b = null;
		if (u !== null && u >= 0xf000 && u < 0xf100) b = u - 0xf000;
		else if (u !== null && u < 0x80) b = u;
		else if (u !== null && MAC.has(u)) b = MAC.get(u);
		else if (g.code !== null && g.code < 256) b = g.code;
		return b === null ? null : (SONATA[b] ?? null);
	}
	return null;
}

/** Une police « MScore » de MuseScore 3 ou 4 suit SMuFL ; celle de MuseScore 2, non. */
export function mscoreUsesSmufl(glyphs) {
	let smufl = 0;
	let old = 0;
	for (const g of glyphs) {
		if (!/MScore/i.test(g.font)) continue;
		if (g.uni === 0xe0a4 || g.uni === 0xe050 || g.uni === 0xe062 || g.uni === 0xe0a3) smufl++;
		if (g.uni === 0xe12d || g.uni === 0xe19e || g.uni === 0xe19c || g.uni === 0xe12c) old++;
	}
	return smufl >= old;
}

/**
 * La famille de chaque police d'une page. Une police au nom anonyme (« TTFEE5C0B8t00 »…) dont les
 * caractères sont surtout ceux de Sonata (têtes « œ », « ˙ », crochets « j », clés « & » « ? »…) est
 * traitée comme une police Sonata.
 */
export function familiesOf(glyphs) {
	const map = new Map();
	const stats = new Map();
	const SON = new Set([0x153, 0x2d9, 0x152, 0x2030, 0x2211, 0xd3, 0x6a, 0x4a, 0x72, 0x52, 0x23, 0x62, 0x6e, 0x26, 0x3f, 0x2e, 0x77, 0xf0cf, 0xf0fa]);
	for (const g of glyphs) {
		if (!map.has(g.font)) map.set(g.font, familyOf(g.font));
		if (map.get(g.font)) continue;
		const st = stats.get(g.font) ?? { n: 0, son: 0, heads: 0 };
		st.n++;
		if (SON.has(g.uni)) st.son++;
		if (g.uni === 0x153 || g.uni === 0xf0cf || g.uni === 0x2d9) st.heads++;
		stats.set(g.font, st);
	}
	let found = false;
	for (const [f, st] of stats) {
		if (st.heads >= 8 && st.son / st.n > 0.6) {
			map.set(f, "sonata");
			found = true;
		}
	}
	// les autres polices anonymes de la même page, faites des mêmes caractères (clés, chiffres…)
	if (found) for (const [f, st] of stats) if (!map.get(f) && st.son / st.n > 0.8) map.set(f, "sonata");
	return map;
}
