<script lang="ts">
	import type { Replay, TurnRecord } from '$lib/parser';
	import { render } from '$lib/renderer';

	const SUB_FRAMES = 4;
	const BASE_FPS = 30;

	let { replay, autoplay = true }: { replay: Replay; autoplay?: boolean } = $props();

	// Starts paused; the reset effect below applies `autoplay` on mount and
	// whenever a new replay is passed in.
	let isPlaying = $state(false);
	let speed = $state(1);
	let frame = $state(0);

	let canvasEl: HTMLCanvasElement | undefined = $state();
	let frameF = 0;
	let rafId = -1;
	let lastTs = -1;

	const totalFrames = $derived(replay.turns.length * SUB_FRAMES);
	const currentTurn = $derived(Math.floor(frame / SUB_FRAMES));

	// Restart playback whenever a different replay is passed in
	$effect(() => {
		void replay;
		frame = 0;
		frameF = 0;
		isPlaying = autoplay;
	});

	// ── Canvas resize ─────────────────────────────────────────────────────────

	$effect(() => {
		if (!canvasEl) return;
		const obs = new ResizeObserver(() => {
			if (!canvasEl) return;
			const dpr = window.devicePixelRatio ?? 1;
			canvasEl.width = canvasEl.offsetWidth * dpr;
			canvasEl.height = canvasEl.offsetHeight * dpr;
			drawFrame();
		});
		obs.observe(canvasEl);
		return () => obs.disconnect();
	});

	// ── Render ────────────────────────────────────────────────────────────────

	function drawFrame() {
		if (!canvasEl || !replay) return;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;
		const turnIdx = Math.min(replay.turns.length - 1, Math.floor(frameF / SUB_FRAMES));
		const alpha = (frameF % SUB_FRAMES) / SUB_FRAMES;
		const curr: TurnRecord = replay.turns[turnIdx];
		const prev: TurnRecord = replay.turns[Math.max(0, turnIdx - 1)];
		render(ctx, replay, prev, curr, alpha);
	}

	// ── Animation loop ────────────────────────────────────────────────────────

	function startLoop() {
		if (rafId !== -1) return;
		lastTs = -1;
		function loop(ts: number) {
			if (lastTs === -1) lastTs = ts;
			const dt = (ts - lastTs) / 1000;
			lastTs = ts;
			frameF = (frameF + dt * BASE_FPS * speed) % totalFrames;
			frame = Math.floor(frameF);
			drawFrame();
			rafId = requestAnimationFrame(loop);
		}
		rafId = requestAnimationFrame(loop);
	}

	function stopLoop() {
		if (rafId !== -1) {
			cancelAnimationFrame(rafId);
			rafId = -1;
		}
	}

	$effect(() => {
		if (isPlaying && replay) startLoop();
		else stopLoop();
		return () => stopLoop();
	});

	// ── Controls ──────────────────────────────────────────────────────────────

	function togglePlay() {
		isPlaying = !isPlaying;
	}

	function scrub(e: Event) {
		const v = Number((e.target as HTMLInputElement).value);
		frame = v;
		frameF = v;
		if (!isPlaying) drawFrame();
	}

	function stepFrame(delta: number) {
		frame = (((frame + delta) % totalFrames) + totalFrames) % totalFrames;
		frameF = frame;
		if (!isPlaying) drawFrame();
	}

	const SPEEDS = [0.25, 0.5, 1, 2, 4];
	function cycleSpeed() {
		speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
	}
</script>

<div class="flex h-full min-h-0 flex-col">
	<div class="relative min-h-0 flex-1">
		<canvas bind:this={canvasEl} class="h-full w-full"></canvas>
	</div>

	<footer class="flex shrink-0 items-center gap-3 border-t border-white/10 px-4 py-2">
		<button
			onclick={() => stepFrame(-1)}
			class="rounded px-2 py-1 text-xs text-white/50 hover:text-white"
			aria-label="Step back">⏮</button
		>

		<button
			onclick={togglePlay}
			class="rounded bg-teal-600 px-3 py-1 text-xs font-semibold hover:bg-teal-500 active:bg-teal-700"
		>
			{isPlaying ? '⏸ Pause' : '▶ Play'}
		</button>

		<button
			onclick={() => stepFrame(1)}
			class="rounded px-2 py-1 text-xs text-white/50 hover:text-white"
			aria-label="Step forward">⏭</button
		>

		<input
			type="range"
			min="0"
			max={totalFrames - 1}
			value={frame}
			oninput={scrub}
			class="mx-1 flex-1 accent-teal-500"
		/>

		<span class="w-24 text-right font-mono text-xs text-white/40">
			{currentTurn + 1} / {replay.turns.length}
		</span>

		<button
			onclick={cycleSpeed}
			class="w-12 rounded bg-white/10 px-2 py-1 text-center font-mono text-xs font-semibold hover:bg-white/20"
		>
			{speed}×
		</button>
	</footer>
</div>
