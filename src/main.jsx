import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import EditorAuditoria from "./EditorAuditoria.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <EditorAuditoria />
  </StrictMode>
);
