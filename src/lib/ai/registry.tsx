import { defineRegistry, useStateStore, useActions } from "@json-render/react";
import { useState } from "react";
import { catalog } from "./catalog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MarkdownPreview } from "@/components/MarkdownPreview";

export const { registry } = defineRegistry(catalog, {
  components: {
    ClarifyCard: ({ props }) => {
      const store = useStateStore();
      const actions = useActions();
      return (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm mb-4">{props.message}</p>
            <div className="flex flex-wrap gap-2">
              {props.options.map((opt) => (
                <Button
                  key={opt.value}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    store.set("/clarify/answer", opt.value);
                    actions.execute({ action: "answer_clarify", params: { answer: opt.value } });
                  }}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      );
    },
    ReportPreview: ({ props, children }) => (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{props.title}</CardTitle>
          <p className="text-xs text-muted-foreground">{props.dateRange}</p>
        </CardHeader>
        <CardContent>
          <MarkdownPreview content={props.content} />
          <div className="mt-4 flex gap-2">{children}</div>
        </CardContent>
      </Card>
    ),
    ReportMeta: ({ props }) => (
      <div className="flex gap-3 text-xs text-muted-foreground">
        <span>{props.type}</span>
        <span>·</span>
        <span>{props.generatedAt}</span>
        <span>·</span>
        <span>{props.logCount} entries</span>
      </div>
    ),
    ActionButton: ({ props }) => {
      const actions = useActions();
      return (
        <Button
          variant={props.variant === "primary" ? "default" : "outline"}
          size="sm"
          onClick={() => actions.execute({ action: props.action, params: {} })}
        >
          {props.label}
        </Button>
      );
    },
    LogSelector: ({ props }) => {
      const store = useStateStore();
      const actions = useActions();
      const entries = props.entries || [];
      const [selectedIds, setSelectedIds] = useState<Set<string>>(
        () => new Set(entries.filter((e) => e.selected).map((e) => e.id))
      );

      const toggle = (id: string) => {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      };

      return (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm mb-4">{props.message}</p>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {entries.map((entry) => (
                <label
                  key={entry.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-accent/50 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(entry.id)}
                    onChange={() => toggle(entry.id)}
                    className="rounded border-input shrink-0"
                  />
                  <span className="text-xs text-muted-foreground w-24 shrink-0">{entry.date}</span>
                  <span className="flex-1 truncate text-xs">{entry.summary}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                size="sm"
                disabled={selectedIds.size === 0}
                onClick={() => {
                  store.set("/log_selector/selected_ids", Array.from(selectedIds));
                  actions.execute({
                    action: "confirm_logs",
                    params: { selected_ids: Array.from(selectedIds) },
                  });
                }}
              >
                确认选择
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    },
  },
  actions: {
    save_report: async () => {},
    regenerate: async () => {},
    answer_clarify: async () => {},
    confirm_logs: async () => {},
  },
});
