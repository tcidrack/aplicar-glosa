import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import PainelGlosa from "./PainelGlosa.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <PainelGlosa />
  </StrictMode>
);
