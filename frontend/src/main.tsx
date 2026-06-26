import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ChatApp from "@/components/ChatApp";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ChatApp />
  </StrictMode>
);
