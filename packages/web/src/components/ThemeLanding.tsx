import { AlertTriangle, ArrowRight, Layers, Share2 } from "lucide-react";

import type { Api } from "../api.js";
import { formatTime } from "../labels.js";
import { Failure, themeHref, useLoaded } from "../ui.js";

/** Màn đầu tiên: chọn một trong các theme đã phân tích trên máy này. */
export function ThemeLanding({ api }: { api: Api }) {
  const themes = useLoaded("themes", () => api.themes());

  return (
    <div className="landing">
      <div className="landing-card">
        <p className="eyebrow accent">ThemeGraph</p>
        <h1>Chọn một theme</h1>
        <p className="landing-lead">Đồ thị quan hệ giữa các file của Shopify theme: trang nào dùng file nào, sửa một file thì ảnh hưởng tới đâu.</p>

        {themes.state === "loading" && <p className="muted">Đang tải…</p>}
        {themes.state === "failed" && <Failure error={themes.error} />}
        {themes.state === "ready" && themes.data.length === 0 && (
          <p className="landing-empty">
            Chưa có theme nào. Mở terminal trong thư mục một Shopify theme, chạy <code>themegraph analyze</code>, rồi tải lại trang này.
          </p>
        )}

        {themes.state === "ready" && (
          <ul className="landing-list">
            {themes.data.map((theme) => {
              const body = (
                <>
                  <div className="landing-row">
                    <span className="landing-name">{theme.name}</span>
                    {theme.problem === null && <ArrowRight size={16} className="landing-arrow" />}
                  </div>
                  <p className="muted note path">{theme.path}</p>
                  <div className="landing-chips">
                    <span>
                      <Layers size={12} /> {theme.nodes} node
                    </span>
                    <span>
                      <Share2 size={12} /> {theme.edges} cạnh
                    </span>
                    <span>phân tích {formatTime(theme.analyzedAt)}</span>
                  </div>
                  {theme.problem !== null && (
                    <p className="warning">
                      <AlertTriangle size={14} />{" "}
                      {theme.present ? (
                        theme.problem
                      ) : (
                        <>
                          Không còn <code>graph.db</code>. Chạy <code>themegraph analyze</code> trong thư mục này để tạo lại, hoặc{" "}
                          <code>themegraph clean --theme "{theme.path}"</code> để gỡ khỏi danh sách.
                        </>
                      )}
                    </p>
                  )}
                </>
              );

              return (
                <li key={theme.id}>
                  {theme.problem === null ? (
                    <a className="landing-theme" href={themeHref(theme.id)}>
                      {body}
                    </a>
                  ) : (
                    <div className="landing-theme unavailable">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="landing-foot">
          Thêm theme: chạy <code>themegraph analyze</code> trong thư mục theme đó.
        </p>
      </div>
    </div>
  );
}
