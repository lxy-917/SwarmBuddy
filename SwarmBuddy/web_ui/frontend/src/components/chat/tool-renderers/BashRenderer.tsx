import { getResultText, parseInput, toolLabelClass } from './_shared';
import type { ToolRenderer } from './types';

function getCommand(input: string): string {
	const { command, script, cmd } = parseInput(input) as { command?: string; script?: string; cmd?: string };
	return command || script || cmd || input;
}

export const BashRenderer: ToolRenderer = {
	getDisplayName: (call) => call.name,

	renderConfirmBody: (call) => {
		const { description } = parseInput(call.input) as {
			description?: string;
		};
		return (
			<div className="w-full max-w-full">
				<div className="text-secondary-foreground font-mono break-all whitespace-pre-wrap max-h-[200px] overflow-auto">{getCommand(call.input)}</div>
				{description && <div className="text-muted-foreground">{description}</div>}
			</div>
		);
	},

	renderHeader: (pair) => (
		<>
			<span className={toolLabelClass}>{pair.call.name}</span>
			{/* The command is code, so it keeps a mono font rather than the shared
			    argument style; it still brightens on hover like every other row. */}
			<span className="font-mono min-w-0 truncate transition-colors group-hover:text-foreground">
				{getCommand(pair.call.input)}
			</span>
		</>
	),

	renderBody: (pair) => {
		if (!pair.result) return null;

		const shellRes = getResultText(pair.result);
		return (
			<div className="flex flex-col border bg-background rounded-sm p-2 text-xs">
				<div className="text-muted-foreground">Input</div>
				<pre className="overflow-x-auto p-2 border rounded bg-secondary ">
					{JSON.stringify(parseInput(pair.call.input), null, 2)}
				</pre>
				<div className="text-muted-foreground mt-2">Output</div>
				<pre className="overflow-auto p-2 border rounded bg-secondary max-h-[200px]">
					{shellRes}
				</pre>
			</div>
		);
	},
};
