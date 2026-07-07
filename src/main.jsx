import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import PainelAuditoria from "./PainelAuditoria.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <PainelAuditoria />
  </StrictMode>
);
