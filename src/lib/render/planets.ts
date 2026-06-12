import { hexToRgb } from './colors';
import type { Transform } from './transform';

const PLANET_TEXTURE_SRCS = ['/planet.png', '/planet2.png', '/planet3.png'];
let planetTextureCache: HTMLImageElement[] | null = null;

function getPlanetTextures(): HTMLImageElement[] {
	if (!planetTextureCache) {
		planetTextureCache = PLANET_TEXTURE_SRCS.map((src) => {
			const img = new Image();
			img.src = src;
			return img;
		});
	}
	return planetTextureCache;
}

// Random texture + rotation assigned once per planet id, stable within a session.
const planetProps = new Map<number, { textureIdx: number; rotation: number }>();

function getPlanetProps(planetId: number, textureCount: number) {
	if (!planetProps.has(planetId)) {
		planetProps.set(planetId, {
			textureIdx: Math.floor(Math.random() * textureCount),
			rotation: Math.random() * Math.PI * 2,
		});
	}
	return planetProps.get(planetId)!;
}

/**
 * Visual radius in game units: planets shrink toward 40% of their full size
 * as their halite depletes. Docked ships orbit at this same radius.
 */
export function planetVisualSize(size: number, haliteFraction: number): number {
	return size * (0.4 + 0.6 * haliteFraction);
}

/**
 * Draw a planet.
 *
 * The textures are black planets with white crater rims, so the color comes
 * from a solid tinted disc and the texture is added on top with "screen"
 * (black areas pass through, crater rims and sheen light up), finished with
 * radial sphere shading and an outer ring.
 */
export function drawPlanet(
	ctx: CanvasRenderingContext2D,
	px: number,
	py: number,
	radius: number,
	planetId: number,
	ownerColor: string | null,
	haliteFraction: number
) {
	const textures = getPlanetTextures();
	const props = getPlanetProps(planetId, textures.length);
	const texture = textures[props.textureIdx];

	ctx.save();

	// --- Clip to circle ---
	ctx.beginPath();
	ctx.arc(px, py, radius, 0, Math.PI * 2);
	ctx.clip();

	// --- Base color disc ---
	// Neutral/undocked planets get a cool grey-blue; owned ones the player color.
	const tintColor = ownerColor ?? '#aab9d4';

	// Halite-based saturation: full halite = full tint, depleted = grey.
	const { r, g, b } = hexToRgb(tintColor);
	const grey = 152;
	const mix = 0.35 + haliteFraction * 0.65; // range 0.35–1.0
	// Darken the base so the screened white details read as lit relief
	const base = 0.55;
	const tr = Math.round((grey + (r - grey) * mix) * base);
	const tg = Math.round((grey + (g - grey) * mix) * base);
	const tb = Math.round((grey + (b - grey) * mix) * base);

	ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
	ctx.beginPath();
	ctx.arc(px, py, radius, 0, Math.PI * 2);
	ctx.fill();

	// --- Texture detail (screen blend lights up crater rims and sheen) ---
	if (texture.complete && texture.naturalWidth > 0) {
		const angle = props.rotation;
		// Scale texture so it fills the diameter (2*radius), with a tiny 5% overshoot
		// so rotation never reveals a gap at the edges.
		const texSize = radius * 2 * 1.05;
		ctx.save();
		ctx.translate(px, py);
		ctx.rotate(angle);
		ctx.globalCompositeOperation = 'screen';
		ctx.globalAlpha = 0.85;
		ctx.drawImage(texture, -texSize / 2, -texSize / 2, texSize, texSize);
		ctx.restore();
	}

	// --- Sphere shading: soft light from the upper-left, shadow at lower-right ---
	const shade = ctx.createRadialGradient(
		px - radius * 0.45,
		py - radius * 0.45,
		radius * 0.1,
		px,
		py,
		radius * 1.35
	);
	shade.addColorStop(0, 'rgba(255,255,255,0.28)');
	shade.addColorStop(0.5, 'rgba(255,255,255,0)');
	shade.addColorStop(1, 'rgba(0,0,0,0.4)');
	ctx.fillStyle = shade;
	ctx.beginPath();
	ctx.arc(px, py, radius, 0, Math.PI * 2);
	ctx.fill();

	ctx.restore(); // removes clip

	// --- Outer ring (on top of clip so it's always crisp) ---
	ctx.beginPath();
	ctx.arc(px, py, radius, 0, Math.PI * 2);
	ctx.strokeStyle = ownerColor
		? `${ownerColor}88` // colored ring for owned
		: 'rgba(255,255,255,0.18)';
	ctx.lineWidth = ownerColor ? 2 : 1;
	ctx.stroke();
}

/** Faint dashed circle hinting at the docking radius. */
export function drawDockingHint(
	ctx: CanvasRenderingContext2D,
	px: number,
	py: number,
	radius: number,
	t: Transform
) {
	ctx.beginPath();
	ctx.arc(px, py, radius + 4 * t.scale, 0, Math.PI * 2);
	ctx.strokeStyle = 'rgba(255,255,255,0.05)';
	ctx.setLineDash([3, 5]);
	ctx.stroke();
	ctx.setLineDash([]);
}
