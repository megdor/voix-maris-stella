// Chœur Maris Stella : redressement des pages de PDF scannées. Une page
// scannée un peu de travers (0,5° suffit : sur la largeur, les lignes montent
// d'un interligne) casse la détection des portées, qui lit des profils
// horizontaux — une moitié de portée devient une « voix » de plus. On mesure
// l'angle des lignes de portée et on rend un quad tourné d'autant (gardé dans
// l'image), que flattenPage redresse comme pour une photo.

const MAX_DEG = 4; // au-delà : page tournée exprès, ou rien à voir avec un scan
const MIN_DEG = 0.08; // en dessous : rien à corriger
const WORK_W = 1400; // largeur de travail (0,05° ≈ 1 px sur la largeur)

/** Ink points (x, y) of the page, at about WORK_W pixels wide. */
function inkPoints({ data, width, height }) {
	const step = Math.max(1, Math.round(width / WORK_W));
	const pts = [];
	for (let y = 0; y < height; y += step) {
		for (let x = 0; x < width; x += 2 * step) {
			const i = 4 * (y * width + x);
			const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
			if (lum < 128) {
				pts.push(x / step, y / step);
			}
		}
	}
	return { pts, w: width / step, h: height / step };
}

/** How sharply the ink lines up along rows tilted by t (radians). */
function sharpness(pts, w, h, t) {
	const s = Math.sin(t);
	const c = Math.cos(t);
	const off = w * Math.abs(s) + 2;
	const hist = new Float32Array(Math.ceil(h * c + 2 * off + 2));
	for (let i = 0; i < pts.length; i += 2) {
		hist[Math.round(-pts[i] * s + pts[i + 1] * c + off)]++;
	}
	let score = 0;
	for (const v of hist) {
		score += v * v;
	}
	return score;
}

/** The staff lines' angle in degrees (y down: négatif = monte vers la droite), or 0. */
export function pageSkew(image) {
	const { pts, w, h } = inkPoints(image);
	if (pts.length < 2000) {
		return 0;
	}
	const rad = (d) => (d * Math.PI) / 180;
	let best = 0;
	let bestScore = sharpness(pts, w, h, 0);
	const flat = bestScore;
	for (let d = -MAX_DEG; d <= MAX_DEG + 1e-9; d += 0.25) {
		const sc = sharpness(pts, w, h, rad(d));
		if (sc > bestScore) {
			bestScore = sc;
			best = d;
		}
	}
	let fine = best;
	for (let d = best - 0.3; d <= best + 0.3 + 1e-9; d += 0.02) {
		const sc = sharpness(pts, w, h, rad(d));
		if (sc > bestScore) {
			bestScore = sc;
			fine = d;
		}
	}
	// un gain net, pas du bruit : sur une page droite, 0 reste le meilleur
	if (Math.abs(fine) < MIN_DEG || bestScore < 1.05 * flat) {
		return 0;
	}
	return Math.round(fine * 100) / 100;
}

/**
 * The page's quad (TL, TR, BR, BL) turned by its skew, the largest that stays
 * inside the image; null when the page is straight.
 */
export function deskewQuad(image) {
	const deg = pageSkew(image);
	if (!deg) {
		return null;
	}
	const { width: W, height: H } = image;
	const t = (deg * Math.PI) / 180;
	const c = Math.cos(t);
	const s = Math.abs(Math.sin(t));
	const k = Math.min(W / (W * c + H * s), H / (W * s + H * c));
	const a = (k * W) / 2;
	const b = (k * H) / 2;
	const cx = W / 2;
	const cy = H / 2;
	const st = Math.sin(t);
	return [
		[-a, -b],
		[a, -b],
		[a, b],
		[-a, b],
	].map(([dx, dy]) => [cx + dx * c - dy * st, cy + dx * st + dy * c]);
}
