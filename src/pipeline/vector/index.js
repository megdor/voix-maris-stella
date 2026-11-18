// Lecture exacte des PDF nés numériques : point d'entrée.
// readVectorPdf(doc, OPS) -> { ok, musicXml, report } ; ok = false si le PDF n'est pas lisible ainsi
// (scan, photo, police musicale inconnue) : on passe alors par copista comme avant.

import { joinTrees } from "../join.js";
import { xmlDocument } from "../copisteria/write.js";
import { extractPage } from "./extract.js";
import { familiesOf } from "./fonts.js";
import { readPage, systemTrees } from "./read.js";

/** Un coup d'œil : la page dessine-t-elle sa musique avec une police musicale connue ? */
export async function looksVector(doc, OPS, maxPages = 2) {
	for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
		const raw = await extractPage(await doc.getPage(p), OPS);
		const fams = familiesOf(raw.glyphs);
		const music = raw.glyphs.filter((g) => fams.get(g.font)).length;
		if (music >= 20) return true;
		// sans police musicale : musique dessinée en formes, reconnue si la page donne des notes
		if (!raw.images && raw.fills.length >= 20) {
			const page = readPage(raw);
			if (page.report.shapes && page.report.notes >= 20) return true;
		}
	}
	return false;
}

export async function readVectorPdf(doc, OPS, { onProgress } = {}) {
	const report = { pages: [], unknown: new Map(), notes: 0 };
	const trees = [];
	const pageStart = [];
	const ctx = { staff: [], time: null };
	for (let p = 1; p <= doc.numPages; p++) {
		onProgress?.(p, doc.numPages);
		const raw = await extractPage(await doc.getPage(p), OPS);
		const page = readPage(raw);
		for (const [k, v] of page.report.unknown) report.unknown.set(k, (report.unknown.get(k) ?? 0) + v);
		report.notes += page.report.notes;
		report.pages.push({ page: p, systems: page.systems.length, staves: page.staves.length, notes: page.report.notes, images: raw.images });
		if (!page.systems.length) continue;
		const ts = systemTrees(page, ctx);
		ts.forEach((t, i) => {
			pageStart.push(i === 0);
			trees.push(t.tree);
			report.where = report.where ?? [];
			for (let m = 0; m < t.measures; m++) report.where.push(`p${p} s${i} m${m}`);
		});
	}
	if (!trees.length || report.notes < 4) return { ok: false, report };
	const root = joinTrees(trees);
	// joinTrees marque chaque arbre d'un saut de page : ici un arbre est un système
	for (const part of root.children.filter((c) => c.tag === "part")) {
		let j = 0;
		for (const m of part.children.filter((c) => c.tag === "measure")) {
			const pr = m.children.find((c) => c.tag === "print");
			if (!pr) continue;
			j++;
			if (!pageStart[j]) {
				pr.attrs = [["new-system", "yes"]];
			}
		}
	}
	// contrôle : chaque voix de chaque mesure fait-elle la durée de la mesure ?
	const q = durations(root);
	report.measures = q.measures;
	report.voiceBars = q.total;
	report.badBars = q.bad;
	report.badRatio = q.total ? q.bad / q.total : 0; // sans chiffrage : rien à contrôler
	return { ok: true, musicXml: xmlDocument(root), report };
}

const kids = (el, tag) => el.children.filter((c) => c.tag === tag);
const num = (el, tag) => Number(kids(el, tag)[0]?.text ?? NaN);

/** Mesures dont une voix n'a pas la durée du chiffrage (hors première et dernière : levée, fin). */
function durations(root) {
	let total = 0;
	let bad = 0;
	let measures = 0;
	for (const part of kids(root, "part")) {
		let div = 48;
		let len = null;
		const ms = kids(part, "measure");
		measures = Math.max(measures, ms.length);
		ms.forEach((m, i) => {
			for (const a of kids(m, "attributes")) {
				if (kids(a, "divisions").length) div = num(a, "divisions");
				const t = kids(a, "time")[0];
				if (t) len = (num(t, "beats") * 4 * div) / num(t, "beat-type");
			}
			let cur = 0;
			const ends = new Map();
			for (const el of m.children) {
				if (el.tag === "backup") cur -= num(el, "duration");
				else if (el.tag === "forward") cur += num(el, "duration");
				else if (el.tag === "note" && !kids(el, "chord").length) {
					cur += num(el, "duration");
					const v = kids(el, "voice")[0]?.text ?? "1";
					ends.set(v, Math.max(ends.get(v) ?? 0, cur));
				}
			}
			if (!len || i === 0 || i === ms.length - 1) return;
			for (const e of ends.values()) {
				total++;
				if (Math.abs(e - len) > 1) bad++;
			}
		});
	}
	return { total, bad, measures };
}
