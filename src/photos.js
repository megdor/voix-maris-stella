// Photos as pages: decoded to pixels, and taken with the phone's camera app
// (in the Android / iOS app).
import { imageFromSource } from "./pipeline/index.js";

// PDF (Chœur Maris Stella) : chaque page d'un PDF devient une image à 300 ppp, rendue dans le
// navigateur par pdf.js (Apache-2.0), copié dans le site (public/pdf.min.mjs, licence : public/pdfjs-LICENSE.txt) : rien n'est envoyé.
const BASE = import.meta.env?.BASE_URL ?? "/";
let pdfjsPromise = null;
function loadPdfjs() {
	if (!pdfjsPromise) {
		pdfjsPromise = import(/* @vite-ignore */ `${BASE}pdf.min.mjs`).then((pdfjs) => {
			pdfjs.GlobalWorkerOptions.workerSrc = `${BASE}pdf.worker.min.mjs`;
			return pdfjs;
		});
	}
	return pdfjsPromise;
}
export const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name ?? "");
/**
 * Chœur Maris Stella : un PDF « né numérique » (exporté de MuseScore, Sibelius, Finale…) se lit
 * directement dans le fichier, sans reconnaissance d'image : notes, rythmes et paroles exacts.
 * Renvoie { musicXml, report } si la lecture est sûre, sinon null (le PDF passe alors par copista).
 */
export async function readExact(file) {
	const pdfjs = await loadPdfjs();
	const { looksVector, readVectorPdf } = await import("./pipeline/vector/index.js");
	const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), wasmUrl: BASE, disableFontFace: true });
	try {
		const doc = await task.promise;
		if (!(await looksVector(doc, pdfjs.OPS))) return null;
		const r = await readVectorPdf(doc, pdfjs.OPS);
		// contrôle : moins de 15 % de mesures dont une voix n'a pas la bonne durée
		if (!r.ok || r.report.badRatio > 0.15) return null;
		return r;
	} catch (e) {
		console.warn("lecture exacte impossible", e);
		return null;
	} finally {
		await task.destroy();
	}
}

/** Les pages d'un PDF, en images PNG (300 ppp, 3600 pixels au plus de côté). */
export async function pagesFromPdf(file) {
	const pdfjs = await loadPdfjs();
	// wasmUrl : décodeurs des images JPEG 2000 / JBIG2 (courants dans les PDF de scans), sinon pages blanches
	const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), wasmUrl: BASE });
	const doc = await task.promise;
	const blobs = [];
	for (let n = 1; n <= doc.numPages; n++) {
		const page = await doc.getPage(n);
		const base = page.getViewport({ scale: 1 });
		// Chœur Maris Stella : une double page (livre photographié ouvert, scan de deux pages
		// côte à côte) est coupée en deux pages, chacune lue à pleine résolution
		const spread = base.width >= 1.25 * base.height;
		const side = spread ? Math.max(base.width / 2, base.height) : Math.max(base.width, base.height);
		const scale = Math.min(300 / 72, 3600 / side);
		const viewport = page.getViewport({ scale });
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(viewport.width);
		canvas.height = Math.round(viewport.height);
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "#fff";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		await page.render({ canvasContext: ctx, canvas, viewport }).promise;
		if (spread) {
			const cut = gutter(ctx, canvas.width, canvas.height);
			for (const [x0, x1] of [
				[0, cut],
				[cut, canvas.width],
			]) {
				const half = document.createElement("canvas");
				half.width = x1 - x0;
				half.height = canvas.height;
				half.getContext("2d").drawImage(canvas, x0, 0, x1 - x0, canvas.height, 0, 0, x1 - x0, canvas.height);
				blobs.push(await new Promise((res) => half.toBlob(res, "image/png")));
			}
		} else {
			blobs.push(await new Promise((res) => canvas.toBlob(res, "image/png")));
		}
		page.cleanup();
	}
	await task.destroy(); // libère la mémoire du document
	return blobs;
}

/** Where two facing pages meet: the column of the middle fifth with the least ink. */
function gutter(ctx, w, h) {
	const a = Math.round(w * 0.4);
	const b = Math.round(w * 0.6);
	const { data } = ctx.getImageData(a, 0, b - a, h);
	const ink = new Array(b - a).fill(0);
	for (let y = 0; y < h; y += 4) {
		for (let x = 0; x < b - a; x++) {
			const i = (y * (b - a) + x) * 4;
			if (data[i] + data[i + 1] + data[i + 2] < 3 * 140) {
				ink[x]++;
			}
		}
	}
	// lissé sur quelques colonnes : une ligne de portée qui passe ne fait pas la coupure
	let best = Math.round((b - a) / 2);
	let low = Number.POSITIVE_INFINITY;
	for (let x = 3; x < b - a - 3; x++) {
		const v = ink[x - 3] + ink[x - 2] + ink[x - 1] + ink[x] + ink[x + 1] + ink[x + 2] + ink[x + 3];
		if (v < low) {
			low = v;
			best = x;
		}
	}
	return a + best;
}

/** Images (Blobs or Files) as addImages takes them, in order. PDF files give one image per page. */
export async function imagesFromPhotos(files) {
	// Une page de PDF est déjà à plat : pas de recherche des coins (pensée pour les photos),
	// qui peut recadrer de travers une page de partition et couper le début des portées.
	const photos = [];
	for (const f of files) {
		if (isPdf(f)) {
			for (const b of await pagesFromPdf(f)) photos.push({ blob: b, flat: true });
		} else {
			photos.push({ blob: f, flat: false });
		}
	}
	const images = [];
	for (const { blob: photo, flat } of photos) {
		const bitmap = await createImageBitmap(photo);
		images.push({
			image: imageFromSource(bitmap, bitmap.width, bitmap.height),
			url: URL.createObjectURL(photo),
			photo,
			flat,
		});
		bitmap.close();
	}
	return images;
}

/**
 * A photo taken with the phone's camera app (full resolution, its focus and
 * HDR), as a Blob; null when closed without one.
 */
export async function takeCameraPhoto() {
	const { Camera } = await import("@capacitor/camera");
	try {
		const { webPath } = await Camera.takePhoto({
			quality: 92,
			correctOrientation: true,
			saveToGallery: false,
			editable: "no",
		});
		return await (await fetch(webPath)).blob();
	} catch (e) {
		if (/cancel/i.test(String(e?.message ?? e))) {
			return null; // closed without a photo
		}
		throw e;
	}
}

/**
 * Chœur Maris Stella : un titre lisible tiré du nom du fichier déposé, quand la
 * partition n'en porte pas (« Iesous_Ahatonnia Quartel (2).pdf » → « Iesous Ahatonnia Quartel »).
 * Vide si le nom n'apporte rien (photo d'appareil, scan numéroté…).
 */
export function titleFromFileName(name) {
	let t = String(name ?? "")
		.replace(/\.[a-z0-9]{2,8}$/i, "") // extension
		.replace(/[_]+/g, " ")
		.replace(/\s*\(\d+\)\s*$/, "") // « (2) » des copies
		.replace(/\s*[-–]?\s*(copie|copy)(\s*\d+)?\s*$/i, "")
		.replace(/\s+\d{1,2}$/, "") // « … 2 » final
		.replace(/\s+/g, " ")
		.trim();
	// noms sans intérêt : IMG_1234, Scan 3, DSC0001, page-2, 20261016_101530…
	if (/^(img|image|dsc|dcim|scan|photo|page|pxl|wp|document|doc)[\s-]*\d*$/i.test(t) || /^[\d\s-]+$/.test(t)) {
		return "";
	}
	return t;
}

