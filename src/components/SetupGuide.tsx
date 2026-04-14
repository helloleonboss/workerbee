import { useState } from "react";
import { getDefaultStoragePath } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { FolderOpen } from "lucide-react";
import { t } from "../lib/i18n";

interface SetupGuideProps {
  onComplete: (path: string) => Promise<void>;
}

export function SetupGuide({ onComplete }: SetupGuideProps) {
  const [storagePath, setStoragePath] = useState("");
  const [setuping, setSetuping] = useState(false);

  async function handleUseDefault() {
    try {
      const defaultPath = await getDefaultStoragePath();
      setStoragePath(defaultPath);
    } catch (e) {
      console.error("Failed to get default path:", e);
    }
  }

  async function handleChooseFolder() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("settings.storage.title"),
      });
      if (selected) {
        const path = typeof selected === "string" ? selected : selected;
        setStoragePath(path as string);
      }
    } catch (e) {
      console.error("Failed to choose folder:", e);
    }
  }

  async function handleSubmit() {
    if (!storagePath.trim()) return;
    setSetuping(true);
    try {
      await onComplete(storagePath.trim());
    } catch (e) {
      console.error("Failed to setup:", e);
    } finally {
      setSetuping(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-muted/30">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <CardTitle className="text-xl">{t("setup.welcome")}</CardTitle>
          <CardDescription>
            {t("setup.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("setup.storagePath")}</label>
            <div className="flex gap-2">
              <Input
                value={storagePath}
                onChange={(e) => setStoragePath(e.target.value)}
                placeholder={t("setup.placeholder")}
                className="flex-1"
              />
              <Button variant="outline" onClick={handleChooseFolder}>
                <FolderOpen className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={handleUseDefault} className="flex-1">
              {t("setup.useDefault")}
            </Button>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!storagePath.trim() || setuping}
            className="w-full"
          >
            {setuping ? t("setup.submitting") : t("setup.submit")}
          </Button>

          <div className="text-xs text-muted-foreground space-y-1">
            <p>{t("setup.defaultShortcut", { shortcut: "Ctrl+Shift+Space" })}</p>
            <p>{t("setup.directoryStructure")}</p>
            <pre className="bg-muted p-2 rounded text-[11px] font-mono">
{`${t("app.name")}/
├── .config.json
├── logs/
│   └── YYYY-MM-DD.md
└── reports/
    └── YYYY-MM-DD-report.md`}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}