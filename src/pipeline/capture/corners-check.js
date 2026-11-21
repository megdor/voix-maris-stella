// Chœur Maris Stella : contrôle des coins trouvés par DocAligner. Sur une
// photo où la page claire se détache d'un fond plus sombre (table, bureau),
// la page se découpe simplement : on garde la plus grande zone claire, et ses
// quatre points extrêmes sont les coins. Un coin de DocAligner très loin de
// celui-là (photo de livret : coin du bas placé 600 px trop haut) est remplacé.
// Fond clair, page mal détachée, zone trouée : on ne touche à rien.

const WORK = 400; // côté long de travail

/** Otsu threshold of a 256-bin histogram. */
function otsu(hist, n) {
	let sum = 0;
	for (let i = 0; i < 256; i++) {
		sum += i * hist[i];
	}
	let sumB = 0;
	let wB = 0;
	let best = 0;
	let t = 128;
	for (let i = 0; i < 256; i++) {
		wB += hist[i];
		if (!wB) {
			continue;
		}
		const wF = n - wB;
		if (!wF) {
			break;
		}
		sumB += i * hist[i];
		const mB = sumB / wB;
		const mF = (sum - sumB) / wF;
		const between = wB * wF * (mB - mF) ** 2;
		if (between > best) {
			best = between;
			t = i;
		}
	}
	return t;
}

/**
 * The paper's corners (TL, TR, BR, BL, image pixels) when the page stands
 * out clearly from its background, else null.
 */
export function paperCorners({ data, width, height }) {
	const k = Math.max(1, Math.ceil(Math.max(width, height) / WORK));
	const w = Math.floor(width / k);
	const h = Math.floor(height / k);
	const g = new Uint8Array(w * h);
	const hist = new Uint32Array(256);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			// a small box average: print and staff lines vanish, paper stays
			let s = 0;
			let n = 0;
			for (let dy = 0; dy < k; dy += Math.max(1, k >> 1)) {
				for (let dx = 0; dx < k; dx += Math.max(1, k >> 1)) {
					const i = 4 * ((y * k + dy) * width + x * k + dx);
					s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
					n++;
				}
			}
			const v = Math.round(s / n);
			g[y * w + x] = v;
			hist[v]++;
		}
	}
	const t = otsu(hist, w * h);
	// close the paper over the printed music (max then min filter, radius r)
	const r = Math.max(2, Math.round(w / 60));
	const bright = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) {
		bright[i] = g[i] > t ? 1 : 0;
	}
	const dilate = (src, on) => {
		const out = new Uint8Array(w * h);
		const tmp = new Uint8Array(w * h);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				let v = on ? 0 : 1;
				for (let d = -r; d <= r; d++) {
					const xx = Math.min(w - 1, Math.max(0, x + d));
					if (on ? src[y * w + xx] : !src[y * w + xx]) {
						v = on ? 1 : 0;
						break;
					}
				}
				tmp[y * w + x] = v;
			}
		}
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				let v = on ? 0 : 1;
				for (let d = -r; d <= r; d++) {
					const yy = Math.min(h - 1, Math.max(0, y + d));
					if (on ? tmp[yy * w + x] : !tmp[yy * w + x]) {
						v = on ? 1 : 0;
						break;
					}
				}
				out[y * w + x] = v;
			}
		}
		return out;
	};
	const closed = dilate(dilate(bright, true), false);
	// largest bright component
	const lab = new Int32Array(w * h).fill(-1);
	let bestId = -1;
	let bestN = 0;
	const stack = [];
	let id = 0;
	for (let i = 0; i < w * h; i++) {
		if (!closed[i] || lab[i] >= 0) {
			continue;
		}
		let n = 0;
		stack.push(i);
		lab[i] = id;
		while (stack.length) {
			const j = stack.pop();
			n++;
			const x = j % w;
			const y = (j - x) / w;
			for (const [nx, ny] of [
				[x + 1, y],
				[x - 1, y],
				[x, y + 1],
				[x, y - 1],
			]) {
				if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
					continue;
				}
				const q = ny * w + nx;
				if (closed[q] && lab[q] < 0) {
					lab[q] = id;
					stack.push(q);
				}
			}
		}
		if (n > bestN) {
			bestN = n;
			bestId = id;
		}
		id++;
	}
	const area = bestN / (w * h);
	if (bestId < 0 || area < 0.2 || area > 0.93) {
		return null; // no page, or the page fills the photo (nothing to check)
	}
	// contrast paper / background, and the page must not touch the photo's edges much
	let sIn = 0;
	let nIn = 0;
	let sOut = 0;
	let nOut = 0;
	let edge = 0;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			if (lab[i] === bestId) {
				sIn += g[i];
				nIn++;
				if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
					edge++;
				}
			} else {
				sOut += g[i];
				nOut++;
			}
		}
	}
	if (!nOut || sIn / nIn - sOut / nOut < 50 || edge > 0.05 * 2 * (w + h)) {
		return null;
	}
	// extreme points: TL min(x+y), TR max(x-y), BR max(x+y), BL min(x-y)
	const ext = [
		[Infinity, null],
		[-Infinity, null],
		[-Infinity, null],
		[Infinity, null],
	];
	let hullArea = 0;
	const rows = [];
	for (let y = 0; y < h; y++) {
		let x0 = -1;
		let x1 = -1;
		for (let x = 0; x < w; x++) {
			if (lab[y * w + x] !== bestId) {
				continue;
			}
			if (x0 < 0) {
				x0 = x;
			}
			x1 = x;
			const a = x + y;
			const b = x - y;
			if (a < ext[0][0]) {
				ext[0] = [a, [x, y]];
			}
			if (b > ext[1][0]) {
				ext[1] = [b, [x, y]];
			}
			if (a > ext[2][0]) {
				ext[2] = [a, [x, y]];
			}
			if (b < ext[3][0]) {
				ext[3] = [b, [x, y]];
			}
		}
		if (x0 >= 0) {
			hullArea += x1 - x0 + 1;
			rows.push(y);
		}
	}
	// a solid sheet (rows filled from edge to edge), not a ragged shape
	if (bestN < 0.9 * hullArea) {
		return null;
	}
	return ext.map(([, [x, y]]) => [(x + 0.5) * k, (y + 0.5) * k]);
}

/**
 * DocAligner's corners, with any corner far from the paper's own corner
 * replaced by it. Unchanged when the paper does not stand out clearly.
 */
export function checkCorners(image, quad) {
	if (!quad) {
		return quad;
	}
	const paper = paperCorners(image);
	if (!paper) {
		return quad;
	}
	const diag = Math.hypot(image.width, image.height);
	return quad.map((c, i) => (Math.hypot(c[0] - paper[i][0], c[1] - paper[i][1]) > 0.04 * diag ? paper[i] : c));
}
