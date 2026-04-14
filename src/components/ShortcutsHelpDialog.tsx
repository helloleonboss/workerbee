import { Keyboard } from "lucide-react";
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { t } from "../lib/i18n";

interface ShortcutsHelpDialogProps {
  shortcut: string;
}

/**
 * Renders only the DialogContent — caller must wrap with <Dialog> + <DialogTrigger>.
 */
export function ShortcutsHelpDialog({ shortcut }: ShortcutsHelpDialogProps) {
  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Keyboard className="w-5 h-5" />
          {t("shortcuts.title")}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 text-sm">
        <div>
          <p className="font-medium text-foreground">{t("shortcuts.global")}</p>
          <p className="text-muted-foreground">{t("shortcuts.globalDesc")}</p>
          <p className="mt-1 font-mono text-xs bg-muted px-2 py-1 rounded inline-block">{shortcut}</p>
        </div>
        <div className="border-t pt-4">
          <p className="font-medium text-foreground mb-2">{t("shortcuts.quickInput")}</p>
          <div className="grid grid-cols-2 gap-2 text-muted-foreground">
            <div className="flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">{t("shortcuts.enterSubmit")}</kbd>
              <span>{t("shortcuts.enterSubmitDesc")}</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">{t("shortcuts.shiftEnter")}</kbd>
              <span>{t("shortcuts.shiftEnterDesc")}</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">{t("shortcuts.escClose")}</kbd>
              <span>{t("shortcuts.escCloseDesc")}</span>
            </div>
          </div>
        </div>
        <div className="border-t pt-4">
          <p className="font-medium text-foreground mb-2">{t("shortcuts.editTime")}</p>
          <p className="text-muted-foreground text-xs">{t("shortcuts.editTimeDesc")}</p>
          <p className="text-muted-foreground text-xs mt-1">{t("shortcuts.editSaveDesc")}</p>
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">{t("common.close")}</Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  );
}
