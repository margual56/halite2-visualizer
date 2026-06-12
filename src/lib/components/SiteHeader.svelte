<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';

	let { active = '', children, center }: { active?: string; children?: Snippet; center?: Snippet } = $props();

	const links = [
		{ href: '/', label: 'Visualizer', short: 'Home' },
		{ href: '/demo', label: 'Demo match', short: 'Demo' },
		{ href: '/editor', label: 'Bot editor', short: 'Editor' },
		{ href: '/rules', label: 'Game rules', short: 'Rules' },
	] as const;
</script>

<!--
  Mobile:  flex — logo left, nav right (ml-auto, short labels).
  Desktop: 3-col grid — [logo + nav] | [center slot] | [children].
-->
<header class="flex shrink-0 items-center border-b border-white/10 px-4 py-2 sm:grid sm:grid-cols-[auto_1fr_auto]">

	<!-- Left: logo + desktop nav -->
	<div class="flex items-center gap-4">
		<a href={resolve('/')} class="shrink-0 whitespace-nowrap font-mono text-sm font-semibold tracking-wide text-teal-400"
			>Halite II</a
		>
		<nav class="hidden items-center gap-4 text-xs sm:flex">
			{#each links as link (link.href)}
				<a
					href={resolve(link.href)}
					class="{active === link.href ? 'font-semibold text-white' : 'text-white/50'} transition-colors hover:text-teal-400"
				>{link.label}</a>
			{/each}
		</nav>
	</div>

	<!-- Center: desktop only -->
	<div class="hidden justify-center px-3 sm:flex">
		{#if center}{@render center()}{/if}
	</div>

	<!-- Right: mobile nav + desktop children -->
	<div class="ml-auto flex items-center gap-4 sm:ml-0">
		{#if children}
			<div class="hidden items-center gap-4 sm:flex">
				{@render children()}
			</div>
		{/if}
		<nav class="flex items-center gap-2 text-xs sm:hidden">
			{#each links as link (link.href)}
				<a
					href={resolve(link.href)}
					class="{active === link.href ? 'font-semibold text-white' : 'text-white/50'} transition-colors hover:text-teal-400"
				>{link.short}</a>
			{/each}
		</nav>
	</div>

</header>
