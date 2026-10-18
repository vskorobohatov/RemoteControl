import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { RemoteControlProvider } from "./providers/RemoteControlContext";
import "./styles/global.scss";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("missing #root element");
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <RemoteControlProvider>
        <App />
      </RemoteControlProvider>
    </BrowserRouter>
  </StrictMode>,
);
