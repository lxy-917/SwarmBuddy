const FIELD_LABELS: Record<string, string> = {
	name: '名称',
	api_key: 'API 密钥',
	base_url: '接口地址',
	organization: '组织 ID',
};

const FIELD_PLACEHOLDERS: Record<string, string> = {
	name: '请输入便于识别的凭证名称',
	api_key: '请输入 API 密钥',
	base_url: '请输入 API 接口地址（选填）',
	organization: '请输入组织 ID（选填）',
};

export function credentialFieldLabel(key: string, fallback?: string): string {
	return FIELD_LABELS[key] ?? fallback ?? key.replace(/_/g, ' ');
}

export function credentialFieldPlaceholder(key: string): string | undefined {
	return FIELD_PLACEHOLDERS[key];
}
