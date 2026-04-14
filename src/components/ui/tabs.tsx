import * as React from "react";
import { cn } from "@/lib/utils";

function Tabs({
  className,
  children,
  value,
  onValueChange,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className={cn("", className)} {...props}>
      {children}
    </div>
  );
}

function TabsList({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
        className
      )}
      role="tablist"
      {...props}
    >
      {children}
    </div>
  );
}

function TabsTrigger({
  className,
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        active
          ? "bg-background text-foreground shadow"
          : "hover:bg-background/50",
        className
      )}
      role="tab"
      type="button"
      {...props}
    />
  );
}

function TabsContent({
  className,
  children,
  active,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { active?: boolean }) {
  if (!active) return null;
  return (
    <div
      className={cn("mt-2 ring-offset-background focus-visible:outline-none", className)}
      role="tabpanel"
      {...props}
    >
      {children}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };