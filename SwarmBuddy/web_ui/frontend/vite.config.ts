import { fileURLToPath } from 'node:url';
import path from 'path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';

const projectDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [react(), tailwindcss(), svgr()],
	server: {
		host: '0.0.0.0',
		proxy: {
			'/api': 'http://localhost:3000',
		},
	},
	resolve: {
		alias: {
			'@': path.resolve(projectDir, './src'),
			'next/navigation': path.resolve(projectDir, './src/lib/next-navigation-shim.ts'),
		},
	},
	optimizeDeps: {
		include: ['mime-types'],
	},
});
