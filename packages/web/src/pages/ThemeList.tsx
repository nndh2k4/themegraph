import type { Api } from "../api.js";
import { formatTime } from "../labels.js";
import { formatRoute } from "../route.js";
import { Failure, useLoaded } from "../ui.js";

/** Màn đầu tiên: các theme đã phân tích trên máy này. */
export function ThemeList({ api }: { api: Api }) {
  const themes = useLoaded("themes", () => api.themes());

  if (themes.state === "loading") return <p className="muted">Đang tải…</p>;
  if (themes.state === "failed") return <Failure error={themes.error} />;

  if (themes.data.length === 0) {
    return (
      <div className="panel">
        <h1>Chưa có theme nào</h1>
        <p>
          Mở terminal trong thư mục một Shopify theme, chạy <code>themegraph analyze</code>, rồi tải lại trang này.
        </p>
      </div>
    );
  }

  return (
    <>
      <h1>Theme đã phân tích</h1>
      <ul className="themes">
        {themes.data.map((theme) => (
          <li key={theme.id} className={theme.present ? "panel" : "panel missing"}>
            {theme.present ? (
              <a className="theme-name" href={formatRoute({ name: "overview", themeId: theme.id })}>
                {theme.name}
              </a>
            ) : (
              <span className="theme-name">{theme.name}</span>
            )}
            <span className="muted">
              {theme.nodes} node · {theme.edges} cạnh · phân tích {formatTime(theme.analyzedAt)}
            </span>
            <code className="path">{theme.path}</code>
            {!theme.present && (
              <p className="warning">
                Không còn <code>graph.db</code>. Chạy <code>themegraph analyze</code> trong thư mục này để tạo lại, hoặc{" "}
                <code>themegraph clean --theme "{theme.path}"</code> để gỡ khỏi danh sách.
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
