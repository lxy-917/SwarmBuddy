import { PanelLeftOpen, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { AppSidebar } from '@/components/layout/AppSidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

export function AppLayout() {
	const location = useLocation();
	const [pageNavOpen, setPageNavOpen] = useState(false);
	const hasPageNav = /^\/(mcp|skill)(\/|$)/.test(location.pathname);
	useEffect(() => { setPageNavOpen(false); }, [location.pathname]);

	return (
		<div className="swarm-shell-frame">
			<SidebarProvider className="swarm-shell-provider">
				<header className="swarm-shell-masthead"><h1>SwarmBuddy</h1><AppSidebar /><div className="swarm-shell-signature"><svg viewBox="0 0 140 22" aria-hidden="true"><path d="M1 16c25-12 45-12 65-3s43 6 72-9M18 16c20-9 44-5 68 0s28 2 42-3" /></svg><span>深海无界 · 协同共行</span></div></header>
				<div className="swarm-shell-workbench">
					<SidebarInset className={`swarm-tool-inset relative flex-1 overflow-hidden bg-canvas ${hasPageNav ? 'has-tool-nav' : ''}`} data-page-nav-open={pageNavOpen}>
						{hasPageNav && <button className="swarm-page-nav-toggle" type="button" aria-label={pageNavOpen ? '关闭页面导航' : '打开页面导航'} aria-expanded={pageNavOpen} title={pageNavOpen ? '关闭页面导航' : '打开页面导航'} onClick={() => setPageNavOpen((value) => !value)}>{pageNavOpen ? <X size={17} /> : <PanelLeftOpen size={17} />}</button>}
						<Outlet />
					</SidebarInset>
				</div>
			</SidebarProvider>
		</div>
	);
}
