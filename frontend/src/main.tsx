import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { Providers } from "@/providers";
import { router } from "@/router";
import "@/app/globals.css";

// This is the entry point of the whole app (the file index.html loads).
// 1. Find the <div id="root"> in index.html
// 2. Wrap the app in Providers (TanStack Query) and the router
// 3. Render it into the page
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </React.StrictMode>,
);
