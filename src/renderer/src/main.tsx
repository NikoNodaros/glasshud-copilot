import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { OverlayApp } from "./components/OverlayApp";
import { DashboardApp } from "./components/DashboardApp";
import { DisplayPickerApp } from "./components/DisplayPickerApp";

const params = new URLSearchParams(window.location.search);
const view = params.get("view") ?? "overlay";

document.body.classList.add(`view-${view}`);

function Root() {
  if (view === "dashboard") {
    return <DashboardApp />;
  }
  if (view === "picker") {
    const displayId = Number(params.get("displayId") ?? "0");
    const label = params.get("label") ?? `Display ${displayId}`;
    return <DisplayPickerApp displayId={displayId} label={label} />;
  }
  return <OverlayApp />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
