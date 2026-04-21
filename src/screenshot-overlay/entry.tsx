import { createRoot } from "react-dom/client";
import ScreenshotOverlayApp from "./main";

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<ScreenshotOverlayApp />);
}
