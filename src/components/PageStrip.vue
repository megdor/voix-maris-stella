<script setup>
// The pages, in score order, as thumbnails: click one to show it; the
// current one can be moved earlier / later or removed.
import { useOmrState } from "../useOmr.js";

defineProps({
	// the thumbnails: the photos, or the pages flattened and cleaned
	show: { type: String, default: "photo" }, // "photo" | "page"
});
const omr = useOmrState();
</script>

<template>
	<div class="page-strip">
		<ol>
			<li v-for="(p, i) in omr.pages" :key="p.id">
				<button
					class="thumb"
					:class="{ current: i === omr.currentIndex }"
					:aria-current="i === omr.currentIndex ? 'page' : undefined"
					:title="`Page ${i + 1}`"
					@click="omr.selectPage(i)"
				>
					<img
						v-if="show === 'photo' || p.pageUrl"
						:src="show === 'photo' ? p.previewUrl : p.pageUrl"
						:alt="`Page ${i + 1}`"
					/>
					<span class="number">
						{{ i + 1 }}<template v-if="p.captureState === 'detecting'"> …</template>
					</span>
				</button>
			</li>
		</ol>
		<div v-if="omr.pages.length > 1" class="actions">
			<button
				class="secondary"
				:disabled="omr.currentIndex === 0"
				title="Avancer cette page"
				@click="omr.movePage(omr.currentIndex, -1)"
			>
				◀ Avant
			</button>
			<button
				class="secondary"
				:disabled="omr.currentIndex === omr.pages.length - 1"
				title="Reculer cette page"
				@click="omr.movePage(omr.currentIndex, 1)"
			>
				Après ▶
			</button>
			<button
				class="secondary"
				title="Retirer cette page"
				@click="omr.removePage(omr.currentIndex)"
			>
				✕ Retirer la page {{ omr.currentIndex + 1 }}
			</button>
		</div>
		<div v-else class="actions">
			<button class="secondary" title="Retirer cette page" @click="omr.removePage(0)">
				✕ Retirer
			</button>
		</div>
	</div>
</template>

<style scoped>
.page-strip {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem 1rem;
	align-items: center;
	margin: 1rem 0 0.5rem;
}

ol {
	display: flex;
	gap: 0.5rem;
	list-style: none;
	margin: 0;
	padding: 0 0 0.25rem;
	overflow-x: auto;
	max-width: 100%;
}

.thumb {
	position: relative;
	display: block;
	width: 64px;
	height: 84px;
	padding: 0;
	background: var(--bg);
	border: 2px solid var(--border);
	border-radius: 6px;
	overflow: hidden;
}

.thumb.current {
	border-color: var(--accent);
	box-shadow: 0 0 0 2px var(--accent);
}

.thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.number {
	position: absolute;
	left: 3px;
	bottom: 3px;
	padding: 0 0.3rem;
	border-radius: 4px;
	background: rgb(0 0 0 / 0.6);
	color: #fff;
	font-size: 0.75rem;
}

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
}

.actions button {
	padding: 0.35rem 0.7rem;
	font-size: 0.85rem;
}
</style>
