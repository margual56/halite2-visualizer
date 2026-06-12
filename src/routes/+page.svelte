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

	// ── SEO ───────────────────────────────────────────────────────────────────

	const siteUrl = 'https://halite2.pages.dev';
	const pageTitle = 'Halite II Replay Visualizer — Watch .hlt Replays in Your Browser';
	const pageDescription =
		'Free online replay viewer for Halite II, the AI programming game. Drop a .hlt replay to watch matches, and write bots in Python, Go, Rust or Zig with the open-source engine.';

	const jsonLd = JSON.stringify({
		'@context': 'https://schema.org',
		'@type': 'WebApplication',
		name: 'Halite II Replay Visualizer',
		applicationCategory: 'DeveloperApplication',
		operatingSystem: 'Web',
		url: siteUrl,
		description: pageDescription,
		about: {
			'@type': 'VideoGame',
			name: 'Halite II',
			description:
				'An AI programming challenge where bots pilot fleets of spaceships to mine halite, dock planets and battle for control of the map.'
		},
		offers: { '@type': 'Offer', price: '0' },
		sameAs: ['https://github.com/margual56/halite2', 'https://github.com/HaliteChallenge/Halite-II']
	});
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDescription} />
	<meta
		name="keywords"
		content="Halite II, replay visualizer, hlt replay viewer, AI programming game, bot programming, Zig game engine, Two Sigma Halite, programming challenge"
	/>
	<link rel="canonical" href={siteUrl} />

	<meta property="og:type" content="website" />
	<meta property="og:url" content={siteUrl} />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDescription} />
	<meta property="og:image" content="{siteUrl}/planet.png" />

	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={pageTitle} />
	<meta name="twitter:description" content={pageDescription} />
	<meta name="twitter:image" content="{siteUrl}/planet.png" />

	{@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

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
				class="absolute inset-0 overflow-y-auto transition-colors {dragging
					? 'bg-teal-900/20'
					: ''}"
			>
				<article class="mx-auto flex max-w-2xl flex-col items-center gap-10 px-6 py-12">
					<!-- Hero -->
					<div class="text-center">
						<h1 class="text-3xl font-bold tracking-tight text-white">
							Halite&nbsp;II Replay Visualizer
						</h1>
						<p class="mt-3 text-sm text-white/60">
							Watch <code class="text-teal-400">.hlt</code> replays of the Halite&nbsp;II AI programming
							game — right in your browser.
						</p>
					</div>

					<!-- Drop zone -->
					<div
						class="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-16 py-12 text-center transition-colors {dragging
							? 'border-teal-400'
							: 'border-white/20'}"
					>
						<svg
							class="mb-2 h-12 w-12 transition-colors {dragging
								? 'text-teal-400'
								: 'text-white/20'}"
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

					<!-- About Halite II -->
					<section class="w-full space-y-3">
						<h2 class="text-lg font-semibold text-white">What is Halite&nbsp;II?</h2>
						<p class="text-sm leading-relaxed text-white/60">
							<strong class="text-white/80">Halite&nbsp;II</strong> is an artificial-intelligence
							programming challenge originally created by
							<a
								href="https://github.com/HaliteChallenge/Halite-II"
								class="text-teal-400 hover:underline"
								target="_blank"
								rel="noopener">Two Sigma in 2017</a
							>. You don't play it with a controller — you write a <em>bot</em> that plays for you. Each
							turn, every player's bot commands a fleet of spaceships: fly across the map, dock planets
							to mine halite and produce new ships, and fight enemy fleets for control. The last fleet
							standing — or the strongest when the turn limit hits — wins.
						</p>
						<p class="text-sm leading-relaxed text-white/60">
							The original game and tools are open source in the
							<a
								href="https://github.com/HaliteChallenge/Halite-II"
								class="text-teal-400 hover:underline"
								target="_blank"
								rel="noopener">HaliteChallenge/Halite-II</a
							> repository.
						</p>
					</section>

					<!-- The Zig engine -->
					<section class="w-full space-y-3">
						<h2 class="text-lg font-semibold text-white">
							A modern Halite&nbsp;II engine, rewritten in Zig
						</h2>
						<p class="text-sm leading-relaxed text-white/60">
							This visualizer is built for
							<a
								href="https://github.com/margual56/halite2"
								class="text-teal-400 hover:underline"
								target="_blank"
								rel="noopener">margual56/halite2</a
							>, an updated, from-scratch implementation of the Halite&nbsp;II engine written in
							<strong class="text-white/80">Zig</strong> — fast, dependency-free, and ready to run locally.
						</p>
						<ol class="list-inside list-decimal space-y-2 text-sm leading-relaxed text-white/60">
							<li>
								Download the engine from the
								<a
									href="https://github.com/margual56/halite2/releases"
									class="text-teal-400 hover:underline"
									target="_blank"
									rel="noopener">releases page</a
								>.
							</li>
							<li>
								Write your bot starting from the
								<a
									href="https://github.com/margual56/halite2/tree/main/starter-packs"
									class="text-teal-400 hover:underline"
									target="_blank"
									rel="noopener"><code>starter-packs</code></a
								>
								folder — available for <strong class="text-white/80">Python</strong>,
								<strong class="text-white/80">Go</strong>,
								<strong class="text-white/80">Rust</strong>
								and <strong class="text-white/80">Zig</strong>.
							</li>
							<li>
								Run a match, e.g.
								<code class="rounded bg-white/10 px-1.5 py-0.5 text-xs text-teal-300"
									>halite2 "python3 MyBot.py" "python3 MyBot.py"</code
								>
								— the engine writes a <code class="text-teal-400">replay.hlt</code> file.
							</li>
							<li>Drop the replay here and watch your bots fight.</li>
						</ol>
					</section>

					<!-- Footer links -->
					<footer
						class="flex w-full flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-white/10 pt-6 text-xs text-white/40"
					>
						<a
							href="https://github.com/margual56/halite2"
							class="hover:text-teal-400"
							target="_blank"
							rel="noopener">Zig engine</a
						>
						<a
							href="https://github.com/margual56/halite2/releases"
							class="hover:text-teal-400"
							target="_blank"
							rel="noopener">Downloads</a
						>
						<a
							href="https://github.com/margual56/halite2/tree/main/starter-packs"
							class="hover:text-teal-400"
							target="_blank"
							rel="noopener">Starter packs</a
						>
						<a
							href="https://github.com/HaliteChallenge/Halite-II"
							class="hover:text-teal-400"
							target="_blank"
							rel="noopener">Original Halite&nbsp;II</a
						>
					</footer>
				</article>
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
