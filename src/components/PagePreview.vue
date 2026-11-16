<script setup>
// The page, flattened and cleaned, as it will be recognized.
import { useOmrState } from "../useOmr.js";
import ExportButtons from "./ExportButtons.vue";

const omr = useOmrState();
</script>

<template>
	<figure class="page-preview">
		<img
			v-if="omr.page.pageUrl"
			:src="omr.page.pageUrl"
			class="page"
			:class="{ stale: omr.page.flattening }"
			alt="La page redressée et nettoyée"
		/>
		<div v-else class="page placeholder">
			{{ omr.page.captureState === "detecting" ? "" : "Flattening…" }}
		</div>
		<figcaption>La page telle qu’elle sera lue.</figcaption>
		<ExportButtons step="pages" label="Exporter les pages" />
	</figure>
</template>
