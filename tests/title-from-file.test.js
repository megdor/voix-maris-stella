import { describe, expect, it } from "vitest";
import { titleFromFileName } from "../src/photos.js";

describe("titleFromFileName", () => {
	it("tire le titre du nom du fichier", () => {
		expect(titleFromFileName("Iesous Ahatonnia Quartel typographié 2.pdf")).toBe("Iesous Ahatonnia Quartel typographié");
		expect(titleFromFileName("Ave_Maria_Bruckner (1).pdf")).toBe("Ave Maria Bruckner");
		expect(titleFromFileName("Deliver us - copie.png")).toBe("Deliver us");
	});
	it("ignore les noms sans intérêt", () => {
		expect(titleFromFileName("IMG_1234.jpg")).toBe("");
		expect(titleFromFileName("Scan 3.pdf")).toBe("");
		expect(titleFromFileName("20261016_101530.jpg")).toBe("");
		expect(titleFromFileName(undefined)).toBe("");
	});
});
