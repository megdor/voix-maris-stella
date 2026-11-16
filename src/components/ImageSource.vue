<script setup>
// Add pages: images picked (several at once: in file-name order) or
// photographed with the camera: in the app, the phone's own camera app (full
// resolution, focus, HDR); on the website, a camera preview in the page, the
// photo a still at the camera's best resolution where the browser can take
// one (else a frame of the preview).
import { Capacitor } from "@capacitor/core";
import { onBeforeUnmount, ref } from "vue";
import { imagesFromPhotos, takeCameraPhoto, titleFromFileName } from "../photos.js";
import { imageFromSource } from "../pipeline/index.js";
import { useOmrState } from "../useOmr.js";

const omr = useOmrState();

const cameraActive = ref(false);
const videoEl = ref(null);
let cameraStream = null;

const byName = new Intl.Collator(undefined, { numeric: true }).compare;

async function onFileChange(event) {
	const files = [...(event.target.files ?? [])].sort((a, b) =>
		byName(a.name, b.name),
	);
	event.target.value = "";
	if (files.length === 0) {
		return;
	}
	stopCamera();
	await addPhotos(files);
}

/** Add images (Blobs or Files) as pages, in order. */
async function addPhotos(photos) {
	// pas encore de titre : celui du fichier déposé (modifiable au-dessus de la partition)
	if (!String(omr.title ?? "").trim()) {
		const t = titleFromFileName(photos[0]?.name);
		if (t) {
			omr.title = t;
		}
	}
	omr.addImages(await imagesFromPhotos(photos));
}

const native = Capacitor.isNativePlatform();
const taking = ref(false); // the phone's camera app is open

/** In the app: a photo with the phone's camera app. */
async function takeNativePhoto() {
	taking.value = true;
	try {
		const photo = await takeCameraPhoto();
		if (photo) {
			await addPhotos([photo]);
		}
	} catch (e) {
		console.error(e);
		omr.error = `Camera unavailable: ${e?.message ?? e}`;
	} finally {
		taking.value = false;
	}
}

async function startCamera() {
	if (native) {
		return takeNativePhoto();
	}
	try {
		cameraStream = await navigator.mediaDevices.getUserMedia({
			// the best the camera offers (without a size, browsers give 640×480)
			video: {
				facingMode: "environment",
				width: { ideal: 4096 },
				height: { ideal: 3072 },
			},
		});
		cameraActive.value = true;
		// Wait a tick for the <video> element to exist
		requestAnimationFrame(() => {
			if (videoEl.value) {
				videoEl.value.srcObject = cameraStream;
			}
		});
	} catch (e) {
		omr.error = `Camera unavailable: ${e.message}`;
	}
}

async function capturePhoto() {
	const video = videoEl.value;
	if (!video || video.videoWidth === 0) {
		return;
	}
	// a still photo, at the camera's photo resolution (Chrome, Edge…)
	const track = cameraStream?.getVideoTracks()[0];
	if (track && typeof ImageCapture !== "undefined") {
		try {
			const photo = await new ImageCapture(track).takePhoto();
			stopCamera();
			await addPhotos([photo]);
			return;
		} catch (e) {
			console.warn("No still photo, a frame of the preview instead:", e);
		}
	}
	const image = imageFromSource(video, video.videoWidth, video.videoHeight);
	const canvas = document.createElement("canvas");
	canvas.width = image.width;
	canvas.height = image.height;
	canvas
		.getContext("2d")
		.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
	stopCamera();
	const photo = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92));
	omr.addImages([{ image, url: URL.createObjectURL(photo), photo }]);
}

function stopCamera() {
	if (cameraStream) {
		for (const track of cameraStream.getTracks()) {
			track.stop();
		}
		cameraStream = null;
	}
	cameraActive.value = false;
}

onBeforeUnmount(stopCamera);
</script>

<template>
	<div class="image-source">
		<div class="row">
			<label class="file-label">
				{{ omr.pages.length ? "Ajouter des pages" : "Choisir le PDF ou les photos" }}
				<input type="file" accept="image/*,application/pdf" multiple @change="onFileChange" />
			</label>
			<button v-if="!cameraActive" class="secondary" :disabled="taking" @click="startCamera">
				{{ omr.pages.length ? "Ajouter une photo" : "Prendre une photo" }}
			</button>
			<template v-else>
				<button @click="capturePhoto">Photographier</button>
				<button class="secondary" @click="stopCamera">Annuler</button>
			</template>
		</div>
		<p class="hint">
			Un PDF, ou une photo par page. Pour une photo : page à plat, bien éclairée, entière dans
			le cadre — l'idéal est le scanner de documents du téléphone.
		</p>
		<video v-if="cameraActive" ref="videoEl" autoplay playsinline></video>
	</div>
</template>
