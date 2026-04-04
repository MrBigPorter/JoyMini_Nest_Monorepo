import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import axios from 'axios';
import { UploadService } from '@api/common/upload/upload.service';

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(private readonly uploadService: UploadService) {}

  /**
   * 核心方法：合成头像并上传到 R2
   * @param avatarUrls 成员头像列表
   * @param contextId 群ID或会话ID (用于生成文件路径)
   */
  async generateCompositeAvatar(
    avatarUrls: string[],
    contextId: string,
  ): Promise<string | null> {
    // 1. 过滤空值并取前9个
    const validUrls = avatarUrls.filter((u) => !!u).slice(0, 9);
    const count = validUrls.length;

    if (count === 0) return null;

    try {
      // ==========================================
      // Sharp 合成逻辑 (保持不变)
      // ==========================================
      const canvasSize = 400;
      const gap = 15;
      const bgColor = { r: 235, g: 235, b: 235, alpha: 1 };

      let columns = 1;
      if (count >= 2 && count <= 4) columns = 2;
      if (count >= 5) columns = 3;

      const cellSize = Math.floor((canvasSize - (columns + 1) * gap) / columns);

      // 并发下载图片
      const compositeInputs = await Promise.all(
        validUrls.map(async (url, index) => {
          try {
            const response = await axios.get(url, {
              responseType: 'arraybuffer',
              timeout: 3000,
            });
            const inputBuffer = Buffer.from(response.data);

            // 圆角 Mask
            const roundedMask = Buffer.from(
              `<svg><rect x="0" y="0" width="${cellSize}" height="${cellSize}" rx="${cellSize * 0.1}" ry="${cellSize * 0.1}" /></svg>`,
            );

            const resizedBuffer = await sharp(inputBuffer)
              .resize(cellSize, cellSize, { fit: 'cover' })
              .composite([{ input: roundedMask, blend: 'dest-in' }])
              .png()
              .toBuffer();

            const row = Math.floor(index / columns);
            const col = index % columns;
            let x = gap + col * (cellSize + gap);
            const y = gap + row * (cellSize + gap);

            if (count === 3 && index === 0) {
              x = (canvasSize - cellSize) / 2;
            }

            return {
              input: resizedBuffer,
              top: Math.floor(y),
              left: Math.floor(x),
            };
          } catch (e) {
            return null;
          }
        }),
      );

      const validInputs = compositeInputs.filter(
        (i) => i !== null,
      ) as sharp.OverlayOptions[];
      if (validInputs.length === 0) return null;

      const finalBuffer = await sharp({
        create: {
          width: canvasSize,
          height: canvasSize,
          channels: 4,
          background: bgColor,
        },
      })
        .composite(validInputs)
        .jpeg({ quality: 85 })
        .toBuffer();

      // 1. 定义模块名 (不在 privateModules 列表里，会自动走 Public Bucket)
      const moduleName = 'group-avatars';

      // 2. 调用 uploadBuffer
      // 参数: (buffer, module, userId, mimeType, prefix)
      // 我们把 contextId (groupId) 当作 userId 传进去，这样路径就是 uploads/group-avatars/{groupId}/...
      const uploadResult = await this.uploadService.uploadBuffer(
        finalBuffer,
        moduleName,
        contextId,
        'image/jpeg',
        'group-avatars', // 文件名前缀
      );

      // 3. 获取完整 CDN 链接
      // 你的 UploadService.getDownloadUrl 对 Public Bucket 会直接返回 CDN 拼接链接，不需要签名
      const publicUrl = await this.uploadService.getDownloadUrl(
        uploadResult.key,
        moduleName,
      );

      return publicUrl;
    } catch (error) {
      this.logger.error(`Avatar composition failed for ${contextId}`, error);
      return null;
    }
  }
}
