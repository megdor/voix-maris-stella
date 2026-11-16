<script setup>
// The website: the header, the steps and the credits. The app: its home
// screen (the saved scores, the credits behind ⓘ), or a score. The state is
// shared through "omr" (useOmr.js).
import { provide } from "vue";
import AboutText from "./components/AboutText.vue";
import ScoreLibrary from "./components/ScoreLibrary.vue";
import StepTabs from "./components/StepTabs.vue";
import { isApp } from "./pipeline/index.js";
import { useOmr } from "./useOmr.js";

const omr = useOmr();
provide("omr", omr);
</script>

<template>
	<ScoreLibrary v-if="isApp && omr.screen === 'menu'" />
	<template v-else-if="isApp">
		<header class="app-bar">
			<button class="back" title="Mes partitions" @click="omr.closeScore">
				<span aria-hidden="true">←</span> My scores
			</button>
			<span v-if="!omr.docId" class="hint">Enregistrée une fois lue</span>
		</header>
		<div class="app">
			<StepTabs />
		</div>
	</template>
	<div v-else class="app">
		<header>
			<h1>🎼 Chœur Maris Stella — Lire une partition</h1>
			<p>
				Déposez le PDF ou les photos d'une partition : elle est lue dans votre navigateur,
				rien n'est envoyé. Puis « 🎵 Travailler les voix ».
				<a href="voix.html">Ouvrir le lecteur de voix</a>
			</p>
		</header>
		<StepTabs />
		<footer>
			<details>
				<summary>À propos et licences (MusicOCR, copista…)</summary>
				<AboutText />
			</details>
		</footer>
	</div>
</template>

<style scoped>
.app-bar {
	position: sticky;
	top: 0;
	z-index: 5;
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: calc(0.5rem + env(safe-area-inset-top)) 0.75rem 0.5rem;
	background: var(--panel);
	border-bottom: 1px solid var(--border);
}

.app-bar .back {
	background: none;
	color: var(--ink);
	padding: 0.5rem 0.6rem;
	font-size: 1rem;
}

.app-bar .hint {
	font-size: 0.85rem;
}

footer {
	margin-top: 2rem;
	color: var(--muted);
	font-size: 0.85rem;
}

footer summary {
	cursor: pointer;
}
</style>
