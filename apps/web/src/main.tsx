import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "@/App";
import { ThemeProvider } from "@/components/admin/theme-provider";
import "@/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter basename="/app">
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
