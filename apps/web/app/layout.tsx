import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import { Geist, Geist_Mono, IBM_Plex_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const geist = Geist({
	subsets: ['latin'],
	variable: '--font-geist',
});

const geistMono = Geist_Mono({
	subsets: ['latin'],
	variable: '--font-geist-mono',
});

const ibmPlexMono = IBM_Plex_Mono({
	weight: ['400', '700'],
	subsets: ['latin'],
	variable: '--font-ibm-plex-mono',
});

const siteUrl = 'https://swarmtools.ai';

export const metadata: Metadata = {
	metadataBase: new URL(siteUrl),
	title: {
		default: 'Swarm Tools - Multi-Agent Coordination Primitives',
		template: '%s | Swarm Tools',
	},
	description: 'Event sourcing, multi-agent coordination, and durable execution patterns for AI coding assistants. TypeScript primitives.',
	keywords: ['swarm', 'multi-agent', 'AI', 'event sourcing', 'coordination', 'Effect-TS', 'OpenCode', 'agentic'],
	authors: [{ name: 'Imamuzzaki Abu Salam', url: 'https://github.com/joelhooks' }],
	creator: 'Imamuzzaki Abu Salam',
	publisher: 'Swarm Tools',
	robots: {
		index: true,
		follow: true,
	},
	openGraph: {
		type: 'website',
		locale: 'en_US',
		url: siteUrl,
		siteName: 'Swarm Tools',
		title: 'Swarm Tools - Multi-Agent Coordination Primitives',
		description: 'Event sourcing and coordination patterns for AI assistants',
		images: [
			{
				url: '/opengraph-image',
				width: 1200,
				height: 630,
				alt: 'Swarm Tools - Multi-Agent Coordination Primitives',
			},
		],
	},
	twitter: {
		card: 'summary_large_image',
		title: 'Swarm Tools - Multi-Agent Coordination Primitives',
		description: 'Event sourcing and coordination patterns for AI assistants',
		images: ['/opengraph-image'],
		creator: '@jhooks',
	},
	icons: {
		icon: '/icon',
		apple: '/icon',
	},
};

const consoleArt = `
%c
   ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
   ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
   ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
   ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
   ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
   ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
   ████████╗ ██████╗  ██████╗ ██╗     ███████╗
   ╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝
      ██║   ██║   ██║██║   ██║██║     ███████╗
      ██║   ██║   ██║██║   ██║██║     ╚════██║
      ██║   ╚██████╔╝╚██████╔╝███████╗███████║
      ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝

   🐝 framework-agnostic primitives for agentic systems

   https://github.com/joelhooks/opencode-swarm-plugin
`;

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<script
					dangerouslySetInnerHTML={{
						__html: `console.log(\`${consoleArt}\`, "color: #f59e0b; font-family: monospace; font-size: 10px;");`,
					}}
				/>
			</head>
			<body className={`flex min-h-screen flex-col ${geist.variable} ${geistMono.variable} ${ibmPlexMono.variable} font-sans`}>
				<RootProvider>{children}</RootProvider>
			</body>
		</html>
	);
}
