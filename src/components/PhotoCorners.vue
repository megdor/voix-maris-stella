<script setup>
// The photo with the page's corners, draggable.
import { useOmrState } from "../useOmr.js";
import PageCorners from "./PageCorners.vue";

const omr = useOmrState();
</script>

<template>
	<figure class="photo-corners">
		<PageCorners
			:key="omr.page.id"
			v-model="omr.page.quad"
			:src="omr.page.previewUrl"
			:width="omr.page.image.width"
			:height="omr.page.image.height"
			@commit="omr.onCornersCommit"
		/>
		<figcaption>
			<template v-if="omr.page.captureState === 'flat'">Page de PDF, lue entière. Si besoin, déplacez les coins pour recadrer.</template>
			<template v-else-if="omr.page.captureState === 'detecting'">Recherche de la page…</template>
			<template v-else-if="omr.page.captureState === 'found'">Page trouvée. Déplacez les coins pour ajuster si besoin.</template>
			<template v-else-if="omr.page.captureState === 'not-found'">Page non trouvée : placez les coins sur les coins de la page.</template>
			<template v-else-if="omr.page.captureState === 'error'">Détection de la page indisponible ({{ omr.page.captureError }}) : placez les coins sur les coins de la page.</template>
		</figcaption>
		<div class="row">
			<button class="secondary" :disabled="!omr.page.detectedQuad" @click="omr.resetCorners">
				Coins détectés
			</button>
			<button class="secondary" @click="omr.useWholePhoto">Photo entière</button>
		</div>
	</figure>
</template>
