import type { Replay } from '../parser';

export const PLAYER_COLORS = ['#EF4444', '#3B82F6', '#22C55E', '#EAB308'];

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
