import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

const myMain = [...document.scripts].map((x) => x.src).find((x) => /\/assets\/index-[\w-]+\.js$/.test(x));

// Après une mise à jour du site, une page ouverte avant réclame des modules qui n'existent plus :
// on la recharge une fois (nouvelle version), au lieu d'afficher « Failed to fetch dynamically imported module ».
function reloadOnce() {
	const k = "voix-reload-" + location.pathname;
	if (sessionStorage.getItem(k)) return false;
	sessionStorage.setItem(k, "1");
	const u = new URL(location.href);
	u.searchParams.set("v", Date.now().toString(36));
	location.replace(u.toString());
	return true;
}
// Un module qui ne se charge pas : site mis à jour (on recharge) ou réseau coupé un instant (téléphone
// qui sort de veille : on NE recharge PAS, la lecture en cours serait perdue ; l'erreur s'affiche et
// l'on peut relancer).
async function siteChanged() {
	if (!myMain) return null;
	try {
		const html = await (await fetch(location.pathname + "?check=" + Date.now(), { cache: "no-store" })).text();
		const cur = html.match(/assets\/index-[\w-]+\.js/)?.[0];
		return cur ? !myMain.endsWith(cur) : null;
	} catch {
		return null; // hors ligne
	}
}
const onImportFailed = () => siteChanged().then((changed) => changed && reloadOnce());
window.addEventListener("vite:preloadError", onImportFailed);
window.addEventListener("unhandledrejection", (e) => {
	if (/dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(String(e.reason?.message ?? e.reason))) onImportFailed();
});
// onglet laissé ouvert (téléphone) : au retour, si le site a été mis à jour entre-temps, on prend la nouvelle
// version avant toute lecture (les résultats déjà lus restent dans « Mes partitions »)
let hiddenAt = 0;
// la version en ligne est-elle celle de cette page ? (sinon : rechargée, avant qu'on y dépose une partition)
async function checkFresh() {
	// des pages déposées ou une lecture en cours : on ne recharge pas sous les doigts de l'utilisateur
	if (window.__voixBusy) return;
	if (await siteChanged()) reloadOnce();
}
document.addEventListener("visibilitychange", () => {
	if (document.hidden) {
		hiddenAt = Date.now();
		return;
	}
	if (hiddenAt && Date.now() - hiddenAt >= 10 * 60 * 1000) checkFresh();
});
// au chargement aussi : le navigateur garde la page d'accueil en cache une dizaine de minutes après une
// mise à jour, et l'ancienne page réclamerait des modules supprimés au premier dépôt de PDF
checkFresh();
// la page a démarré avec la version courante : un prochain problème pourra recharger à nouveau
setTimeout(() => sessionStorage.removeItem("voix-reload-" + location.pathname), 30000);

createApp(App).mount("#app");
