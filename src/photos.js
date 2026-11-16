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
const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name ?? "");
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
		const scale = Math.min(300 / 72, 3600 / Math.max(base.width, base.height));
		const viewport = page.getViewport({ scale });
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(viewport.width);
		canvas.height = Math.round(viewport.height);
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "#fff";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		await page.render({ canvasContext: ctx, canvas, viewport }).promise;
		blobs.push(await new Promise((res) => canvas.toBlob(res, "image/png")));
		page.cleanup();
	}
	await task.destroy(); // libère la mémoire du document
	return blobs;
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

