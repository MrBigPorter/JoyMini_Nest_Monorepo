'use client';

import { GoogleGenerativeAI } from '@google/generative-ai';

export interface TextBox {
  text: string;
  translation: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  color?: string;
}

export interface TranslationResult {
  success: boolean;
  boxes: TextBox[];
  error?: string;
}

export class ImageTranslationEngine {
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async translateImage(imageData: string): Promise<TranslationResult> {
    try {
      const prompt = `
        Analyze this image and extract ALL text regions.
        For each text region, provide:
        - Original text
        - English translation
        - Exact bounding box coordinates (x, y, width, height)
        - Estimated font size
        - Estimated text color as hex
        
        Return ONLY valid JSON in this exact format:
        {
          "boxes": [
            {
              "text": "original text",
              "translation": "english translation",
              "x": 100,
              "y": 200,
              "width": 300,
              "height": 40,
              "fontSize": 16,
              "color": "#333333"
            }
          ]
        }
      `;

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      });

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: 'image/png',
            data: imageData.split(',')[1],
          },
        },
      ]);

      const response = await result.response;
      const json = JSON.parse(response.text());

      return {
        success: true,
        boxes: json.boxes || [],
      };
    } catch (error) {
      console.error('Image translation error:', error);
      return {
        success: false,
        boxes: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async renderTranslatedImage(
    originalImage: HTMLImageElement,
    boxes: TextBox[],
  ): Promise<string> {
    const canvas = document.createElement('canvas');
    canvas.width = originalImage.naturalWidth;
    canvas.height = originalImage.naturalHeight;

    const ctx = canvas.getContext('2d')!;

    // 1. 绘制原始图片
    ctx.drawImage(originalImage, 0, 0);

    // 2. 擦除所有文字区域
    for (const box of boxes) {
      // 智能填充背景
      const padding = 2;
      const fillStyle = ctx.getImageData(
        box.x - padding,
        box.y - padding,
        1,
        1,
      ).data;
      ctx.fillStyle = `rgb(${fillStyle[0]}, ${fillStyle[1]}, ${fillStyle[2]})`;
      ctx.fillRect(
        box.x - padding,
        box.y - padding,
        box.width + padding * 2,
        box.height + padding * 2,
      );

      // 平滑边缘
      ctx.filter = 'blur(1px)';
      ctx.fillRect(
        box.x - padding,
        box.y - padding,
        box.width + padding * 2,
        box.height + padding * 2,
      );
      ctx.filter = 'none';
    }

    // 3. 绘制翻译后的文字
    ctx.textBaseline = 'middle';
    for (const box of boxes) {
      ctx.font = `${box.fontSize || 16}px system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = box.color || '#1f2937';

      // 居中绘制
      const textWidth = ctx.measureText(box.translation).width;
      const textX = box.x + (box.width - textWidth) / 2;
      const textY = box.y + box.height / 2;

      ctx.fillText(box.translation, textX, textY);
    }

    return canvas.toDataURL('image/png', 0.95);
  }

  async urlToDataUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        resolve(canvas.toDataURL('image/png'));
      };

      img.onerror = reject;
      img.src = url;
    });
  }
}
