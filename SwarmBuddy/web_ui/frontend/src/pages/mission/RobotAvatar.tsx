interface RobotAvatarProps {
	small?: boolean;
}

export function RobotAvatar({ small = false }: RobotAvatarProps) {
	return (
		<div className={`robot-avatar ${small ? 'small' : ''}`} aria-hidden="true">
			<img src="/ocean/assets/h-theme/branding/mark.svg" alt="" />
		</div>
	);
}
