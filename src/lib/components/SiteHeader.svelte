<script lang="ts">
	import { resolve } from '$app/paths';

	let { active = '' }: { active?: string } = $props();

	const links = [
		{ href: '/', label: 'Visualizer' },
		{ href: '/demo', label: 'Demo match' },
		{ href: '/editor', label: 'Bot editor' },
		{ href: '/rules', label: 'Game rules' }
	];
</script>

<header class="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2">
	<a href={resolve('/')} class="font-mono text-sm font-semibold tracking-wide text-teal-400"
		>Halite II</a
	>
	<span class="text-white/30">|</span>
	<nav class="flex items-center gap-4 text-xs">
		{#each links as link (link.href)}
			<a
				href={resolve(link.href)}
				class="{active === link.href
					? 'font-semibold text-white'
					: 'text-white/50'} transition-colors hover:text-teal-400"
			>
				{link.label}
			</a>
		{/each}
	</nav>
</header>
