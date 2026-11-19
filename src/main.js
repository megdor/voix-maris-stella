import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

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
window.addEventListener("vite:preloadError", (e) => {
	if (reloadOnce()) e.preventDefault();
});
window.addEventListener("unhandledrejection", (e) => {
	if (/dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(String(e.reason?.message ?? e.reason))) reloadOnce();
});
// onglet laissé ouvert (téléphone) : au retour, si le site a été mis à jour entre-temps, on prend la nouvelle
// version avant toute lecture (les résultats déjà lus restent dans « Mes partitions »)
let hiddenAt = 0;
const myMain = [...document.scripts].map((x) => x.src).find((x) => /\/assets\/index-[\w-]+\.js$/.test(x));
// la version en ligne est-elle celle de cette page ? (sinon : rechargée, avant qu'on y dépose une partition)
async function checkFresh() {
	if (!myMain) return;
	try {
		const html = await (await fetch(location.pathname + "?check=" + Date.now(), { cache: "no-store" })).text();
		const cur = html.match(/assets\/index-[\w-]+\.js/)?.[0];
		if (cur && !myMain.endsWith(cur)) reloadOnce();
	} catch {
		/* hors ligne : on garde la page telle quelle */
	}
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
