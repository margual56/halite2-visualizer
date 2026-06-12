import type { Replay } from '../parser';

// Player palette from the original Halite II visualizer
export const PLAYER_COLORS = ['#BD00DB', '#63CECA', '#FFBE00', '#C5EC98'];

/** Parse a CSS hex color (#RRGGBB) into {r, g, b} components. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const n = parseInt(hex.slice(1), 16);
	return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** CSS color for a player, by owner id. */
export function playerColor(replay: Replay, ownerId: number): string {
	const idx = replay.playerIndex.get(ownerId) ?? 0;
	return PLAYER_COLORS[idx % PLAYER_COLORS.length];
}
