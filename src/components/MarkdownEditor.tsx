import { useCallback, useMemo, useRef } from "react";
import CodeMirror, {
  EditorView,
  ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { highlightActiveLine, highlightSpecialChars, drawSelection } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { cn } from "@/lib/utils";

export interface MarkdownEditorProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  variant?: "default" | "bordered";
}

function createMarkdownHighlight(isDark: boolean) {
  const headingColor = isDark ? "oklch(0.85 0.08 250)" : "oklch(0.45 0.12 260)";
  const codeColor = isDark ? "oklch(0.78 0.1 160)" : "oklch(0.42 0.12 160)";
  const monoFont = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

  return HighlightStyle.define([
    // Headings
    { tag: t.heading1, color: headingColor, fontWeight: "700", fontSize: "1.4em", lineHeight: "1.8" },
    { tag: t.heading2, color: headingColor, fontWeight: "700", fontSize: "1.25em", lineHeight: "1.7" },
    { tag: t.heading3, color: headingColor, fontWeight: "600", fontSize: "1.1em" },
    { tag: t.heading4, color: headingColor, fontWeight: "600" },
    { tag: t.heading5, color: headingColor, fontWeight: "600" },
    { tag: t.heading6, color: headingColor, fontWeight: "600" },
    // Emphasis
    { tag: t.strong, fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through", color: isDark ? "oklch(0.6 0 0)" : "oklch(0.5 0 0)" },
    // Links
    { tag: t.link, color: isDark ? "oklch(0.75 0.12 250)" : "oklch(0.5 0.15 250)", textDecoration: "underline" },
    { tag: t.url, color: isDark ? "oklch(0.65 0.08 250)" : "oklch(0.45 0.1 250)" },
    // Code
    { tag: t.monospace, fontFamily: monoFont, fontSize: "0.9em", color: codeColor },
    // Quotes
    { tag: t.quote, color: isDark ? "oklch(0.7 0 0)" : "oklch(0.45 0 0)", fontStyle: "italic" },
    // Lists
    { tag: t.list, color: isDark ? "oklch(0.75 0.1 250)" : "oklch(0.5 0.1 250)" },
    // Horizontal rule
    { tag: t.contentSeparator, color: isDark ? "oklch(0.5 0 0)" : "oklch(0.7 0 0)" },
    // Processing/meta instruction
    { tag: t.processingInstruction, color: isDark ? "oklch(0.5 0 0)" : "oklch(0.6 0 0)" },
    // Meta (frontmatter)
    { tag: t.meta, color: isDark ? "oklch(0.55 0 0)" : "oklch(0.5 0 0)" },
    // Comment
    { tag: t.comment, color: isDark ? "oklch(0.55 0 0)" : "oklch(0.55 0 0)", fontStyle: "italic" },
  ]);
}

const markdownExtensions = [
  markdown({
    base: markdownLanguage,
    codeLanguages: languages,
  }),
  EditorView.lineWrapping,
  highlightSpecialChars(),
  history(),
  drawSelection(),
  highlightActiveLine(),
];

function createTheme(isDark: boolean) {
  const foreground = "var(--color-foreground)";
  const mutedForeground = "var(--color-muted-foreground)";
  const background = isDark ? "oklch(0.17 0 0)" : "oklch(0.985 0 0)";
  const activeLineBg = isDark ? "oklch(0.22 0 0)" : "oklch(0.95 0 0)";

  return EditorView.theme(
    {
      "&": {
        height: "100%",
        backgroundColor: background,
        color: foreground,
        fontSize: "14px",
        fontFamily: "inherit",
        borderRadius: "0",
      },
      ".cm-content": {
        caretColor: foreground,
        padding: "16px 20px",
        whitespace: "pre-wrap",
        wordBreak: "break-word",
      },
      ".cm-line": {
        padding: "0 4px",
        lineHeight: "1.75",
      },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily: "inherit",
        maxHeight: "100%",
        padding: "0",
      },
      ".cm-focused": {
        outline: "none",
      },
      ".cm-activeLine": {
        backgroundColor: activeLineBg,
        borderRadius: "3px",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: isDark ? "oklch(0.35 0 0)" : "oklch(0.85 0 0)",
      },
      ".cm-cursor": {
        borderLeftColor: foreground,
        borderLeftWidth: "2px",
      },
      "&.cm-editor.cm-focused": {
        outline: "none",
      },
      ".cm-placeholder": {
        color: mutedForeground,
        fontStyle: "italic",
      },
    },
    { dark: isDark }
  );
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  className,
  autoFocus = false,
  onBlur,
  variant = "bordered",
}: MarkdownEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const isEditable = onChange !== undefined;

  const handleChange = useCallback(
    (val: string) => {
      onChange?.(val);
    },
    [onChange]
  );

  const isDark = useMemo(() => {
    if (typeof document === "undefined") return false;
    return document.documentElement.classList.contains("dark");
  }, []);

  const extensions = useMemo(() => {
    const exts = [
      ...markdownExtensions,
      syntaxHighlighting(createMarkdownHighlight(isDark)),
    ];

    if (!isEditable) {
      exts.push(EditorState.readOnly.of(true));
    }

    return exts;
  }, [isEditable, isDark]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (onBlur) {
        if (event.key === "Escape") {
          event.preventDefault();
          onBlur();
        }
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          onBlur();
        }
      }
    },
    [onBlur]
  );

  const theme = useMemo(() => createTheme(isDark), [isDark]);

  const containerClasses = variant === "bordered"
    ? "border border-border rounded-md bg-card overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background"
    : "";

  return (
    <div
      className={cn("relative h-full", containerClasses, className)}
      onKeyDown={handleKeyDown}
    >
      <CodeMirror
        ref={editorRef}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        editable={isEditable}
        autoFocus={autoFocus}
        extensions={extensions}
        theme={theme}
        basicSetup={false}
        className="text-sm h-full"
      />
    </div>
  );
}
