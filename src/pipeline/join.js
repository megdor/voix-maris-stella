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
const PAIR = 5; // two staves read as two parts, put back together

/** What two one-staff parts look like as one part on two staves. */
function pairSig(a, b) {
	const clefs = new Map([["1", a.clefs.get("1") ?? null], ["2", b.clefs.get("1") ?? null]].filter(([, v]) => v));
	const means = [a.mean, b.mean].filter((m) => m !== null);
	return { staves: 2, clefs, mean: means.length ? means.reduce((x, y) => x + y, 0) / means.length : null };
}

/** Where a measure's children end (in divisions): its notes, backups and forwards. */
function endOf(measure) {
	let t = 0;
	for (const el of measure.children) {
		const d = Number(childrenOf(el, "duration")[0]?.text ?? 0);
		if (el.tag === "note" && !childrenOf(el, "chord").length && !childrenOf(el, "grace").length) {
			t += d;
		} else if (el.tag === "backup") {
			t -= d;
		} else if (el.tag === "forward") {
			t += d;
		}
	}
	return t;
}

const AFTER_STAFF = new Set(["beam", "notations", "lyric", "play", "listen"]);
/** A copy of a note (or forward) put on staff `staff`, its voice moved by `shift`. */
function onStaff(el, staff, shift) {
	const c = clone(el);
	c.children = c.children.filter((k) => k.tag !== "staff");
	const v = c.children.find((k) => k.tag === "voice");
	if (v && /^\d+$/.test(v.text ?? "")) {
		v.text = String(Number(v.text) + shift);
	}
	const st = new El("staff", {}, staff);
	const at = c.children.findIndex((k) => AFTER_STAFF.has(k.tag));
	if (at < 0) {
		c.children.push(st);
	} else {
		c.children.splice(at, 0, st);
	}
	return c;
}

/** Score parts a and a+1 (two staves of one part) become one part on two staves. */
function joinStaves(root, plist, parts, states, sigs, a) {
	const ms = pairMeasures(parts[a], parts[a + 1]);
	const first = ms[0];
	if (first) {
		let attrs = childrenOf(first, "attributes")[0];
		if (!attrs) {
			attrs = new El("attributes");
			first.children.unshift(attrs);
		}
		if (!childrenOf(attrs, "staves").length) {
			const st = new El("staves", {}, 2);
			const at = attrs.children.findIndex((c) => ["part-symbol", "instruments", "clef", "staff-details", "transpose"].includes(c.tag));
			if (at < 0) {
				attrs.children.push(st);
			} else {
				attrs.children.splice(at, 0, st);
			}
		}
	}
	parts[a].children = ms;
	const gone = parts[a + 1];
	const id = attr(gone, "id");
	root.children = root.children.filter((c) => c !== gone);
	plist.children = plist.children.filter((c) => !(c.tag === "score-part" && attr(c, "id") === id));
	sigs[a] = pairSig(sigs[a], sigs[a + 1]);
	parts.splice(a + 1, 1);
	states.splice(a + 1, 1);
	sigs.splice(a + 1, 1);
}

/** Two one-staff parts' measures as the measures of one part on two staves. */
function pairMeasures(upper, lower) {
	const A = childrenOf(upper, "measure");
	const B = childrenOf(lower, "measure");
	const n = Math.max(A.length, B.length);
	const out = [];
	for (let i = 0; i < n; i++) {
		const m = A[i] ? clone(A[i]) : new El("measure");
		for (const attrs of childrenOf(m, "attributes")) {
			for (const c of childrenOf(attrs, "clef")) {
				c.set("number", 1);
			}
		}
		const b = B[i];
		if (b && b.children.some((c) => c.tag === "note" || c.tag === "attributes")) {
			const back = endOf(m);
			if (back > 0) {
				m.children.push(new El("backup"));
				m.children.at(-1).sub("duration", back);
			}
			for (const el of b.children) {
				if (el.tag === "note" || el.tag === "forward") {
					m.children.push(onStaff(el, 2, 4));
				} else if (el.tag === "backup") {
					m.children.push(clone(el));
				} else if (el.tag === "attributes") {
					const clefs = childrenOf(el, "clef").map((c) => {
						const k = clone(c);
						k.set("number", 2);
						return k;
					});
					if (clefs.length) {
						const a = new El("attributes");
						a.children = clefs;
						m.children.push(a);
					}
				}
			}
		}
		out.push(m);
	}
	return out;
}
const NEW_PART = 40; // a part first met on this page
const CONTINUE = 12; // a part heard on the page before (a voice goes on)

/**
 * Page part j → score part index (or -1: a new part), in order, at the least
 * total unlikeness (an alignment: parts never swap places).
 */
function matchParts(old, page, recent = []) {
	const I = old.length;
	const J = page.length;
	const cost = Array.from({ length: I + 1 }, () => new Array(J + 1).fill(Infinity));
	const move = Array.from({ length: I + 1 }, () => new Array(J + 1).fill(null));
	cost[0][0] = 0;
	// only while the score has no part on two staves yet (else a choir in closed
	// score, women's staff over men's, could be taken for a piano)
	const hasGrand = old.some((o) => o.staves >= 2);
	for (let i = 0; i <= I; i++) {
		for (let j = 0; j <= J; j++) {
			const c = cost[i][j];
			if (c === Infinity) {
				continue;
			}
			if (i < I && j < J) {
				const v = c + unlike(old[i], page[j]) - (recent[i] ? CONTINUE : 0);
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
			// two one-staff parts of the page = the two staves of a part (a piano
			// whose brace was not seen on this page)
			if (i < I && j + 1 < J && old[i].staves === 2 && page[j].staves === 1 && page[j + 1].staves === 1) {
				const v = c + PAIR + unlike(old[i], pairSig(page[j], page[j + 1]));
				if (v < cost[i + 1][j + 2]) {
					cost[i + 1][j + 2] = v;
					move[i + 1][j + 2] = "pair";
				}
			}
			// the other way round: a piano read as two parts on the earlier pages,
			// found whole (two staves) on this one
			if (!hasGrand && i + 1 < I && j < J && old[i].staves === 1 && old[i + 1].staves === 1 && page[j].staves === 2) {
				const v = c + PAIR + unlike(pairSig(old[i], old[i + 1]), page[j]);
				if (v < cost[i + 2][j + 1]) {
					cost[i + 2][j + 1] = v;
					move[i + 2][j + 1] = "unpair";
				}
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
		} else if (mv === "unpair") {
			out[j - 1] = { to: i - 2, merge: i - 1 };
			i -= 2;
			j--;
		} else if (mv === "pair") {
			out[j - 2] = { to: i - 1, pair: j - 1 };
			out[j - 1] = { paired: true };
			i--;
			j -= 2;
		} else if (mv === "skip") {
			i--;
		} else {
			out[j - 1] = { before: i }; // new part, placed before score part i
			j--;
		}
	}
	return out;
}

const hasNotes = (m) =>
	childrenOf(m, "note").some((n) => childrenOf(n, "pitch").length > 0);

/**
 * Fragments of one part, made when the pages lay out their staves differently
 * (a choir on some pages only, its staves not always in the same place): two
 * parts that never sound in the same bar, with the same staves, the same clefs
 * and about the same register, each present in less than 60 % of the bars,
 * are one part: the later one's bars go into the earlier one. So is a scrap of
 * a few bars (4, or 5 % of the piece), whatever the size of its part.
 */
function mergeFragments(root, plist, parts) {
	const bars = (part) => childrenOf(part, "measure");
	const total = Math.max(1, ...parts.map((p) => bars(p).filter(hasNotes).length));
	let merged = true;
	while (merged) {
		merged = false;
		const sig = parts.map(signature);
		const used = parts.map((p) => new Set(bars(p).map((m, i) => (hasNotes(m) ? i : -1)).filter((i) => i >= 0)));
		outer: for (let a = 0; a < parts.length; a++) {
			for (let b = a + 1; b < parts.length; b++) {
				const A = sig[a];
				const B = sig[b];
				// a scrap of a few bars (a staff read twice at a system's end) joins its
				// part however long that part is
				const scrap = Math.min(used[a].size, used[b].size) <= Math.max(4, 0.05 * total);
				if (A.staves !== B.staves || (!scrap && (used[a].size >= 0.6 * total || used[b].size >= 0.6 * total))) {
					continue;
				}
				if ([...A.clefs].some(([k, v]) => B.clefs.has(k) && B.clefs.get(k) !== v)) {
					continue;
				}
				if (A.mean === null || B.mean === null || Math.abs(A.mean - B.mean) > 8) {
					continue;
				}
				if ([...used[b]].some((i) => used[a].has(i))) {
					continue; // they sound together: two parts
				}
				const ma = bars(parts[a]);
				const mb = bars(parts[b]);
				for (const i of used[b]) {
					if (ma[i] && mb[i]) {
						const at = parts[a].children.indexOf(ma[i]);
						const m = mb[i];
						m.set("number", attr(ma[i], "number") ?? i + 1);
						parts[a].children[at] = m;
					}
				}
				// part b leaves the score and the part list
				root.children = root.children.filter((c) => c !== parts[b]);
				const id = attr(parts[b], "id");
				plist.children = plist.children.filter((c) => !(c.tag === "score-part" && attr(c, "id") === id));
				parts.splice(b, 1);
				merged = true;
				break outer;
			}
		}
	}
}

/**
 * The pages' trees joined into one score-partwise tree (the inputs are left
 * as they are). One page: a copy of it.
 */
// A bar where nothing at all was read, in any part (no note, no rest): a
// column the page reading added at a system's end (La Carità, a bar of
// nothing after each system), not music. Dropped, its settings and page
// break carried to the next bar.
function dropEmptyBars(parts) {
	const lists = parts.map((p) => childrenOf(p, "measure"));
	const n = Math.min(...lists.map((l) => l.length));
	if (!parts.length || n < 2) {
		return;
	}
	for (let i = n - 1; i >= 0; i--) {
		if (lists.some((l) => l[i].children.some((c) => c.tag === "note"))) {
			continue;
		}
		parts.forEach((part, k) => {
			const m = lists[k][i];
			const keep = m.children.filter(
				(c) => c.tag === "attributes" || c.tag === "print" || c.tag === "direction",
			);
			const next = lists[k][i + 1] ?? null;
			if (next) {
				next.children.unshift(...keep);
			}
			part.children.splice(part.children.indexOf(m), 1);
			lists[k].splice(i, 1);
		});
	}
	for (const l of lists) {
		l.forEach((m, j) => m.set("number", j + 1));
	}
}

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
	let setAside = 0;
	let prevCount = measures;
	for (const tree of trees.slice(1)) {
		const pageParts = partsOf(tree);
		// a page of one staff only, many bars long, after pages of a choir: an
		// instrument's separate part printed at the end (Forrest, Psalm 8: the
		// violin), not the score going on; left aside, and said so
		if (
			parts.length >= 3 &&
			pageParts.length === 1 &&
			childrenOf(pageParts[0], "measure").length > 24
		) {
			setAside++;
			continue;
		}
		const pageSigs = pageParts.map(signature);
		// score parts heard on the page before: a voice goes on from page to page,
		// so the staves of this page are matched with them first
		const recent = parts.map((part) => {
			const ms = childrenOf(part, "measure");
			return ms.slice(Math.max(0, ms.length - prevCount)).some(hasNotes);
		});
		const plan = matchParts(sigs, pageSigs, recent);
		// score parts that are the two staves of one part (seen whole on this page):
		// put back together first, from the last, shifting the plan's indices
		const merges = plan.filter((p) => p.merge !== undefined).map((p) => p.to).sort((a, b) => b - a);
		for (const a of merges) {
			joinStaves(root, plist, parts, states, sigs, a);
			for (const p of plan) {
				if (p.to !== undefined && p.to > a) {
					p.to--;
				}
				if (p.before !== undefined && p.before > a) {
					p.before--;
				}
				if (p.to === a) {
					delete p.merge;
				}
			}
		}
		// parts first met on this page: empty until now, placed among the others
		// in the page's order (inserted from the last, so the indices stay right)
		const owner = new Array(pageParts.length);
		const fresh = [];
		plan.forEach((p, j) => {
			if ("to" in p) {
				owner[j] = p.to;
			} else if (!p.paired) {
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
			// its empty bars keep the page breaks of the score (the player counts
			// the bars of each page from them, in any part)
			const model = parts.length ? childrenOf(parts[0], "measure") : [];
			for (let i = 1; i <= measures; i++) {
				const m = part.sub("measure", null, { number: i });
				for (const pr of (model[i - 1]?.children ?? []).filter((c) => c.tag === "print")) {
					m.children.push(clone(pr));
				}
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
			const pairWith = j !== undefined ? plan[j].pair : undefined;
			const sig = j === undefined ? null : pairWith !== undefined ? pairSig(pageSigs[j], pageSigs[pairWith]) : pageSigs[j];
			if (sig && sig.mean !== null) {
				sigs[n] = sig; // its look on its latest page
			}
			const pageMeasures = j === undefined
				? []
				: pairWith !== undefined
					? pairMeasures(pageParts[j], pageParts[pairWith])
					: childrenOf(pageParts[j], "measure").map(clone);
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
		prevCount = count;
	}
	mergeFragments(root, plist, parts);
	dropEmptyBars(parts);
	if (setAside) {
		let ident = childrenOf(root, "identification")[0];
		if (!ident) {
			ident = new El("identification");
			root.children.splice(root.children.indexOf(plist), 0, ident);
		}
		const misc = new El("miscellaneous");
		const field = new El("miscellaneous-field", { name: "pages-a-part" });
		field.text = String(setAside);
		misc.children.push(field);
		ident.children.push(misc);
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
