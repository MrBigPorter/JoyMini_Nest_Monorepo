/**
 * Html5VideoBlot — Custom Quill blot for embedding <video> elements.
 *
 * Why a separate module?
 * - Registered at module-load time, BEFORE ReactQuill mounts
 * - Avoids race condition of registering inside a useEffect dynamic import
 * - Ensures Quill recognizes <video> tags when parsing existing content
 */

/**
 * Register Html5VideoBlot on the given Quill static reference.
 * Safe to call multiple times on different Quill constructors
 * (Next.js chunk isolation can create multiple Quill class instances).
 * Uses Quill.imports to check if this particular instance already has the blot.
 */
export function registerHtml5VideoBlot(Quill: any): void {
  // Check if this specific Quill constructor already has the blot registered,
  // rather than using a module-level flag. This handles the case where
  // Next.js chunk isolation creates multiple Quill class instances.
  try {
    if (Quill?.imports?.['formats/html5-video']) return;
  } catch (_) {
    // If imports check fails (e.g. non-standard Quill object), proceed to register
  }

  const BlockEmbed = Quill.import('blots/block/embed');

  class Html5VideoBlot extends BlockEmbed {
    static blotName = 'html5-video';
    static tagName = 'video';
    static className = 'ql-video';

    static create(url: string) {
      // Create the <video> element using the BlockEmbed's create()
      const node: HTMLVideoElement = super.create();

      // Basic attributes to make the video playable and mobile-friendly
      node.controls = true;
      node.preload = 'metadata';
      node.playsInline = true;
      // Keep the src attribute for compatibility, but also add a <source>
      node.setAttribute('src', url);

      // Add helpful CSS classes (Tailwind utility classes used in project)
      // Note: Quill will already add 'ql-video' from static.className
      const existing = node.getAttribute('class') || '';
      const extra = 'w-full rounded-lg my-4';
      node.setAttribute('class', `${existing} ${extra}`.trim());

      // Try to infer MIME type from URL extension for a proper <source> type
      const extMatch = String(url)
        .split('?')[0]
        .match(/\.([a-zA-Z0-9]+)$/);
      let mime = '';
      if (extMatch) {
        const ext = extMatch[1].toLowerCase();
        if (ext === 'mp4') mime = 'video/mp4';
        else if (ext === 'webm') mime = 'video/webm';
        else if (ext === 'ogg' || ext === 'ogv') mime = 'video/ogg';
        else if (ext === 'm3u8') mime = 'application/vnd.apple.mpegurl';
      }

      try {
        const source = document.createElement('source');
        source.setAttribute('src', url);
        if (mime) source.setAttribute('type', mime);
        node.appendChild(source);
      } catch (e) {
        // In non-DOM environments this may fail — ignore safely
      }

      return node;
    }

    static value(node: HTMLElement) {
      // Prefer explicit src attribute, fallback to first <source> child
      const src = node.getAttribute('src');
      if (src) return src;
      const source = node.querySelector('source');
      return (source && source.getAttribute('src')) || '';
    }
  }

  Quill.register('formats/html5-video', Html5VideoBlot, true);
}
