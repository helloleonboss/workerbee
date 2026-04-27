import { useState } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "./ui/scroll-area";
import { Dialog, DialogContent } from "./ui/dialog";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { convertFileSrc } from "@tauri-apps/api/core";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string>("");

  const handleImageClick = (src: string) => {
    const convertedSrc = src.startsWith("data:") ? src : convertFileSrc(src);
    setLightboxImage(convertedSrc);
    setLightboxOpen(true);
  };

  const CustomImage = ({ src, alt, ...props }: React.ComponentProps<"img">) => {
    const resolvedSrc = src && !src.startsWith("data:") ? convertFileSrc(src) : src ?? "";

    const handleClick = () => {
      if (resolvedSrc) {
        handleImageClick(resolvedSrc);
      }
    };

    return (
      <img
        src={resolvedSrc}
        alt={alt}
        className="cursor-pointer hover:opacity-90 transition-opacity"
        onClick={handleClick}
        {...props}
      />
    );
  };

  return (
    <>
      <ScrollArea className={cn("h-full border border-border rounded-md bg-card", className)}>
        <div className="md-preview max-w-none p-5 text-sm text-foreground [&>*:first-child]:mt-0">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{ img: CustomImage }}
          >
            {content}
          </ReactMarkdown>
        </div>
        <style>{`
          .md-preview h1 { font-size: 1.5em; font-weight: 700; margin: 0.5em 0 0.2em; }
          .md-preview h2 { font-size: 1.3em; font-weight: 700; margin: 0.4em 0 0.15em; }
          .md-preview h3 { font-size: 1.15em; font-weight: 600; margin: 0.35em 0 0.1em; }
          .md-preview h4 { font-size: 1.05em; font-weight: 600; margin: 0.3em 0 0.1em; }
          .md-preview h5 { font-size: 1em; font-weight: 600; margin: 0.25em 0 0.08em; }
          .md-preview h6 { font-size: 0.95em; font-weight: 600; margin: 0.2em 0 0.08em; }
          .md-preview p { margin: 0.3em 0; }
          .md-preview ul, .md-preview ol { margin: 0.3em 0; padding-left: 1.5em; }
          .md-preview blockquote { margin: 0.3em 0; padding: 0.2em 0.7em; }
          .md-preview code {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 0.87em; background: var(--color-muted); padding: 0.08em 0.25em;
            border-radius: 0.25rem;
          }
          .md-preview pre {
            padding: 0.5em 0.7em; border-radius: 0.375rem;
            background: var(--color-muted); overflow-x: auto;
          }
          .md-preview pre code { background: none; padding: 0; }
          .md-preview hr { border: none; border-top: 1px solid var(--color-border); }
          .md-preview a { color: oklch(0.55 0.15 250); text-decoration: underline; }
          .md-preview img { max-width: 100%; border-radius: 0.375rem; cursor: pointer; }
          .md-preview blockquote { border-left: 3px solid var(--color-border); color: var(--color-muted-foreground); }
          .md-preview table { border-collapse: collapse; width: 100%; font-size: 0.92em; }
          .md-preview th, .md-preview td { border: 1px solid var(--color-border); padding: 0.2em 0.5em; text-align: left; }
          .md-preview th { background: var(--color-muted); font-weight: 600; }
          .md-preview del { text-decoration: line-through; color: var(--color-muted-foreground); }
          .md-preview input[type="checkbox"] { margin-right: 0.4em; vertical-align: middle; }
        `}</style>
      </ScrollArea>
      
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
