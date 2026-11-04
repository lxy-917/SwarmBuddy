import { ArrowUpRight, Search, Ship, Sparkles, Waves } from 'lucide-react';

import { ResourcePanel } from '@/components/hub/ResourcePanel.tsx';
import { Button } from '@/components/ui/button.tsx';

interface Props {
	hasRegistry: boolean;
	onSearchRegistry: (query: string) => void;
}

const marineTools = [
	{
		name: '海况与天气',
		publisher: 'weather-mcp',
		description: '按经纬度查询海浪、洋流、风况和天气预报，辅助判断扫描时段与海况。',
		usage: '适合：扫描前查看目标海域的浪高、流向和风况。',
		url: 'https://github.com/weather-mcp/weather-mcp',
		query: 'weather-mcp',
		icon: Waves,
	},
	{
		name: '周边船舶动态',
		publisher: 'tools-mcp',
		description: '查询公开的船舶位置资料，辅助了解扫描区域附近的船舶活动。公开数据可能延迟或缺失。',
		usage: '适合：扫描前了解目标海域附近的船舶分布。',
		url: 'https://github.com/tools-mcp/vessel-traffic-mcp',
		query: 'vessel-traffic-mcp',
		icon: Ship,
	},
] as const;

export function RecommendedMCPPanel({ hasRegistry, onSearchRegistry }: Props) {
	return (
		<ResourcePanel
			title="海域扫描推荐工具"
			description="SwarmBuddy 常驻推荐；按需从来源安装，其他 MCP 也可在来源中查找。"
			icon={<Sparkles className="size-5 text-primary" />}
		>
			<div className="grid gap-4 p-5 xl:grid-cols-2">
				{marineTools.map((tool) => {
					const Icon = tool.icon;
					return (
						<div key={tool.name} className="flex min-h-56 flex-col rounded-2xl border border-border bg-background/40 p-5">
							<div className="mb-4 flex items-start gap-3">
								<div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
									<Icon className="size-5" />
								</div>
								<div>
									<h3 className="text-base font-semibold text-foreground">{tool.name}</h3>
									<p className="text-xs text-muted-foreground">@{tool.publisher}</p>
								</div>
							</div>
							<p className="text-sm leading-6 text-foreground/85">{tool.description}</p>
							<p className="mt-2 text-xs text-muted-foreground">{tool.usage}</p>
							<div className="mt-auto flex flex-wrap gap-2 pt-5">
								{hasRegistry && (
									<Button variant="outline" size="sm" onClick={() => onSearchRegistry(tool.query)}>
										<Search className="size-4" /> 在来源中查找
									</Button>
								)}
								<a href={tool.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-primary hover:bg-primary/10">
									查看项目 <ArrowUpRight className="size-4" />
								</a>
							</div>
						</div>
					);
				})}
			</div>
		</ResourcePanel>
	);
}
