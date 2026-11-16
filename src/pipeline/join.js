// Several pages of one piece as one score: the pages' MusicXML trees (see
// copisteria/write.js writeTree) joined part by part, in page order. Parts
// are matched by what they are (staves, clefs, register), keeping their order
// (Chœur Maris Stella : une page avec une portée en plus, un « Descant » par
// exemple, ne décale plus toutes les voix d'un cran) ; the measures are numbered on from page to page, each
// later page starts with a page break, and the attributes it repeats from
// the page before (divisions, key, time, staves, clefs) are dropped — real
// changes are kept. A part missing from a page gets empty measures there.

import { El, toXmlString } from "./copisteria/xml.js";

/** A deep copy of an element (the pages' trees are kept for later joins). */
function clone(el) {
	const copy = new El(el.tag, {}, el.text);
	copy.attrs = el.attrs.map(([k, v]) => [k, v]);
	copy.children = el.children.map(clone);
	return copy;
}

const childrenOf = (el, tag) => el.children.filter((c) => c.tag === tag);
const attr = (el, name) => el.attrs.find(([k]) => k === name)?.[1] ?? null;

/** What an attributes child sets, as a name (what) and a value (to what). */
function setting(el) {
	switch (el.tag) {
		case "clef":
			return [`clef${attr(el, "number") ?? "1"}`, toXmlString(el)];
		case "time": {
			// printed or not, the same meter
			const beats = childrenOf(el, "beats")[0]?.text;
			const type = childrenOf(el, "beat-type")[0]?.text;
			return ["time", `${beats}/${type}`];
		}
		case "key":
		case "divisions":
		case "staves":
			return [el.tag, toXmlString(el)];
		default:
			return [null, null]; // not tracked: always kept
	}
}

/** Record the attributes a measure sets (into `state`, a Map). */
function track(measure, state) {
	for (const attrs of childrenOf(measure, "attributes")) {
		for (const el of attrs.children) {
			const [what, value] = setting(el);
			if (what) {
				state.set(what, value);
			}
		}
	}
}

/** Drop from a measure's first attributes what `state` already has. */
function dropRepeated(measure, state) {
	const attrs = childrenOf(measure, "attributes")[0];
	if (!attrs) {
		return;
	}
	attrs.children = attrs.children.filter((el) => {
		const [what, value] = setting(el);
		return what === null || state.get(what) !== value;
	});
	if (attrs.children.length === 0) {
		measure.children = measure.children.filter((c) => c !== attrs);
	}
}

// ------------------------------------------------- matching parts across pages

const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** What a part of a page looks like: its staves, their clefs, its mean pitch. */
function signature(part) {
	let staves = 1;
	const clefs = new Map();
	let sum = 0;
	let n = 0;
	for (const m of childrenOf(part, "measure")) {
		for (const attrs of childrenOf(m, "attributes")) {
			for (const el of attrs.children) {
				if (el.tag === "staves") {
					staves = Number(el.text) || 1;
				} else if (el.tag === "clef") {
					const k = attr(el, "number") ?? "1";
					if (!clefs.has(k)) {
						const sign = childrenOf(el, "sign")[0]?.text ?? "";
						const oct = Number(childrenOf(el, "clef-octave-change")[0]?.text ?? 0);
						clefs.set(k, sign + (oct < 0 ? "8" : ""));
					}
				}
			}
		}
		for (const note of childrenOf(m, "note")) {
			const p = childrenOf(note, "pitch")[0];
			if (!p) {
				continue;
			}
			const step = childrenOf(p, "step")[0]?.text;
			const octave = Number(childrenOf(p, "octave")[0]?.text);
			const alter = Number(childrenOf(p, "alter")[0]?.text ?? 0);
			if (step in STEP && Number.isFinite(octave)) {
				sum += 12 * (octave + 1) + STEP[step] + alter;
				n++;
			}
		}
	}
	return { staves, clefs, mean: n ? sum / n : null };
}

/** How unlike two parts are (0: alike). */
function unlike(a, b) {
	let c = 0;
	if (a.staves !== b.staves) {
		c += 100;
	}
	for (const [k, v] of a.clefs) {
		if (b.clefs.has(k) && b.clefs.get(k) !== v) {
			c += 30;
		}
	}
	if (a.mean !== null && b.mean !== null) {
		c += Math.min(24, Math.abs(a.mean - b.mean));
	}
	return c;
}

const SKIP_OLD = 25; // a part of the score with nothing on this page
const NEW_PART = 40; // a part first met on this page

/**
 * Page part j → score part index (or -1: a new part), in order, at the least
 * total unlikeness (an alignment: parts never swap places).
 */
function matchParts(old, page) {
	const I = old.length;
	const J = page.length;
	const cost = Array.from({ length: I + 1 }, () => new Array(J + 1).fill(Infinity));
	const move = Array.from({ length: I + 1 }, () => new Array(J + 1).fill(null));
	cost[0][0] = 0;
	for (let i = 0; i <= I; i++) {
		for (let j = 0; j <= J; j++) {
			const c = cost[i][j];
			if (c === Infinity) {
				continue;
			}
			if (i < I && j < J) {
				const v = c + unlike(old[i], page[j]);
				if (v < cost[i + 1][j + 1]) {
					cost[i + 1][j + 1] = v;
					move[i + 1][j + 1] = "match";
				}
			}
			if (i < I && c + SKIP_OLD < cost[i + 1][j]) {
				cost[i + 1][j] = c + SKIP_OLD;
				move[i + 1][j] = "skip";
			}
			if (j < J && c + NEW_PART < cost[i][j + 1]) {
				cost[i][j + 1] = c + NEW_PART;
				move[i][j + 1] = "new";
			}
		}
	}
	// back from the end: for each page part, its score part, or where a new one goes
	const out = new Array(J);
	let i = I;
	let j = J;
	while (i > 0 || j > 0) {
		const mv = move[i][j];
		if (mv === "match") {
			out[j - 1] = { to: i - 1 };
			i--;
			j--;
		} else if (mv === "skip") {
			i--;
		} else {
			out[j - 1] = { before: i }; // new part, placed before score part i
			j--;
		}
	}
	return out;
}

/**
 * The pages' trees joined into one score-partwise tree (the inputs are left
 * as they are). One page: a copy of it.
 */
export function joinTrees(trees) {
	if (trees.length === 0) {
		return new El("score-partwise", { version: "4.0" });
	}
	const root = clone(trees[0]);
	const partsOf = (tree) => childrenOf(tree, "part");
	const parts = partsOf(root);
	const plist = childrenOf(root, "part-list")[0];
	// what each part has set so far
	const states = parts.map((part) => {
		const state = new Map();
		for (const m of childrenOf(part, "measure")) {
			track(m, state);
		}
		return state;
	});
	let measures = Math.max(
		0,
		...parts.map((p) => childrenOf(p, "measure").length),
	);
	// what each score part looks like (from the last page where it was met)
	const sigs = parts.map(signature);
	let nextId = parts.length;
	for (const tree of trees.slice(1)) {
		const pageParts = partsOf(tree);
		const pageSigs = pageParts.map(signature);
		const plan = matchParts(sigs, pageSigs);
		// parts first met on this page: empty until now, placed among the others
		// in the page's order (inserted from the last, so the indices stay right)
		const owner = new Array(pageParts.length);
		const fresh = [];
		plan.forEach((p, j) => {
			if ("to" in p) {
				owner[j] = p.to;
			} else {
				fresh.push([j, p.before]);
			}
		});
		const pageOf = new Map(); // score part (object) → page part index
		plan.forEach((p, j) => {
			if ("to" in p) {
				pageOf.set(parts[p.to], j);
			}
		});
		for (const [j, before] of fresh.reverse()) {
			nextId++;
			const id = `P${nextId}`;
			const sp = new El("score-part", { id });
			sp.sub("part-name", `Part ${nextId}`);
			const part = new El("part", { id });
			for (let i = 1; i <= measures; i++) {
				part.sub("measure", null, { number: i });
			}
			// in the part list and the score, before score part `before` (or last)
			const anchor = parts[before];
			const spAnchor = anchor
				? plist.children.find((c) => c.tag === "score-part" && attr(c, "id") === attr(anchor, "id"))
				: null;
			if (spAnchor) {
				plist.children.splice(plist.children.indexOf(spAnchor), 0, sp);
				root.children.splice(root.children.indexOf(anchor), 0, part);
			} else {
				plist.children.push(sp);
				root.children.push(part);
			}
			parts.splice(before, 0, part);
			states.splice(before, 0, new Map());
			sigs.splice(before, 0, pageSigs[j]);
			pageOf.set(part, j);
		}
		const count = Math.max(
			0,
			...pageParts.map((p) => childrenOf(p, "measure").length),
		);
		parts.forEach((part, n) => {
			const j = pageOf.get(part);
			if (j !== undefined && pageSigs[j].mean !== null) {
				sigs[n] = pageSigs[j]; // its look on its latest page
			}
			const pageMeasures = j !== undefined
				? childrenOf(pageParts[j], "measure").map(clone)
				: [];
			for (let i = 0; i < count; i++) {
				const m = pageMeasures[i] ?? new El("measure");
				if (i === 0) {
					dropRepeated(m, states[n]);
					const print = new El("print", { "new-page": "yes" });
					m.children.unshift(print);
				}
				track(m, states[n]);
				m.set("number", measures + i + 1);
				part.children.push(m);
			}
		});
		measures += count;
	}
	// ids and default names in score order again (P1, P2, …)
	const rename = new Map();
	parts.forEach((part, n) => rename.set(attr(part, "id"), `P${n + 1}`));
	for (const sp of childrenOf(plist, "score-part")) {
		const id = rename.get(attr(sp, "id"));
		const name = childrenOf(sp, "part-name")[0];
		if (name && /^Part \d+$/.test(name.text ?? "")) {
			name.text = `Part ${id.slice(1)}`;
		}
		sp.set("id", id);
	}
	parts.forEach((part) => part.set("id", rename.get(attr(part, "id"))));
	return root;
}
