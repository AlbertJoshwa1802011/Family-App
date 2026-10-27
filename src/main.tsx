import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { AuthProvider } from "./context/AuthContext";
import { AssistantUiProvider } from "./context/AssistantUiContext";
import { setupPWA } from "./pwa";
import App from "./App";
// Self-hosted variable fonts — bundled as same-origin woff2 so the CSP
// (`default-src 'self'`) needs no font host and the PWA precaches them.
import "@fontsource-variable/geist";
import "@fontsource-variable/bricolage-grotesque";
import "./index.css";

setupPWA();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AssistantUiProvider>
            <App />
          </AssistantUiProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
