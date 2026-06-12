/** Maps game-world coordinates onto the canvas (uniform scale, centered). */
export interface Transform {
	scale: number;
	ox: number;
	oy: number;
}

export function makeTransform(
	cw: number,
	ch: number,
	mw: number,
	mh: number,
	margin = 24
): Transform {
	const scale = Math.min((cw - margin * 2) / mw, (ch - margin * 2) / mh);
	return {
		scale,
		ox: (cw - scale * mw) / 2,
		oy: (ch - scale * mh) / 2
	};
}

export function wx(gx: number, t: Transform) {
	return t.ox + gx * t.scale;
}

export function wy(gy: number, t: Transform) {
	return t.oy + gy * t.scale;
}
