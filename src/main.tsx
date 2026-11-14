import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { api } from "./lib/api";
import "./index.css";

// Without this the engine takes the window for blank after 30 seconds and restarts the app.
void api.frontendReady();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
