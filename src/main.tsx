import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DashboardScreen } from "./dashboard/DashboardScreen";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

// A promise rejected with nobody listening used to vanish. It now reaches the
// log, which is the only way a fault someone reports can be traced.
window.addEventListener("unhandledrejection", (event) => {
  console.error("[HARE] Unhandled rejection:", event.reason);
});

// The second-screen dashboard is the same bundle loaded with a #dashboard
// hash (see electron/backend/dashboardWindow.ts) rather than a second HTML
// entry point — one build, one preload, one store.
const isDashboard = window.location.hash.replace(/^#\/?/, "") === "dashboard";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>{isDashboard ? <DashboardScreen /> : <App />}</ErrorBoundary>
  </React.StrictMode>
);
