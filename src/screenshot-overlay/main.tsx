import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface SelectionCoords {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScreenshotData {
  image_path: string;
  monitor_x: number;
  monitor_y: number;
  monitor_width: number;
  monitor_height: number;
}

function ScreenshotOverlayApp() {
  const [screenshotData, setScreenshotData] = useState<ScreenshotData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSelecting, setIsSelecting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const startPosRef = useRef({ x: 0, y: 0 });
  const selectionRef = useRef<SelectionCoords>({ x: 0, y: 0, width: 0, height: 0 });
  const [, forceUpdate] = useState({});
  const cancelRef = useRef<() => void>(() => {});

  useEffect(() => {
    const unlistenReset = listen("screenshot-reset", () => {
      setScreenshotData(null);
      setIsLoading(true);
      setIsSelecting(false);
      selectionRef.current = { x: 0, y: 0, width: 0, height: 0 };
      setSaveError(null);
      setSaveSuccess(false);
    });

    const unlistenDataReady = listen("screenshot-data-ready", () => {
      invoke<ScreenshotData>("get_screenshot_overlay_data")
        .then((data) => {
          setScreenshotData(data);
          setIsLoading(false);
        })
        .catch((error) => {
          console.error("Failed to get screenshot data:", error);
          setIsLoading(false);
        });
    });

    return () => {
      unlistenReset.then((f) => f());
      unlistenDataReady.then((f) => f());
    };
  }, []);

  const doCancel = useCallback(async () => {
    try {
      await invoke("cancel_screenshot");
    } catch (error) {
      console.error("Failed to cancel screenshot:", error);
    }
  }, []);

  cancelRef.current = doCancel;

  const handleMouseUp = useCallback(async () => {
    if (!isSelecting) return;
    setIsSelecting(false);

    const sel = selectionRef.current;
    if (sel.width > 10 && sel.height > 10) {
      try {
        setSaveError(null);
        const relativePath = await invoke<string>("crop_and_save_screenshot", {
          x: sel.x,
          y: sel.y,
          width: sel.width,
          height: sel.height,
        });
        await invoke("save_screenshot_log_entry", { imagePath: relativePath });
        setSaveSuccess(true);
        setTimeout(async () => {
          await invoke("close_screenshot_overlay");
        }, 1500);
      } catch (error) {
        console.error("Failed to save screenshot:", error);
        const message = error instanceof Error ? error.message : String(error);
        setSaveError(message);
        setTimeout(() => setSaveError(null), 3000);
      }
    } else {
      cancelRef.current();
    }
  }, [isSelecting]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsSelecting(true);
    startPosRef.current = { x: e.clientX, y: e.clientY };
    const newSelection: SelectionCoords = { x: e.clientX, y: e.clientY, width: 0, height: 0 };
    selectionRef.current = newSelection;
    forceUpdate({});
  }, []);

  useEffect(() => {
    if (!isSelecting) return;

    const handleMouseMove = (e: MouseEvent) => {
      const startX = startPosRef.current.x;
      const startY = startPosRef.current.y;
      const newSelection: SelectionCoords = {
        x: Math.min(startX, e.clientX),
        y: Math.min(startY, e.clientY),
        width: Math.abs(e.clientX - startX),
        height: Math.abs(e.clientY - startY),
      };
      selectionRef.current = newSelection;
      forceUpdate({});
    };

    const handleWindowMouseUp = () => {
      handleMouseUp();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isSelecting, handleMouseUp]);

  // Keyboard and context menu handlers — registered once, uses ref for latest cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelRef.current();
    };
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      cancelRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("contextmenu", handleContextMenu);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  // ─── Render ───

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <span className="text-white text-sm opacity-70">加载中...</span>
        </div>
      </div>
    );
  }

  if (!screenshotData) return null;

  const { image_path, monitor_width, monitor_height } = screenshotData;
  const imageUrl = convertFileSrc(image_path);

  const sel = selectionRef.current;
  const hasSelection = isSelecting && sel.width > 0 && sel.height > 0;

  const maskClipPath = hasSelection
    ? `polygon(
        0% 0%,
        0% 100%,
        ${sel.x}px 100%,
        ${sel.x}px ${sel.y}px,
        ${sel.x + sel.width}px ${sel.y}px,
        ${sel.x + sel.width}px ${sel.y + sel.height}px,
        ${sel.x}px ${sel.y + sel.height}px,
        ${sel.x}px 100%,
        100% 100%,
        100% 0%
      )`
    : undefined;

  // Smart label positioning
  const LABEL_W = 70;
  const LABEL_H = 24;
  const labelX = sel.x + sel.width + LABEL_W > monitor_width
    ? sel.x - LABEL_W - 4
    : sel.x + sel.width + 4;
  const labelY = sel.y + sel.height + LABEL_H > monitor_height
    ? sel.y - LABEL_H - 4
    : sel.y + sel.height + 4;

  return (
    <div
      className="fixed inset-0"
      style={{
        backgroundImage: `url(${imageUrl})`,
        backgroundSize: `${monitor_width}px ${monitor_height}px`,
        backgroundPosition: "top left",
        cursor: "crosshair",
        width: monitor_width,
        height: monitor_height,
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Dark mask with cutout for selection area */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          width: monitor_width,
          height: monitor_height,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          clipPath: maskClipPath,
        }}
      />

      {/* Selection border */}
      {hasSelection && (
        <>
          <div
            className="absolute pointer-events-none"
            style={{
              left: sel.x,
              top: sel.y,
              width: sel.width,
              height: sel.height,
              border: "2px solid white",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
            }}
          />
          <div
            className="absolute pointer-events-none bg-black/70 text-white px-2 py-1 rounded text-xs"
            style={{
              left: labelX,
              top: labelY,
            }}
          >
            {sel.width} × {sel.height}
          </div>
        </>
      )}

      {/* Save success toast */}
      {saveSuccess && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg animate-pulse">
          ✓ 已保存
        </div>
      )}

      {/* Save error toast */}
      {saveError && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm shadow-lg">
          保存截图失败: {saveError}
        </div>
      )}
    </div>
  );
}

export default ScreenshotOverlayApp;
