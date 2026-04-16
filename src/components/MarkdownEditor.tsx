import { useCallback, useMemo, useRef } from "react";
import CodeMirror, {
  EditorView,
  ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
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
  const foreground = isDark ? "var(--color-foreground)" : "var(--color-foreground)";
  const mutedForeground = isDark
    ? "var(--color-muted-foreground)"
    : "var(--color-muted-foreground)";
  const background = "transparent";
  const accent = isDark ? "oklch(0.3 0 0)" : "oklch(0.95 0 0)";

  return EditorView.theme(
    {
      "&": {
        height: "auto",
        backgroundColor: background,
        color: foreground,
        fontSize: "14px",
        fontFamily: "inherit",
      },
      ".cm-content": {
        caretColor: foreground,
        padding: "0",
        whitespace: "pre-wrap",
        wordBreak: "break-word",
      },
      ".cm-line": {
        padding: "0",
        lineHeight: "1.625",
      },
      ".cm-scroller": {
        overflow: "visible",
        fontFamily: "inherit",
      },
      ".cm-focused": {
        outline: "none",
      },
      ".cm-activeLine": {
        backgroundColor: "transparent",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: accent,
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
      // Markdown syntax highlighting
      ".cm-header": {
        color: foreground,
        fontWeight: "600",
      },
      ".cm-strong": {
        fontWeight: "700",
      },
      ".cm-em": {
        fontStyle: "italic",
      },
      ".cm-link": {
        color: isDark ? "oklch(0.7 0 0)" : "oklch(0.4 0.15 260)",
        textDecoration: "underline",
      },
      ".cm-url": {
        color: mutedForeground,
      },
      ".cm-code": {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: "13px",
        backgroundColor: accent,
        padding: "0.125em 0.25em",
        borderRadius: "0.25rem",
      },
      ".cm-quote": {
        color: mutedForeground,
        fontStyle: "italic",
        borderLeft: "3px solid " + (isDark ? "oklch(0.3 0 0)" : "oklch(0.9 0 0)"),
        paddingLeft: "0.75em",
        marginLeft: "0",
      },
      ".cm-list": {
        color: foreground,
      },
      ".cm-hr": {
        color: mutedForeground,
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
}: MarkdownEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const isEditable = onChange !== undefined;

  const handleChange = useCallback(
    (val: string) => {
      onChange?.(val);
    },
    [onChange]
  );

  const extensions = useMemo(() => {
    const exts = [...markdownExtensions];

    if (!isEditable) {
      exts.push(EditorState.readOnly.of(true));
    }

    return exts;
  }, [isEditable]);

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

  const isDark = useMemo(() => {
    if (typeof document === "undefined") return false;
    return document.documentElement.classList.contains("dark");
  }, []);

  const theme = useMemo(() => createTheme(isDark), [isDark]);

  return (
    <div className={cn("relative", className)} onKeyDown={handleKeyDown}>
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
        className="text-sm"
      />
    </div>
  );
}
