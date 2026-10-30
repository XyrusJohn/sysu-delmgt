import React from "react";
import { createRoot } from "react-dom/client";
import Dashboard from "./pages/Dashboard";
import { AuthService } from "./api/authService";

const rootElement = document.getElementById("root");

if (rootElement) {
  const root = createRoot(rootElement);

  //  Auth Guard for the Root
  AuthService.check()
    .then((result) => {
      if (result?.data?.role && result.data.role !== "pending") {
        root.render(<Dashboard />);
      } else {
        //  If not authenticated or pending, we stay on the login page
        //  which is handled by the index.html / index.js flow.
        //  However, for a Single Page App (SPA) experience,
        //  we usually redirect to / if not authorized.
        if (window.location.pathname !== "/") {
          window.location.href = "/";
        }
      }
    })
    .catch((err) => {
      console.error("App initialization failed:", err);
      if (window.location.pathname !== "/") {
        window.location.href = "/";
      }
    });
}
