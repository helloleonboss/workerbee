import { useState, useRef, useEffect, useCallback } from "react";
import { ScrollArea } from "./ui/scroll-area";
import { FileText, Plus } from "lucide-react";
import { listTemplates, readTemplate, writeTemplate, deleteTemplate } from "../lib/api";
import { MarkdownEditor } from "./MarkdownEditor";
import { t } from "../lib/i18n";

interface TemplatesViewProps {
  onRefresh?: () => void;
}

export function TemplatesView({ onRefresh }: TemplatesViewProps) {
  const [templates, setTemplates] = useState<string[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalContentRef = useRef("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Load templates list on mount
  useEffect(() => {
    loadTemplates();
  }, []);

  async function loadTemplates() {
    try {
      const list = await listTemplates();
      setTemplates(list.sort().reverse());
    } catch (e) {
      console.error("Failed to load templates:", e);
    }
  }

  async function loadTemplate(filename: string) {
    setLoading(true);
    try {
      const text = await readTemplate(filename);
      setSelectedTemplate(filename);
      setContent(text);
      originalContentRef.current = text;
    } catch (e) {
      console.error("Failed to load template:", e);
    } finally {
      setLoading(false);
    }
  }

  function handleContentChange(newContent: string) {
    setContent(newContent);

    // Debounced auto-save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(async () => {
      if (selectedTemplate && newContent !== originalContentRef.current) {
        try {
          await writeTemplate(selectedTemplate, newContent);
          originalContentRef.current = newContent;
          onRefresh?.();
        } catch (e) {
          console.error("Failed to save template:", e);
        }
      }
    }, 300);
  }

  // Display filename without .md extension
  function displayName(filename: string): string {
    return filename.replace(/\.md$/, "");
  }

  async function createTemplate() {
    // Find a unique name: "new-template", "new-template-2", "new-template-3", ...
    const base = t("templates.newName");
    let name = base;
    let counter = 2;
    while (templates.includes(name)) {
      name = `${base}-${counter}`;
      counter++;
    }

    try {
      await writeTemplate(name, "");
      await loadTemplates();
      await loadTemplate(name);
    } catch (e) {
      console.error("Failed to create template:", e);
    }
  }

  const startRename = useCallback(() => {
    if (!selectedTemplate) return;
    setNameInput(displayName(selectedTemplate));
    setEditingName(true);
    requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
  }, [selectedTemplate]);

  const finishRename = useCallback(async () => {
    setEditingName(false);
    if (!selectedTemplate) return;
    const newName = nameInput.trim();
    if (!newName || newName === displayName(selectedTemplate)) return;

    try {
      await writeTemplate(newName, content);
      await deleteTemplate(selectedTemplate);
      setSelectedTemplate(newName);
      await loadTemplates();
    } catch (e) {
      console.error("Failed to rename template:", e);
    }
  }, [selectedTemplate, nameInput, content]);

  return (
    <div className="flex h-full">
      {/* Sidebar: Template list */}
      <div className="w-32 border-r bg-muted/20 flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">
            {t("templates.title")}
          </h3>
          <button
            onClick={createTemplate}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title={t("templates.newTemplate")}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <ScrollArea className="flex-1">
          <div className="py-1">
            {templates.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                {t("templates.noTemplates")}
              </div>
            ) : (
              templates.map((filename) => (
                <button
                  key={filename}
                  onClick={() => loadTemplate(filename)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors truncate ${
                    filename === selectedTemplate
                      ? "bg-accent font-medium"
                      : ""
                  }`}
                >
                  {displayName(filename)}
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col">
        {selectedTemplate ? (
          <>
            {/* Filename header — click to rename */}
            <div className="px-4 py-3 border-b">
              {editingName ? (
                <input
                  ref={nameInputRef}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onBlur={finishRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); finishRename(); }
                    if (e.key === "Escape") { setEditingName(false); }
                  }}
                  className="text-sm font-medium bg-transparent outline-none border-0 p-0 w-full caret-foreground"
                />
              ) : (
                <h3
                  className="text-sm font-medium cursor-text"
                  onClick={startRename}
                  title={t("templates.clickToRename")}
                >
                  {displayName(selectedTemplate)}
                </h3>
              )}
            </div>

            {/* Template content */}
            <div className="flex-1">
              {loading ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  {t("app.loading")}
                </div>
              ) : (
                <MarkdownEditor
                  value={content}
                  onChange={handleContentChange}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <FileText className="w-10 h-10 opacity-30 mb-2" />
            <p className="text-sm">{t("templates.selectTemplate")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
