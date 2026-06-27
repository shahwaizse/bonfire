import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ChatApp from "@/components/ChatApp";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <TooltipProvider>
      <ChatApp />
    </TooltipProvider>
  </StrictMode>
);
