import { BookOpen, BotMessageSquare, Cable, Compass, KeyRound, Network, Plug, Settings } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

interface SwarmAppRailProps {
  className?: string;
}

export function SwarmAppRail({ className = '' }: SwarmAppRailProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const credential = location.pathname === '/credential' ||
    (location.pathname.startsWith('/mission') && new URLSearchParams(location.search).get('view') === 'credential');

  const items = [
    { label: '聊天', path: '/mission', icon: BotMessageSquare, active: location.pathname.startsWith('/mission') && !credential },
    { label: '智能协同', path: '/collaboration', icon: Network, active: location.pathname.startsWith('/collaboration') },
    { label: '工具中心', path: '/mcp', icon: Cable, active: location.pathname.startsWith('/mcp') },
    { label: '凭证', path: '/mission?view=credential', icon: KeyRound, active: credential },
    { label: '知识库', path: '/knowledge', icon: BookOpen, active: location.pathname.startsWith('/knowledge') },
    { label: 'Skills', path: '/skill', icon: Plug, active: location.pathname.startsWith('/skill') },
    { label: '浏览', path: '/browser', icon: Compass, active: location.pathname.startsWith('/browser') },
  ];

  return <nav className={`swarm-app-rail ${className}`} aria-label="功能导航">
    {items.map(({ label, path, icon: Icon, active }) => <button key={label} type="button" className={active ? 'active' : ''} aria-label={label} aria-current={active ? 'page' : undefined} title={label} onClick={() => navigate(path)}><Icon size={16} /><span>{label}</span></button>)}
    <button type="button" className={`swarm-app-rail-settings ${location.pathname === '/setup' ? 'active' : ''}`} aria-label="系统设置" title="系统设置" onClick={() => navigate('/setup')}><Settings size={16} /><span>系统设置</span></button>
  </nav>;
}
