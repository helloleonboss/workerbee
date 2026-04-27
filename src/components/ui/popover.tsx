import * as React from "react";
import { cn } from "@/lib/utils";

interface PopoverContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

const PopoverContext = React.createContext<PopoverContextValue | null>(null);

function usePopover() {
  const ctx = React.useContext(PopoverContext);
  if (!ctx) throw new Error("Popover components must be used within <Popover>");
  return ctx;
}

interface PopoverProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

function Popover({ open: controlledOpen, onOpenChange, children }: PopoverProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const open = controlledOpen ?? internalOpen;
  const setOpen = React.useCallback(
    (value: boolean) => {
      if (onOpenChange) onOpenChange(value);
      else setInternalOpen(value);
    },
    [onOpenChange]
  );

  const ctx = React.useMemo(() => ({ open, setOpen, triggerRef }), [open, setOpen]);

  return <PopoverContext.Provider value={ctx}>{children}</PopoverContext.Provider>;
}

interface PopoverTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const PopoverTrigger = React.forwardRef<HTMLButtonElement, PopoverTriggerProps>(
  ({ asChild = false, onClick, children, ...props }, ref) => {
    const { open, setOpen, triggerRef } = usePopover();

    const mergedRef = React.useCallback(
      (el: HTMLButtonElement | null) => {
        (triggerRef as React.MutableRefObject<HTMLButtonElement | null>).current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = el;
      },
      [ref, triggerRef]
    );

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      setOpen(!open);
      onClick?.(e);
    };

    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        ref: mergedRef,
        onClick: handleClick,
        "aria-expanded": open,
      });
    }

    return (
      <button ref={mergedRef} onClick={handleClick} aria-expanded={open} {...props}>
        {children}
      </button>
    );
  }
);
PopoverTrigger.displayName = "PopoverTrigger";

interface PopoverContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "center" | "end";
  sideOffset?: number;
}

const PopoverContent = React.forwardRef<HTMLDivElement, PopoverContentProps>(
  ({ className, align = "center", sideOffset = 4, style, ...props }, ref) => {
    const { open, setOpen, triggerRef } = usePopover();
    const contentRef = React.useRef<HTMLDivElement | null>(null);
    const [position, setPosition] = React.useState<React.CSSProperties>({});

    React.useImperativeHandle(ref, () => contentRef.current!);

    React.useEffect(() => {
      if (!open) return;

      function updatePosition() {
        const trigger = triggerRef.current;
        const content = contentRef.current;
        if (!trigger || !content) return;

        const triggerRect = trigger.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();

        let left: number;
        if (align === "start") left = triggerRect.left;
        else if (align === "end") left = triggerRect.right - contentRect.width;
        else left = triggerRect.left + (triggerRect.width - contentRect.width) / 2;

        let top = triggerRect.bottom + sideOffset;

        // Flip above if overflows bottom
        if (top + contentRect.height > window.innerHeight) {
          top = triggerRect.top - contentRect.height - sideOffset;
        }
        // Clamp horizontal
        left = Math.max(8, Math.min(left, window.innerWidth - contentRect.width - 8));

        setPosition({ position: "fixed", left, top, zIndex: 50 });
      }

      updatePosition();
      window.addEventListener("resize", updatePosition);
      return () => window.removeEventListener("resize", updatePosition);
    }, [open, align, sideOffset, triggerRef]);

    React.useEffect(() => {
      if (!open) return;
      function handleClickOutside(e: MouseEvent) {
        const target = e.target as Node;
        if (
          contentRef.current?.contains(target) ||
          triggerRef.current?.contains(target)
        )
          return;
        setOpen(false);
      }
      function handleEscape(e: KeyboardEvent) {
        if (e.key === "Escape") setOpen(false);
      }
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleEscape);
      };
    }, [open, setOpen, triggerRef]);

    if (!open) return null;

    return (
      <div
        ref={contentRef}
        className={cn(
          "z-50 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className
        )}
        style={{ ...position, ...style }}
        {...props}
      />
    );
  }
);
PopoverContent.displayName = "PopoverContent";

export { Popover, PopoverTrigger, PopoverContent };
