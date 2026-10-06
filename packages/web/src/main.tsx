import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createApi } from "./api.js";
import { App } from "./App.js";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Thiếu phần tử #root trong index.html.");

// API nằm cùng cổng với trang này, nên chỉ cần đường dẫn tương đối.
const api = createApi((url) => fetch(url));

createRoot(root).render(
  <StrictMode>
    <App api={api} />
  </StrictMode>,
);
