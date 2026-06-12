import type { Replay, TurnRecord } from '../parser';
import { PLAYER_COLORS } from './colors';

/** Turn counter (top-left) and per-player scoreboard pills (top-right). */
export function drawHud(ctx: CanvasRenderingContext2D, replay: Replay, currTurn: TurnRecord) {
	const cw = ctx.canvas.width;
	const hudScale = cw / 640;
	const lineH = Math.round(18 * hudScale);
	const pad = Math.round(12 * hudScale);

	// Turn number
	ctx.font = `bold ${Math.round(12 * hudScale)}px monospace`;
	ctx.fillStyle = 'rgba(255,255,255,0.4)';
	ctx.textAlign = 'left';
	ctx.fillText(`Turn ${currTurn.turn}`, pad, pad + lineH * 0.8);

	// Scoreboard — one row per player, top-right corner
	const isGameOver = currTurn.turn === replay.turns[replay.turns.length - 1].turn;

	// Build live ship counts from current turn
	const liveShipCount = new Map<number, number>();
	for (const ship of currTurn.ships) {
		liveShipCount.set(ship.ownerId, (liveShipCount.get(ship.ownerId) ?? 0) + 1);
	}

	ctx.textAlign = 'right';
	const scoreX = cw - pad;
	let scoreY = pad + lineH * 0.8;
	const fontSize = Math.round(11 * hudScale);
	ctx.font = `bold ${fontSize}px monospace`;

	const sortedPlayers = replay.players
		.map((player, i) => ({ player, i }))
		.sort((a, b) => {
			if (isGameOver && replay.rankings) {
				const ra = replay.rankings.find((r) => r.playerId === a.player.id)?.rank ?? 999;
				const rb = replay.rankings.find((r) => r.playerId === b.player.id)?.rank ?? 999;
				return ra - rb;
			}
			return (liveShipCount.get(b.player.id) ?? 0) - (liveShipCount.get(a.player.id) ?? 0);
		});

	for (const { player, i } of sortedPlayers) {
		const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
		const ships = liveShipCount.get(player.id) ?? 0;

		let label: string;
		if (isGameOver && replay.rankings) {
			const r = replay.rankings.find((r) => r.playerId === player.id);
			if (r) {
				const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉';
				label = `${medal} ${player.name}  ✦${r.shipCount}  ◈${Math.round(r.resources)}`;
			} else {
				label = `${player.name}  ✦${ships}`;
			}
		} else {
			label = `${player.name}  ✦${ships}`;
		}

		// Background pill
		const textW = ctx.measureText(label).width;
		const pillH = lineH * 1.1;
		const pillW = textW + pad * 1.5;
		const pillX = scoreX - pillW;
		const pillY = scoreY - lineH * 0.8;

		ctx.save();
		ctx.globalAlpha = 0.55;
		ctx.fillStyle = '#0a0e1a';
		ctx.beginPath();
		ctx.roundRect(pillX, pillY, pillW, pillH, 4);
		ctx.fill();
		ctx.globalAlpha = 1;

		// Left color bar
		ctx.fillStyle = color;
		ctx.fillRect(pillX, pillY, 3, pillH);
		ctx.restore();

		// Text
		ctx.fillStyle = color;
		ctx.fillText(label, scoreX - pad * 0.5, scoreY);

		scoreY += lineH * 1.3;
	}
}
