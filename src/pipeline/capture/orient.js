// Chœur Maris Stella : page photographiée de travers (téléphone en paysage,
// photo retournée) : le bouton « Tourner » de la page la fait pivoter d'un
// quart de tour. (Une détection automatique a été essayée : savoir qu'une page
// est couchée se mesure bien sur les lignes de portée, mais pas de quel côté —
// une fois sur deux à l'envers ; les téléphones, eux, enregistrent
// l'orientation, que le navigateur applique.)

/** The RGBA image turned by q quarter turns clockwise. */
export function turnImage({ data, width, height }, q) {
	if (!q) {
		return { data, width, height };
	}
	const W = q % 2 ? height : width;
	const H = q % 2 ? width : height;
	const out = new Uint8ClampedArray(W * H * 4);
	const src = new Uint32Array(data.buffer, data.byteOffset, width * height);
	const dst = new Uint32Array(out.buffer);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let X;
			let Y;
			if (q === 1) {
				X = height - 1 - y;
				Y = x;
			} else if (q === 2) {
				X = width - 1 - x;
				Y = height - 1 - y;
			} else {
				X = y;
				Y = width - 1 - x;
			}
			dst[Y * W + X] = src[y * width + x];
		}
	}
	return { data: out, width: W, height: H };
}
