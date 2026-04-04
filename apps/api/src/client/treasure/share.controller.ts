import { Controller, Get, Query, Logger, Res } from '@nestjs/common';
import { Response } from 'express';
import { TreasureService } from '@api/client/treasure/treasure.service';

@Controller()
export class ShareController {
  private readonly logger = new Logger(ShareController.name);

  constructor(private readonly treasureService: TreasureService) {}

  /**
   * Intercept /share.html requests, providing content for WhatsApp/FB crawlers and general users.
   */
  @Get('share.html')
  async getSharePage(
    @Query('pid') pid: string,
    @Query('gid') gid: string,
    @Res() res: Response,
  ) {
    // 1. Define default fallback content
    const fallbackHtml = this.generateHtml(
      'JoyMini - Fortunate Journey',
      'Come and explore the best treasures on JoyMini!',
      'https://img.joyminis.com/images/joymini-banner.png',
      pid,
      gid,
    );

    if (!pid) {
      return res.type('text/html').send(fallbackHtml);
    }

    try {
      const product = await this.treasureService.detail(pid);

      if (!product) {
        return res.type('text/html').send(fallbackHtml);
      }

      // Sanitize description by removing HTML tags
      const rawDesc =
        product.desc || 'Come and explore the best treasures on JoyMini!';
      const cleanDesc =
        rawDesc.replace(/<[^>]*>/g, '').trim() || 'JoyMini treasures await!';

      const html = this.generateHtml(
        product.treasureName,
        cleanDesc,
        product?.treasureCoverImg ||
          'https://img.joyminis.com/images/joymini-banner.png',
        pid,
        gid,
      );

      return res.type('text/html').send(html);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Share page failed for pid ${pid}: ${message}`);
      return res.type('text/html').send(fallbackHtml);
    }
  }

  /**
   * Generate HTML with dual-platform wake-up logic and a guidance mask.
   */
  private generateHtml(
    title: string,
    desc: string,
    imageUrl: string,
    pid?: string,
    gid?: string,
  ): string {
    // 1. Pre-assemble the protocol link on the server side
    const schemeUrl = pid
      ? `joymini://product/${pid}${gid ? '?groupId=' + gid : ''}`
      : 'javascript:void(0);';

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0">
    <title>${title} - JoyMini</title>
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:image" content="${imageUrl}" />
    
    <style>
        body { font-family: -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 85vh; margin: 0; background: #fafafa; }
        .open-btn { display: block; width: 220px; height: 50px; line-height: 50px; background: #FF5722; color: white; text-align: center; border-radius: 25px; text-decoration: none; font-weight: 600; box-shadow: 0 4px 12px rgba(255,87,34,0.3); }
        /* Browser mask styling */
        #browser-mask { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.9); z-index: 9999; flex-direction: column; align-items: flex-end; padding: 20px; box-sizing: border-box; }
        .mask-text { color: white; font-size: 20px; font-weight: bold; text-align: right; margin-top: 20px; line-height: 1.5; }
        .mask-arrow { color: white; font-size: 40px; margin-right: 10px; animation: bounce 1s infinite alternate; }
        @keyframes bounce { from { transform: translateY(0); } to { transform: translateY(-10px); } }
    </style>
</head>
<body>
    <div style="font-size: 18px; color: #333; margin-bottom: 8px; font-weight: 600; text-align: center; padding: 0 20px;">${title}</div>
    <div style="font-size: 14px; color: #999; margin-bottom: 30px; text-align: center; padding: 0 20px;">${desc}</div>
    
    <a id="jumpBtn" class="open-btn" href="${schemeUrl}">Open in App</a>

    <div id="browser-mask" onclick="this.style.display='none'">
        <div class="mask-arrow">↗</div>
        <div class="mask-text">Tap the "..." at the top right<br>and select "Open in Browser"<br>to view in JoyMini!</div>
    </div>

    <script>
        const ua = navigator.userAgent.toLowerCase();
        const isMessenger = ua.indexOf("fban") > -1 || ua.indexOf("fbav") > -1 || ua.indexOf("messenger") > -1 || ua.indexOf("micromessenger") > -1;

        if (isMessenger) {
            // 3. If the environment blocks links (like Facebook or WeChat), use JS to prevent the <a> tag default behavior and show the browser mask instead.
            const btn = document.getElementById('jumpBtn');
            btn.onclick = function(e) {
                e.preventDefault(); 
                document.getElementById('browser-mask').style.display = 'flex';
            };
        }
        // Standard browsers like Safari do not require specific btn.onclick logic; the <a> tag's href attribute handles the wake-up successfully.
    </script>
</body>
</html>
    `;
  }
}
