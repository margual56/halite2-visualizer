<script lang="ts">
	import { parseReplay } from '$lib/parser';
	import { render, PLAYER_COLORS } from '$lib/renderer';
	import type { Replay, TurnRecord } from '$lib/parser';

	const SUB_FRAMES = 4;
	const BASE_FPS = 30;

	let replay = $state<Replay | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(false);

	let isPlaying = $state(false);
	let speed = $state(1);
	let frame = $state(0);

	let canvasEl: HTMLCanvasElement | undefined = $state();
	let frameF = 0;
	let rafId = -1;
	let lastTs = -1;
	let dragging = $state(false);

	const totalFrames = $derived((replay?.turns.length ?? 0) * SUB_FRAMES);
	const currentTurn = $derived(Math.floor(frame / SUB_FRAMES));

	// ── File loading ──────────────────────────────────────────────────────────

	async function loadFile(file: File) {
		loading = true;
		error = null;
		try {
			const buf = await file.arrayBuffer();
			replay = parseReplay(buf);
			frame = 0;
			frameF = 0;
			isPlaying = true;
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function onFileInput(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) loadFile(file);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		const file = e.dataTransfer?.files[0];
		if (file) loadFile(file);
	}

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

<div
	class="flex h-screen flex-col bg-gray-950 text-white select-none"
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={onDrop}
	role="region"
	aria-label="Halite II replay viewer"
>
	<!-- Header -->
	<header class="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2">
		<span class="font-mono text-sm font-semibold tracking-wide text-teal-400">Halite II</span>
		<span class="text-white/30">|</span>

		<label
			class="cursor-pointer rounded bg-white/10 px-3 py-1 text-xs font-medium hover:bg-white/20"
		>
			Open .hlt
			<input type="file" accept=".hlt" class="hidden" onchange={onFileInput} />
		</label>

		{#if replay}
			<span class="text-xs text-white/40">
				{replay.width}×{replay.height} · {replay.turns.length} turns
			</span>
			<div class="ml-auto flex items-center gap-3">
				{#each replay.players as player, i (i)}
					<div class="flex items-center gap-1.5 text-xs">
						<span
							class="inline-block h-2.5 w-2.5 rounded-full"
							style="background:{PLAYER_COLORS[i % PLAYER_COLORS.length]}"
						></span>
						<span class="text-white/70">{player.name || `Bot ${i}`}</span>
					</div>
				{/each}
			</div>
		{/if}
	</header>

	<!-- Canvas area -->
	<main class="relative min-h-0 flex-1">
		{#if !replay && !loading}
			<div
				class="absolute inset-0 flex flex-col items-center justify-center gap-4 transition-colors {dragging
					? 'bg-teal-900/20'
					: ''}"
			>
				<div
					class="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-16 py-12 text-center transition-colors {dragging
						? 'border-teal-400'
						: 'border-white/20'}"
				>
					<svg
						class="mb-2 h-12 w-12 transition-colors {dragging ? 'text-teal-400' : 'text-white/20'}"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
						/>
					</svg>
					<p class="text-sm font-medium text-white/60">
						Drop a <code class="text-teal-400">.hlt</code> replay file here
					</p>
					<p class="text-xs text-white/30">or use the Open button above</p>
				</div>
				{#if error}
					<p class="text-sm text-red-400">{error}</p>
				{/if}
			</div>
		{:else if loading}
			<div class="absolute inset-0 flex items-center justify-center">
				<p class="text-sm text-white/40">Parsing replay…</p>
			</div>
		{/if}

		<canvas bind:this={canvasEl} class="h-full w-full" class:hidden={!replay}></canvas>

		{#if dragging && replay}
			<div
				class="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-medium text-teal-400"
			>
				Drop to load new replay
			</div>
		{/if}
	</main>

	<!-- Controls -->
	{#if replay}
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
	{/if}
</div>
