/** 将旧回复中仅包含公式的代码块转换为独立展示的数学公式。 */
export function formatMissionMarkdown(source: string): string {
	const fences = /(^|\n)([ \t]{0,3})(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n[ \t]{0,3}\3(?=\n|$)/g;
	let result = '';
	let cursor = 0;
	for (const match of source.matchAll(fences)) {
		const start = match.index ?? 0;
		result += normalizeMathDelimiters(source.slice(cursor, start));
		const [whole, prefix, , , language, body] = match;
		result += (() => {
			const tag = language.trim().toLowerCase();
			if (tag && !/^(math|latex|tex|katex)$/.test(tag)) return whole;
			const lines = body.trim().split(/\r?\n/).map((line) => line.trim());
			if (!lines.length || !lines.some(Boolean)) return whole;
			if (tag) return `${prefix}\n$$\n${body.trim()}\n$$\n`;
			const isAnnotation = (line: string) => /^[\u3400-\u9fff].*[：:]$/.test(line);
			const isFormula = (line: string) => /[=<>]/.test(line) && /[∑Σ⇒→×·⋅÷±≈≤≥∞π²³₀-₉/^_]/.test(line);
			if (!lines.some(isFormula) || !lines.every((line) => !line || isFormula(line) || isAnnotation(line))) return whole;
			if (lines.some((line) => /[{};]|^\s*(?:import|from|def|class|function|return|const|let|var|print)\b/i.test(line))) return whole;
			const parts = lines.filter(Boolean).map((line) => isFormula(line) ? `$$\n${normalizeFormula(line)}\n$$` : line);
			return `${prefix}\n${parts.join('\n\n')}\n`;
		})();
		cursor = start + whole.length;
	}
	return result + normalizeMathDelimiters(source.slice(cursor));
}

function normalizeMathDelimiters(text: string): string {
	return text
		.replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula: string) => `\n$$\n${formula.trim()}\n$$\n`)
		.replace(/\\\(([^\n]*?)\\\)/g, (_match, formula: string) => `$${formula.trim()}$`);
}

function normalizeFormula(line: string): string {
	return line
		.replace(/\bd\(([^)]+)\)\/d([A-Za-z]+)\b/g, '\\frac{d($1)}{d$2}')
		.replace(/\b([A-Za-z][A-Za-z0-9]*|\d+)\/([A-Za-z][A-Za-z0-9]*|\d+)\b/g, '\\frac{$1}{$2}')
		.replace(/([A-Za-z])([₀-₉]+)/g, (_match, letter: string, digits: string) => `${letter}_{${[...digits].map((digit) => '₀₁₂₃₄₅₆₇₈₉'.indexOf(digit)).join('')}}`)
		.replace(/²/g, '^{2}').replace(/³/g, '^{3}')
		.replace(/Σ/g, '\\Sigma ').replace(/∑/g, '\\sum ').replace(/π/g, '\\pi ')
		.replace(/⇒/g, '\\Rightarrow ').replace(/→/g, '\\to ')
		.replace(/×/g, '\\times ').replace(/[·⋅]/g, '\\cdot ').replace(/÷/g, '\\div ')
		.replace(/±/g, '\\pm ').replace(/≈/g, '\\approx ').replace(/≤/g, '\\le ').replace(/≥/g, '\\ge ')
		.replace(/∞/g, '\\infty ').replace(/−/g, '-')
		.replace(/(?<!\\)%/g, '\\%')
		.replace(/[\u3400-\u9fff]+/g, (text) => `\\text{${text}}`);
}
