import * as htmlToImage from 'html-to-image';
import { collectPseudoCSS, prerenderPseudoElements, setPseudoDebug, isPseudoDebugEnabled } from './utils/pseudo-element-renderer';

// 默认开启调试，可在控制台执行 __pseudoDebug(false) 关闭
setPseudoDebug(true);

export class ClipboardManager {
    private static getExportConfig(imageElement: HTMLElement) {
        return {
            quality: 1,
            pixelRatio: 4,
            skipFonts: false,
            filter: (node: Node) => {
                return true;
            },
            imagePlaceholder: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
        };
    }

    static async copyImageToClipboard(element: HTMLElement): Promise<boolean> {
        try {
            const imageElement = element.querySelector('.red-image-preview') as HTMLElement;
            if (!imageElement) {
                throw new Error('找不到预览区域');
            }

            // 确保浏览器完成重绘并等待资源加载
            await new Promise(resolve => setTimeout(resolve, 300));

            // ★ 在截图前将 CSS 伪元素转为真实 DOM span
            try {
                const pseudoCSS = collectPseudoCSS();
                if (pseudoCSS) {
                    console.log('[ClipboardManager] 开始预渲染伪元素...');
                    prerenderPseudoElements(imageElement, pseudoCSS);
                } else if (isPseudoDebugEnabled()) {
                    console.log('[ClipboardManager] 未收集到伪元素 CSS 规则，跳过预渲染');
                }
            } catch (e) {
                console.warn('[ClipboardManager] 伪元素预渲染失败:', e);
            }

            try {
                const blob = await htmlToImage.toBlob(imageElement, this.getExportConfig(imageElement));
                if (!(blob instanceof Blob)) {
                    throw new Error('生成的不是有效的 Blob 对象');
                }

                // 创建 ClipboardItem 对象
                const clipboardItem = new ClipboardItem({
                    'image/png': blob
                });
                
                // 写入剪贴板
                await navigator.clipboard.write([clipboardItem]);
                return true;
            } catch (err) {
                console.warn('复制失败，尝试备用方法', err);
                // 备用方法：使用 toCanvas
                const canvas = await htmlToImage.toCanvas(imageElement, this.getExportConfig(imageElement));
                try {
                    // 尝试直接复制 Canvas
                    await new Promise<void>((resolve, reject) => {
                        canvas.toBlob(async (blob) => {
                            if (!blob) {
                                reject(new Error('Canvas 转换为 Blob 失败'));
                                return;
                            }
                            try {
                                const clipboardItem = new ClipboardItem({
                                    'image/png': blob
                                });
                                await navigator.clipboard.write([clipboardItem]);
                                resolve();
                            } catch (e) {
                                reject(e);
                            }
                        }, 'image/png', 1);
                    });
                    return true;
                } catch (clipboardErr) {
                    console.error('复制到剪贴板失败', clipboardErr);
                    return false;
                }
            }
        } catch (error) {
            console.error('复制图片失败:', error);
            return false;
        }
    }
}