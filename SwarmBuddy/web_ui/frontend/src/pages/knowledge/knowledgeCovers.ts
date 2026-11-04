export const KNOWLEDGE_COVERS = [
    { key: 'document', label: '文档', src: '/ocean/assets/h-theme/branding/kb-cover-document.svg' },
    { key: 'notes', label: '笔记', src: '/ocean/assets/h-theme/branding/kb-cover-notes.svg' },
    { key: 'book', label: '书籍', src: '/ocean/assets/h-theme/branding/kb-cover-book.svg' },
    { key: 'coffee', label: '灵感', src: '/ocean/assets/h-theme/branding/kb-cover-coffee.svg' },
    { key: 'landscape', label: '风景', src: '/ocean/assets/h-theme/branding/kb-cover-landscape.svg' },
] as const;

export async function localCoverDataUrl(file: File): Promise<string> {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请上传 JPG、PNG 或 WebP 图片。');
    if (file.size > 20 * 1024 * 1024) throw new Error('封面图片不能超过 20 MB。');
    const bitmap = await createImageBitmap(file);
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 360;
        canvas.height = 240;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('浏览器无法处理这张封面图片。');
        const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
        const width = bitmap.width * scale;
        const height = bitmap.height * scale;
        context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
        const result = canvas.toDataURL('image/jpeg', 0.76);
        if (result.length > 200_000) throw new Error('封面图片处理后仍过大，请换一张图片。');
        return result;
    } finally {
        bitmap.close();
    }
}

export function knowledgeCoverSrc(key: string | null | undefined): string | null {
    if (key?.startsWith('auto:data:image/jpeg;base64,')) return key.slice(5);
    if (key?.startsWith('data:image/jpeg;base64,')) return key;
    const previousCovers: Record<string, string> = {
        ocean: KNOWLEDGE_COVERS[0].src,
        coast: KNOWLEDGE_COVERS[4].src,
        vessel: KNOWLEDGE_COVERS[1].src,
        sonar: KNOWLEDGE_COVERS[1].src,
        islands: KNOWLEDGE_COVERS[4].src,
    };
    if (key && key in previousCovers) return previousCovers[key];
    return KNOWLEDGE_COVERS.find((cover) => cover.key === key)?.src ?? null;
}
