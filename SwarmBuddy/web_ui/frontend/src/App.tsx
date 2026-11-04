import { QueryClientProvider } from '@tanstack/react-query';
import { Onborda, OnbordaProvider } from 'onborda';
import { useMemo, useState } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';

import { MCPHubPage } from './pages/mcp';
import { SkillHubPage } from './pages/skill';
import { RouteError } from '@/components/error/RouteError';
import { AppLayout } from '@/components/layout/AppLayout';
import { buildChatTour } from '@/components/tour/chatTourSteps';
import { TourCard } from '@/components/tour/TourCard';
import { SidebarProvider } from '@/components/ui/sidebar';
import { UploadProvider } from '@/context/UploadContext';
import { useTranslation } from '@/i18n/useI18n';
import { queryClient } from '@/lib/query-client';
import { BrowserPage } from '@/pages/browser/BrowserPage';
import { ChannelPage } from '@/pages/channel';
import { CollaborationPage } from '@/pages/collaboration/CollaborationPage';
import { CredentialPage } from '@/pages/credential';
import { SwarmKnowledgePage } from '@/pages/knowledge/SwarmKnowledgePage';
import { MissionPage } from '@/pages/mission/MissionPage';
import { SchedulePage } from '@/pages/schedule';
import { SetupPage } from '@/pages/setup';

function SetupPageRoute() {
	const navigate = useNavigate();
	return (
		<>
			<div className="h-full">
				<SetupPage onComplete={() => navigate('/')} />
			</div>
			<Toaster richColors position="top-right" />
		</>
	);
}

const router = createBrowserRouter([
	{
		element: <AppLayout />,
		errorElement: <RouteError />,
		children: [
			{
				// 页面崩溃时只替换 Outlet 内容，保留导航布局；父路由负责兜底处理布局崩溃。
				errorElement: <RouteError />,
				children: [
					{ path: '/', element: <Navigate to="/mission" replace /> },
					{ path: '/chat/*', element: <Navigate to="/mission" replace /> },
					{ path: '/collaboration', element: <CollaborationPage /> },
					{ path: '/schedule', element: <SchedulePage /> },
					{ path: '/channel', element: <ChannelPage /> },
					{ path: '/credential', element: <CredentialPage /> },
					{ path: '/mcp', element: <MCPHubPage /> },
					{ path: '/mcp/:hubId', element: <MCPHubPage /> },
					{ path: '/skill', element: <SkillHubPage /> },
					{ path: '/skill/:hubId', element: <SkillHubPage /> },
					{ path: '/browser', element: <BrowserPage /> },
					{ path: '/setup', element: <SetupPageRoute /> },
				],
			},
		],
	},
	{
		path: '/mission/:agentId?/:sessionId?',
		element: <MissionPage />,
		errorElement: <RouteError />,
	},
	{ path: '/knowledge/:kbId?', element: <SwarmKnowledgePage />, errorElement: <RouteError /> },
	{
		path: '/credential-embed',
		element: <div className="h-screen"><SidebarProvider className="h-full"><CredentialPage /></SidebarProvider></div>,
		errorElement: <RouteError />,
	},
]);

function App() {
	const { t } = useTranslation();
	const [setupComplete, setSetupComplete] = useState(() => !!localStorage.getItem('server_url'));
	const tours = useMemo(() => [buildChatTour(t)], [t]);

	if (!setupComplete) {
		return <SetupPage onComplete={() => setSetupComplete(true)} />;
	}

	return (
		<QueryClientProvider client={queryClient}>
			<OnbordaProvider>
				<Onborda
					steps={tours}
					cardComponent={TourCard}
					shadowOpacity="0.6"
					cardTransition={{ type: 'spring', duration: 0.4 }}
				>
					<UploadProvider>
						<RouterProvider router={router} />
					</UploadProvider>
					<Toaster richColors position="top-right" />
				</Onborda>
			</OnbordaProvider>
		</QueryClientProvider>
	);
}

export default App;
