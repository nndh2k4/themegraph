import { useEffect, useState } from "react";

import type { Api } from "./api.js";
import { FileDetail } from "./pages/FileDetail.js";
import { Flow } from "./pages/Flow.js";
import { GraphView } from "./pages/Graph.js";
import { Overview } from "./pages/Overview.js";
import { Search } from "./pages/Search.js";
import { ThemeList } from "./pages/ThemeList.js";
import { formatRoute, parseRoute } from "./route.js";
import type { Route } from "./route.js";
import { useLoaded } from "./ui.js";

/** Route hiện tại, cập nhật mỗi khi phần hash của địa chỉ đổi. */
function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onChange = (): void => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}

export function App({ api }: { api: Api }) {
  const route = useRoute();
  const themeId = "themeId" in route ? route.themeId : null;

  return (
    <>
      <Header api={api} themeId={themeId} />
      <main className={route.name === "graph" ? "wide" : undefined}>
        {route.name === "themes" && <ThemeList api={api} />}
        {route.name === "overview" && <Overview api={api} themeId={route.themeId} />}
        {route.name === "search" && <Search api={api} themeId={route.themeId} q={route.q} kind={route.kind} />}
        {route.name === "file" && <FileDetail api={api} themeId={route.themeId} path={route.path} />}
        {route.name === "graph" && (
          <GraphView api={api} themeId={route.themeId} kinds={route.kinds} node={route.node} near={route.near} />
        )}
        {route.name === "flow" && <Flow api={api} themeId={route.themeId} page={route.page} />}
        {route.name === "not_found" && (
          <div className="panel">
            <h1>Không có trang này</h1>
            <p>
              <a href={formatRoute({ name: "themes" })}>Về danh sách theme</a>
            </p>
          </div>
        )}
      </main>
    </>
  );
}

/** Thanh trên cùng: tên công cụ, theme đang xem, và ô tìm nhanh. */
function Header({ api, themeId }: { api: Api; themeId: string | null }) {
  // Tên theme lấy từ danh sách theme; tải một lần cho cả phiên.
  const themes = useLoaded("themes", () => api.themes());
  const theme = themes.state === "ready" && themeId !== null ? themes.data.find((entry) => entry.id === themeId) : undefined;
  const [text, setText] = useState("");

  return (
    <header>
      <a className="brand" href={formatRoute({ name: "themes" })}>
        ThemeGraph
      </a>
      {themeId !== null && (
        <>
          <a className="current-theme" href={formatRoute({ name: "overview", themeId })}>
            {theme?.name ?? themeId}
          </a>
          <nav>
            <a href={formatRoute({ name: "graph", themeId, kinds: "", node: "", near: false })}>Đồ thị</a>
            <a href={formatRoute({ name: "flow", themeId, page: "" })}>Cây render</a>
          </nav>
          <form
            className="quick-search"
            onSubmit={(event) => {
              event.preventDefault();
              window.location.hash = formatRoute({ name: "search", themeId, q: text.trim(), kind: "" });
              setText("");
            }}
          >
            <input
              type="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Tìm trong theme…"
              aria-label="Tìm trong theme"
            />
          </form>
        </>
      )}
    </header>
  );
}
