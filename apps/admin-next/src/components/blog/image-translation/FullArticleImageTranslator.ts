'use client';

import { ImageTranslationEngine } from './ImageTranslationEngine';

export class FullArticleImageTranslator {
  private engine: ImageTranslationEngine;
  private isCancelled: boolean = false;
  private maxParallel: number = 2;

  constructor(apiKey: string) {
    this.engine = new ImageTranslationEngine(apiKey);
  }

  cancel() {
    this.isCancelled = true;
  }

  async translateAllImages(
    html: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<string> {
    this.isCancelled = false;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const images = Array.from(doc.querySelectorAll('img'));
    const total = images.length;

    if (total === 0) {
      return html;
    }

    // 限流并发处理
    for (let i = 0; i < images.length; i += this.maxParallel) {
      if (this.isCancelled) break;

      const batch = images.slice(i, i + this.maxParallel);

      await Promise.allSettled(
        batch.map(async (img, index) => {
          if (this.isCancelled) return;

          try {
            const dataUrl = await this.engine.urlToDataUrl(img.src);
            const result = await this.engine.translateImage(dataUrl);

            if (!result.success || result.boxes.length === 0) {
              // 没有文字，不需要翻译
              return;
            }

            // 加载原图
            const originalImg = new Image();
            originalImg.src = dataUrl;
            await new Promise((resolve) => (originalImg.onload = resolve));

            // 渲染翻译后图片
            const translatedUrl = await this.engine.renderTranslatedImage(
              originalImg,
              result.boxes,
            );

            // 替换图片URL
            img.setAttribute('data-original-src', img.src);
            img.src = translatedUrl;
          } catch (e) {
            // 失败自动降级，保留原图，不影响整体流程
            console.warn('图片翻译失败，保留原图', img.src, e);
          }

          onProgress?.(i + index + 1, total);
        }),
      );
    }

    return doc.body.innerHTML;
  }
}
