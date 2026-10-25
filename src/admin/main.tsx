import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminApp from "./AdminApp";
import "../globals.css";
// Last, so the console palette wins over the paper tokens in `globals.css`.
// Only this entry imports it; the public bundle is untouched.
import "./theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><AdminApp /></StrictMode>,
);
