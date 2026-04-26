/**
 * 媒体工具函数
 * 检测 URL 是否为视频文件，用于前端媒体渲染决策
 */

/**
 * 检查 URL 是否为视频文件
 * @param url 要检查的 URL
 * @returns 是否为视频 URL
 */
export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.ogv', '.m4v', '.m3u8'];

  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return videoExtensions.some((ext) => pathname.endsWith(ext));
  } catch {
    // 如果 URL 解析失败（例如相对路径），直接检查字符串
    const urlLower = url.toLowerCase();
    return videoExtensions.some((ext) => urlLower.endsWith(ext));
  }
}
