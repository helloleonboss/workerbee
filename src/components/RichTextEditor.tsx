import { useEffect, useRef, useCallback } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Markdown } from "tiptap-markdown";
import { readScreenshotAsBase64, savePastedImage } from "@/lib/api";

/**
 * Full-document rich text editor backed by a single TipTap instance.
 *
 * - Displays markdown content (with inline images) in WYSIWYG mode.
 * - Images with relative paths (../screenshots/…) are resolved to blob URLs
 *   for display (much lighter than base64 data URLs in the DOM), and
 *   converted back to relative paths on save.
 * - Pasted images are saved to the screenshots directory via Rust IPC.
 * - Calls `onChange` with the full markdown string (debounced).
 */

interface RichTextEditorProps {
  /** Raw markdown content (may include frontmatter). */
  content: string;
  /** App storage path – used to resolve relative image paths. */
  storagePath: string;
  /** Debounced callback with updated markdown (frontmatter re-added). */
  onChange: (markdown: string) => void;
  /** Debounce interval in ms (default 600). */
  debounceMs?: number;
  /** Extra CSS class on the wrapper. */
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Get markdown string from the tiptap-markdown extension storage. */
function getEditorMarkdown(editor: Editor): string {
  const storage = (editor.storage as unknown) as Record<
    string,
    { getMarkdown?: () => string }
  >;
  return storage["markdown"]?.getMarkdown?.() ?? "";
}

/** Markdown image regex: ![alt](src) */
const IMAGE_MD_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** Strip YAML frontmatter, return { frontmatter, body }. */
function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("---")) {
    const end = trimmed.indexOf("---", 3);
    if (end !== -1) {
      return {
        frontmatter: trimmed.slice(0, end + 3),
        body: trimmed.slice(end + 3),
      };
    }
  }
  return { frontmatter: "", body: raw };
}

/**
 * Convert a base64 data URL to a lightweight blob URL.
 * Blob URLs are short identifiers in the DOM instead of huge base64 strings,
 * which dramatically improves scroll / paint performance with many images.
 */
function dataUrlToBlobUrl(dataUrl: string): string {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) return dataUrl;

  const meta = dataUrl.slice(0, commaIdx);
  const base64 = dataUrl.slice(commaIdx + 1);
  const mimeMatch = meta.match(/data:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mime });
  return URL.createObjectURL(blob);
}

/**
 * Revoke all blob URLs in the image map to free memory.
 */
function revokeBlobUrls(map: Map<string, string>) {
  for (const [blobUrl] of map) {
    if (blobUrl.startsWith("blob:")) {
      URL.revokeObjectURL(blobUrl);
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────

export function RichTextEditor({
  content,
  onChange,
  debounceMs = 600,
  className,
}: RichTextEditorProps) {
  const frontmatterRef = useRef("");
  const imageMapRef = useRef<Map<string, string>>(new Map()); // blobUrl → relativePath
  const isSettingContent = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedContentKey = useRef("");

  // ── Pre-process: relative image paths → blob URLs ──

  const processImagesInContent = useCallback(
    async (md: string): Promise<string> => {
      const matches = [...md.matchAll(IMAGE_MD_REGEX)];
      if (matches.length === 0) return md;

      // Revoke previous blob URLs before creating new ones
      revokeBlobUrls(imageMapRef.current);
      const map = new Map<string, string>();
      let result = md;

      for (const match of matches) {
        const alt = match[1];
        const src = match[2];

        if (
          src.startsWith("blob:") ||
          src.startsWith("data:") ||
          src.startsWith("http://") ||
          src.startsWith("https://")
        ) {
          continue;
        }

        try {
          const dataUrl = await readScreenshotAsBase64(src);
          const blobUrl = dataUrlToBlobUrl(dataUrl);
          const oldMd = `![${alt}](${src})`;
          const newMd = `![${alt}](${blobUrl})`;
          result = result.replace(oldMd, newMd);
          map.set(blobUrl, src);
        } catch (e) {
          console.error("Failed to load image for editor:", src, e);
        }
      }

      imageMapRef.current = map;
      return result;
    },
    [],
  );

  // ── Post-process: blob URLs → relative paths ──

  const restoreImagePaths = useCallback((markdown: string): string => {
    let result = markdown;
    for (const [blobUrl, relativePath] of imageMapRef.current) {
      result = result.split(blobUrl).join(relativePath);
    }
    return result;
  }, []);

  // ── Debounced save ──

  const flushSave = useCallback(
    (editor: Editor) => {
      const markdown = getEditorMarkdown(editor);
      const restored = restoreImagePaths(markdown);
      const full =
        frontmatterRef.current && restored.trim()
          ? frontmatterRef.current + "\n\n" + restored.trim()
          : frontmatterRef.current && !restored.trim()
            ? frontmatterRef.current
            : restored;
      onChange(full);
    },
    [onChange, restoreImagePaths],
  );

  const scheduleSave = useCallback(
    (editor: Editor) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => flushSave(editor), debounceMs);
    },
    [debounceMs, flushSave],
  );

  // ── Create editor (once) ──

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: "max-w-full rounded max-h-[200px] cursor-default",
          loading: "lazy",
        },
      }),
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: "-",
        breaks: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    editorProps: {
      attributes: {
        class:
          "text-sm leading-relaxed outline-none min-h-[1.5em] caret-foreground px-1",
      },
    },
    content: "",
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => {
      if (isSettingContent.current) return;
      scheduleSave(e);
    },
  });

  // ── Image paste handler ──

  useEffect(() => {
    if (!editor) return;

    const handlePaste = async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          event.preventDefault();

          const file = item.getAsFile();
          if (!file) continue;

          const format = file.type.split("/")[1] || "png";

          // Read as array buffer → blob URL (no base64 overhead)
          const arrayBuffer = await file.arrayBuffer();
          const blob = new Blob([arrayBuffer], { type: file.type });
          const blobUrl = URL.createObjectURL(blob);

          // Also need base64 for the Rust save command
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = (reader.result as string).split(",")[1];
            if (!base64) return;

            try {
              const relativePath = await savePastedImage(base64, format);
              imageMapRef.current.set(blobUrl, relativePath);

              editor
                .chain()
                .focus()
                .setImage({ src: blobUrl, alt: "Pasted image" })
                .run();
            } catch (e) {
              console.error("Failed to save pasted image:", e);
              URL.revokeObjectURL(blobUrl);
            }
          };
          reader.readAsDataURL(file);
          return;
        }
      }
    };

    const dom = editor.view.dom as HTMLElement;
    dom.addEventListener("paste", handlePaste);
    return () => dom.removeEventListener("paste", handlePaste);
  }, [editor]);

  // ── Load content when prop changes ──

  useEffect(() => {
    if (!editor) return;

    if (content === loadedContentKey.current) return;

    let cancelled = false;

    async function load() {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      const { frontmatter, body } = splitFrontmatter(content);
      frontmatterRef.current = frontmatter;
      const processed = await processImagesInContent(body);

      if (cancelled) return;

      loadedContentKey.current = content;
      isSettingContent.current = true;
      if (editor) editor.commands.setContent(processed);
      isSettingContent.current = false;
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [content, editor, processImagesInContent]);

  // ── Cleanup: revoke blob URLs on unmount ──

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      revokeBlobUrls(imageMapRef.current);
    };
  }, []);

  return (
    <div className={className ?? "rich-text-editor flex-1 overflow-auto"}>
      <EditorContent editor={editor} className="h-full" />
    </div>
  );
}
