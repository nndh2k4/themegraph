import { ChevronDown, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Api, ApiTheme } from "../api.js";
import { kindColor } from "../graph-model.js";
import type { NodeHit } from "../graph-model.js";
import { kindLabel } from "../labels.js";
import { themeHref, useLoaded, useNavigator } from "../ui.js";

/** Số kết quả hiện dưới ô tìm kiếm. */
const MAX_HITS_SHOWN = 8;

/** Thanh trên cùng: tên công cụ, theme đang xem (bấm để đổi), và ô tìm kiếm. */
export function Header({
  api,
  theme,
  query,
  hits,
  onQuery,
  onPick,
}: {
  api: Api;
  theme: ApiTheme | undefined;
  query: string;
  hits: NodeHit[];
  onQuery: (query: string) => void;
  onPick: (hit: NodeHit) => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <a className="brand" href="#/">
          <span className="brand-mark">T</span>
          ThemeGraph
        </a>
        <ThemeSwitcher api={api} theme={theme} />
      </div>

      <SearchBox query={query} hits={hits} onQuery={onQuery} onPick={onPick} />

      {/* Cột trống, rộng bằng cột trái, để ô tìm kiếm nằm giữa thanh. */}
      <div className="topbar-right" />
    </header>
  );
}

/** Tên theme đang xem; bấm thì mở danh sách các theme đã phân tích để đổi. */
function ThemeSwitcher({ api, theme }: { api: Api; theme: ApiTheme | undefined }) {
  const { themeId } = useNavigator();
  const themes = useLoaded("themes", () => api.themes());
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Bấm ra ngoài thì đóng.
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent): void => {
      if (box.current !== null && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="switcher" ref={box}>
      <button type="button" className="switcher-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="dot live" />
        <span className="switcher-name">{theme?.name ?? themeId}</span>
        <ChevronDown size={14} />
      </button>
      {open && themes.state === "ready" && (
        <div className="popover switcher-list">
          <p className="eyebrow">Theme đã phân tích</p>
          <ul>
            {themes.data.map((entry) => (
              <li key={entry.id}>
                {entry.problem === null ? (
                  <a href={themeHref(entry.id)} className={entry.id === themeId ? "current" : ""} onClick={() => setOpen(false)}>
                    <span className="node">{entry.name}</span>
                    <span className="muted note">{entry.path}</span>
                  </a>
                ) : (
                  <span className="unavailable" title={entry.problem}>
                    <span className="node">{entry.name}</span>
                    <span className="muted note">cần chạy lại themegraph analyze</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Ô tìm kiếm. Gõ tới đâu, danh sách bên dưới và các node khớp trên đồ thị
 * đổi tới đó. Chỉ tìm file và trang, tức những thứ được vẽ trên đồ thị.
 *
 * Chọn bằng chuột, hoặc bằng phím mũi tên rồi Enter; Enter ngay thì lấy kết
 * quả đầu tiên; Escape xoá từ khoá. Phím "/" đưa con trỏ vào ô từ bất cứ đâu.
 */
function SearchBox({
  query,
  hits,
  onQuery,
  onPick,
}: {
  query: string;
  hits: NodeHit[];
  onQuery: (query: string) => void;
  onPick: (hit: NodeHit) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows = hits.slice(0, MAX_HITS_SHOWN);
  const current = Math.min(active, Math.max(rows.length - 1, 0));

  const pick = (hit: NodeHit): void => {
    onPick(hit);
    input.current?.blur();
  };

  const open = focused && query.trim() !== "";

  return (
    <div className="search">
      <div className="search-field">
        <Search size={15} />
        <input
          ref={input}
          type="text"
          value={query}
          placeholder="Tìm section, block, snippet, layout…"
          aria-label="Tìm trong theme"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            onQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (rows.length > 0) setActive((current + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
            } else if (event.key === "Enter") {
              const row = rows[current];
              if (row !== undefined) pick(row);
            } else if (event.key === "Escape") {
              onQuery("");
              input.current?.blur();
            }
          }}
        />
        <kbd>/</kbd>
      </div>

      {open && (
        <div className="popover search-results">
          {rows.length === 0 ? (
            <p className="muted">Không có gì khớp.</p>
          ) : (
            <ul>
              {rows.map((row, index) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={index === current ? "search-hit active" : "search-hit"}
                    // mousedown chứ không phải click: click tới sau khi ô nhập mất tiêu điểm.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      pick(row);
                    }}
                  >
                    <span className="dot" style={{ background: kindColor(row.kind) }} />
                    <span className="node">{row.label}</span>
                    <span className="muted note">{kindLabel(row.kind)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hits.length > 0 && (
            <p className="muted note">
              {hits.length} file khớp, đang được làm nổi trên đồ thị
              {hits.length > rows.length && `; gõ thêm để thu hẹp (đang hiện ${rows.length})`}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
