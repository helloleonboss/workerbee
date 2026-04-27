import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Dialog, DialogContent } from "./ui/dialog";
import { X } from "lucide-react";
import { readScreenshotAsBase64 } from "@/lib/api";

interface InlineEntryContentProps {
  content: string;
  storagePath: string;
  onImageClick?: () => void;
}

/**
 * Check if a src is a local file path (not data: / http: / https:).
 */
function isLocalPath(src: string): boolean {
  return !src.startsWith("data:") && !src.startsWith("http://") && !src.startsWith("https://");
}

export function InlineEntryContent({ content, storagePath }: InlineEntryContentProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState("");

  // Image preload cache: markdown src → data URL
  const imageCacheRef = useRef<Record<string, string>>({});
  const [imageCache, setImageCache] = useState<Record<string, string>>({});
  const loadingRef = useRef<Set<string>>(new Set());

  // Preload local images from markdown content
  useEffect(() => {
    const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
    const matches = [...content.matchAll(imageRegex)];

    for (const match of matches) {
      const src = match[1];
      if (!src || !isLocalPath(src)) continue;

      if (!imageCacheRef.current[src] && !loadingRef.current.has(src)) {
        loadingRef.current.add(src);
        readScreenshotAsBase64(src)
          .then((dataUrl) => {
            imageCacheRef.current[src] = dataUrl;
            setImageCache((prev) => ({ ...prev, [src]: dataUrl }));
          })
          .catch((e) => console.error("Failed to load image:", src, e))
          .finally(() => {
            loadingRef.current.delete(src);
          });
      }
    }
  }, [content]);

  const handleImageClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const imgSrc = (e.target as HTMLImageElement).src;
      if (imgSrc) {
        setLightboxImage(imgSrc);
        setLightboxOpen(true);
      }
    },
    []
  );

  return (
    <>
      <div className="text-sm leading-relaxed [&_p]:whitespace-pre-wrap [&_img]:max-w-full [&_img]:rounded [&_img]:max-h-[200px] [&_img]:cursor-pointer [&_img]:hover:opacity-90 [&_img]:transition-opacity">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            img: ({ src, alt, ...props }) => {
              if (!src) return null;

              // External / data URLs pass through directly
              if (!isLocalPath(src)) {
                return (
                  <img
                    src={src}
                    alt={alt}
                    onClick={handleImageClick}
                    {...props}
                  />
                );
              }

              // Local path — use preloaded data URL
              const dataUrl = imageCache[src];

              if (!dataUrl) {
                // Still loading or failed — show skeleton placeholder
                return (
                  <div className="inline-block h-12 w-24 bg-muted animate-pulse rounded" />
                );
              }

              return (
                <img
                  src={dataUrl}
                  alt={alt}
                  onClick={handleImageClick}
                  {...props}
                />
              );
            },
            p: ({ children, ...props }) => {
              // Check if children contain only text (no images/links)
              // to preserve whitespace-pre-wrap for plain text entries
              const hasOnlyText =
                typeof children === "string" ||
                (Array.isArray(children) &&
                  children.every((c) => typeof c === "string"));
              return (
                <p
                  className={hasOnlyText ? "whitespace-pre-wrap" : ""}
                  {...props}
                >
                  {children}
                </p>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>

      {/* Lightbox Dialog */}
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] bg-black/90 border-0 p-0">
          <button
            onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxImage}
            alt="Screenshot"
            className="w-full h-full object-contain max-w-[90vw] max-h-[90vh]"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
