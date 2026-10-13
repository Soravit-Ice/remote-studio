import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import { StudioErrorBoundary } from "./components/StudioErrorBoundary";
import "./styles/globals.css";
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30000, refetchOnWindowFocus: true },
  },
});
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StudioErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StudioErrorBoundary>
  </React.StrictMode>,
);
