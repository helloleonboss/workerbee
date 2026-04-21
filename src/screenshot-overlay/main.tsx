import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface SelectionCoords {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScreenshotData {
  image_base64: string;
  monitor_width: number;
  monitor_height: number;
}

function ScreenshotOverlayApp() {
  const [screenshotData, setScreenshotData] = useState<ScreenshotData | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selection, setSelection] = useState<SelectionCoords>({ x: 0, y: 0, width: 0, height: 0 });
  const startPosRef = useRef({ x: 0, y: 0 });
  
  useEffect(() => {
    const unlisten = listen<ScreenshotData>("screenshot-overlay-ready", (event) => {
      setScreenshotData(event.payload);
    });
    
    return () => {
      unlisten.then(f => f());
    };
  }, []);
  
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    setIsSelecting(true);
    startPosRef.current = { x: e.clientX, y: e.clientY };
    setSelection({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
  };
  
  const handleMouseUp = async () => {
    if (!isSelecting) return;
    setIsSelecting(false);
    
    if (selection.width > 10 && selection.height > 10) {
      try {
        const relativePath = await invoke<string>("crop_and_save_screenshot", {
          x: selection.x,
          y: selection.y,
          width: selection.width,
          height: selection.height,
        });
        
        await invoke("save_screenshot_log_entry", { imagePath: relativePath });
        
        // Notify Rust to close overlay
        await invoke("close_screenshot_overlay");
      } catch (error) {
        console.error("Failed to save screenshot:", error);
        alert("保存截图失败: " + error);
      }
    } else {
      // Selection too small, cancel
      handleCancel();
    }
  };
  
  const handleCancel = async () => {
    try {
      await invoke("cancel_screenshot");
    } catch (error) {
      console.error("Failed to cancel screenshot:", error);
    }
  };
  
  useEffect(() => {
    if (isSelecting) {
      const handleWindowMouseMove = (e: MouseEvent) => {
        const currentX = e.clientX;
        const currentY = e.clientY;
        const startX = startPosRef.current.x;
        const startY = startPosRef.current.y;
        
        const newSelection: SelectionCoords = {
          x: Math.min(startX, currentX),
          y: Math.min(startY, currentY),
          width: Math.abs(currentX - startX),
          height: Math.abs(currentY - startY),
        };
        
        setSelection(newSelection);
      };
      
      const handleWindowMouseUp = () => {
        handleMouseUp();
      };
      
      window.addEventListener("mousemove", handleWindowMouseMove);
      window.addEventListener("mouseup", handleWindowMouseUp);
      
      return () => {
        window.removeEventListener("mousemove", handleWindowMouseMove);
        window.removeEventListener("mouseup", handleWindowMouseUp);
      };
    }
  }, [isSelecting, selection]);
  
  useEffect(() => {
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCancel();
      }
    };
    
    const handleWindowContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      handleCancel();
    };
    
    window.addEventListener("keydown", handleWindowKeyDown);
    window.addEventListener("contextmenu", handleWindowContextMenu);
    
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
      window.removeEventListener("contextmenu", handleWindowContextMenu);
    };
  }, []);
  
  if (!screenshotData) {
    return (
      <div className="flex items-center justify-center h-screen bg-black/50 text-white">
        <div className="text-lg">加载截图中...</div>
      </div>
    );
  }
  
  const { image_base64, monitor_width, monitor_height } = screenshotData;
  
  return (
    <div 
      className="fixed inset-0"
      style={{
        backgroundImage: `url(${image_base64})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        cursor: "crosshair",
        width: monitor_width,
        height: monitor_height,
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Dark mask overlay */}
      <div 
        className="absolute inset-0 bg-black/40 pointer-events-none"
        style={{ width: monitor_width, height: monitor_height }}
      />
      
      {/* Selection rectangle */}
      {isSelecting && selection.width > 0 && selection.height > 0 && (
        <>
          <div
            className="absolute border-2 border-blue-500 bg-transparent pointer-events-none"
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height,
            }}
          />
          
          {/* Dimension text */}
          <div className="absolute top-4 left-4 bg-black/80 text-white px-3 py-2 rounded text-sm pointer-events-none">
            {selection.width} × {selection.height}
          </div>
        </>
      )}
    </div>
  );
}

export default ScreenshotOverlayApp;
