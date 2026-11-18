// Lecture exacte d'un PDF né numérique (MuseScore, Sibelius, Finale…) : on parcourt la liste
// d'opérations de pdf.js et on relève, en coordonnées de page (origine en haut à gauche, y vers le bas) :
//   - les glyphes (caractère, police, taille, position de l'origine),
//   - les segments droits tracés (lignes de portée, hampes, barres de mesure),
//   - les surfaces remplies (ligatures, barres épaisses, hampes dessinées en rectangle),
//   - le texte des polices ordinaires (paroles, titres, indications).
// Rien n'est « reconnu » ici : c'est le relevé brut de ce que le PDF dessine.

const mul = (a, b) => [
	a[0] * b[0] + a[1] * b[2],
	a[0] * b[1] + a[1] * b[3],
	a[2] * b[0] + a[3] * b[2],
	a[2] * b[1] + a[3] * b[3],
	a[4] * b[0] + a[5] * b[2] + b[4],
	a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// tracé pdf.js (constructPath) : 0 moveTo, 1 lineTo, 2 curveTo, 3 quadraticCurveTo, 4 closePath
function subpaths(data) {
	const out = [];
	let cur = null;
	for (let i = 0; i < data.length; ) {
		const op = data[i++];
		if (op === 0) {
			cur = { pts: [[data[i], data[i + 1]]], curved: false, closed: false };
			out.push(cur);
			i += 2;
		} else if (op === 1) {
			cur?.pts.push([data[i], data[i + 1]]);
			i += 2;
		} else if (op === 2) {
			if (cur) {
				cur.curved = true;
				cur.pts.push([data[i + 4], data[i + 5]]);
				cur.ctrl = (cur.ctrl ?? []).concat([[data[i], data[i + 1]], [data[i + 2], data[i + 3]]]);
			}
			i += 6;
		} else if (op === 3) {
			if (cur) {
				cur.curved = true;
				cur.pts.push([data[i + 2], data[i + 3]]);
			}
			i += 4;
		} else if (op === 4) {
			if (cur) cur.closed = true;
		} else {
			break;
		}
	}
	return out;
}

/**
 * @param page   page pdf.js (PDFPageProxy)
 * @param OPS    pdfjs.OPS
 * @returns {{width,height,glyphs,segs,fills,texts}}
 */
export async function extractPage(page, OPS) {
	const vp = page.getViewport({ scale: 1 });
	const base = vp.transform; // espace PDF -> page (haut-gauche, y vers le bas)
	const ops = await page.getOperatorList();
	const glyphs = [];
	const segs = [];
	const fills = [];
	const texts = [];
	let ctm = [1, 0, 0, 1, 0, 0];
	const stack = [];
	let lw = 1;
	// état texte
	let font = null;
	let fontSize = 1;
	let tm = [1, 0, 0, 1, 0, 0];
	let tlm = [1, 0, 0, 1, 0, 0];
	let tc = 0;
	let tw = 0;
	let th = 1;
	let tl = 0;
	let rise = 0;
	const fonts = new Map();
	const getFont = (name) => {
		if (!fonts.has(name)) {
			let f = null;
			try {
				f = page.commonObjs.has(name) ? page.commonObjs.get(name) : page.objs.get(name);
			} catch {
				f = null;
			}
			fonts.set(name, f);
		}
		return fonts.get(name);
	};
	const dev = (x, y) => apply(mul(ctm, base), x, y);

	const show = (arr) => {
		if (!font) return;
		const fm = font.fontMatrix ?? [0.001, 0, 0, 0.001, 0, 0];
		const fname = String(font.name ?? font.loadedName ?? "");
		let run = null; // texte ordinaire regroupé par appel
		for (const g of arr) {
			if (typeof g === "number") {
				const tx = (-g / 1000) * fontSize * th;
				tm = mul([1, 0, 0, 1, tx, 0], tm);
				continue;
			}
			if (!g) continue;
			// origine du glyphe dans la page
			const trm = mul(mul([fontSize * th, 0, 0, fontSize, 0, rise], tm), mul(ctm, base));
			const [x, y] = [trm[4], trm[5]];
			const size = Math.hypot(trm[2], trm[3]); // taille du corps, en points de page
			const code = g.originalCharCode ?? null;
			const uni = typeof g.unicode === "string" && g.unicode.length ? g.unicode.codePointAt(0) : null;
			glyphs.push({ x, y, size, font: fname, code, uni, ch: g.unicode ?? "", adv: (g.width ?? 0) * fm[0] * size, italic: Boolean(font.italic), bold: Boolean(font.bold) });
			if (!run) {
				run = { x, y, size, font: fname, str: "" };
				texts.push(run);
			}
			run.str += g.unicode ?? "";
			run.x1 = x + (g.width ?? 0) * fm[0] * size;
			const w0 = (g.width ?? 0) * fm[0];
			const tx = (w0 * fontSize + tc + (g.isSpace ? tw : 0)) * th;
			tm = mul([1, 0, 0, 1, tx, 0], tm);
		}
	};

	const { fnArray, argsArray } = ops;
	for (let i = 0; i < fnArray.length; i++) {
		const fn = fnArray[i];
		const a = argsArray[i];
		switch (fn) {
			case OPS.save:
				stack.push({ ctm, lw });
				break;
			case OPS.restore: {
				const s = stack.pop();
				if (s) ({ ctm, lw } = s);
				break;
			}
			case OPS.transform:
				ctm = mul(Array.from(a.length === 1 ? a[0] : a), ctm);
				break;
			case OPS.paintFormXObjectBegin:
				stack.push({ ctm, lw });
				if (a?.[0]) ctm = mul(Array.from(a[0]), ctm);
				break;
			case OPS.paintFormXObjectEnd: {
				const s = stack.pop();
				if (s) ({ ctm, lw } = s);
				break;
			}
			case OPS.setLineWidth:
				lw = a[0];
				break;
			case OPS.beginText:
				tm = [1, 0, 0, 1, 0, 0];
				tlm = [1, 0, 0, 1, 0, 0];
				break;
			case OPS.setFont:
				font = getFont(a[0]);
				fontSize = a[1];
				break;
			case OPS.setCharSpacing:
				tc = a[0];
				break;
			case OPS.setWordSpacing:
				tw = a[0];
				break;
			case OPS.setHScale:
				th = a[0] / 100;
				break;
			case OPS.setLeading:
				tl = a[0];
				break;
			case OPS.setTextRise:
				rise = a[0];
				break;
			case OPS.setTextMatrix:
				tm = tlm = Array.from(a.length === 1 ? a[0] : a).slice(0, 6);
				break;
			case OPS.moveText:
				tlm = mul([1, 0, 0, 1, a[0], a[1]], tlm);
				tm = tlm;
				break;
			case OPS.setLeadingMoveText:
				tl = -a[1];
				tlm = mul([1, 0, 0, 1, a[0], a[1]], tlm);
				tm = tlm;
				break;
			case OPS.nextLine:
				tlm = mul([1, 0, 0, 1, 0, -tl], tlm);
				tm = tlm;
				break;
			case OPS.showText:
			case OPS.showSpacedText:
				show(a[0]);
				break;
			case OPS.nextLineShowText:
				tlm = mul([1, 0, 0, 1, 0, -tl], tlm);
				tm = tlm;
				show(a[0]);
				break;
			case OPS.nextLineSetSpacingShowText:
				tw = a[0];
				tc = a[1];
				tlm = mul([1, 0, 0, 1, 0, -tl], tlm);
				tm = tlm;
				show(a[2]);
				break;
			case OPS.constructPath: {
				const paint = a[0];
				const raw = a[1]?.[0] ?? a[1];
				const data = raw ? Array.from(raw) : [];
				const stroke = [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(paint);
				const fill = [OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(paint);
				if (!stroke && !fill) break;
				const m = mul(ctm, base);
				const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
				for (const sp of subpaths(data)) {
					const pts = sp.pts.map(([x, y]) => apply(m, x, y));
					if (stroke && !sp.curved) {
						for (let k = 1; k < pts.length; k++) {
							segs.push({ x0: pts[k - 1][0], y0: pts[k - 1][1], x1: pts[k][0], y1: pts[k][1], w: lw * scale });
						}
						if (sp.closed && pts.length > 2) {
							const p = pts[pts.length - 1];
							const q = pts[0];
							segs.push({ x0: p[0], y0: p[1], x1: q[0], y1: q[1], w: lw * scale });
						}
					}
					if (fill && pts.length >= 3) {
						const xs = pts.map((p) => p[0]);
						const ys = pts.map((p) => p[1]);
						fills.push({
							pts,
							curved: sp.curved,
							x0: Math.min(...xs),
							x1: Math.max(...xs),
							y0: Math.min(...ys),
							y1: Math.max(...ys),
						});
					} else if (stroke && sp.curved) {
						const xs = pts.map((p) => p[0]);
						const ys = pts.map((p) => p[1]);
						fills.push({ pts, curved: true, stroked: true, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
					}
				}
				break;
			}
			default:
				break;
		}
	}
	return { width: vp.width, height: vp.height, glyphs, segs, fills, texts, images: fnArray.filter((f) => f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject).length };
}
