import { ChevronDown, PanelRight, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Api, ApiTheme } from "../api.js";
import { kindColor } from "../graph-model.js";
import type { NodeHit } from "../graph-model.js";
import { displayName, kindLabel } from "../labels.js";
import { themeHref, useDebounced, useLoaded, useNavigator } from "../ui.js";

/** Số kết quả hiện ở mỗi nhóm dưới ô tìm kiếm. */
const MAX_HITS_SHOWN = 8;
const MAX_OTHER_SHOWN = 5;

/** Một dòng trong danh sách kết quả: node trên đồ thị, hoặc khoá dịch / setting. */
interface Row {
  id: string;
  kind: string;
  label: string;
  hit: NodeHit | null; // null với khoá dịch và setting: chúng không nằm trên đồ thị
}

/**
 * Thanh trên cùng: tên công cụ, theme đang xem (bấm để đổi), ô tìm kiếm, và
 * nút đóng mở panel phải.
 */
export function Header({
  api,
  theme,
  query,
  hits,
  onQuery,
  onPick,
  rightOpen,
  onToggleRight,
}: {
  api: Api;
  theme: ApiTheme | undefined;
  query: string;
  hits: NodeHit[];
  onQuery: (query: string) => void;
  onPick: (hit: NodeHit) => void;
  rightOpen: boolean;
  onToggleRight: () => void;
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

      <SearchBox api={api} query={query} hits={hits} onQuery={onQuery} onPick={onPick} />

      <div className="topbar-right">
        <button
          type="button"
          className={rightOpen ? "icon-button active" : "icon-button"}
          onClick={onToggleRight}
          aria-pressed={rightOpen}
          title={rightOpen ? "Ẩn panel bên phải" : "Hiện panel bên phải"}
        >
          <PanelRight size={18} />
        </button>
      </div>
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
 * đổi tới đó. Kết quả có hai nhóm: file và trang (tìm ngay trong dữ liệu của
 * đồ thị), rồi khoá dịch và setting (hỏi server, vì chúng không được vẽ).
 *
 * Chọn bằng chuột, hoặc bằng phím mũi tên rồi Enter; Enter ngay thì lấy kết
 * quả đầu tiên; Escape xoá từ khoá. Phím "/" đưa con trỏ vào ô từ bất cứ đâu.
 */
function SearchBox({
  api,
  query,
  hits,
  onQuery,
  onPick,
}: {
  api: Api;
  query: string;
  hits: NodeHit[];
  onQuery: (query: string) => void;
  onPick: (hit: NodeHit) => void;
}) {
  const { themeId, go } = useNavigator();
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);

  // Khoá dịch và setting: hỏi server sau khi người dùng ngừng gõ một nhịp.
  const settled = useDebounced(query.trim(), 250);
  const others = useLoaded(`others:${themeId}:${settled}`, () =>
    settled === "" ? Promise.resolve(null) : api.search(themeId, settled, "translation_key,setting"),
  );

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

  const shown = hits.slice(0, MAX_HITS_SHOWN);
  const otherHits = others.state === "ready" && others.data !== null && settled === query.trim() ? others.data.hits : [];
  const rows: Row[] = [
    ...shown.map((hit) => ({ id: hit.id, kind: hit.kind, label: hit.label, hit })),
    ...otherHits.slice(0, MAX_OTHER_SHOWN).map((hit) => ({ id: hit.id, kind: hit.kind, label: displayName(hit.id), hit: null })),
  ];
  const current = Math.min(active, Math.max(rows.length - 1, 0));

  const pick = (row: Row): void => {
    if (row.hit !== null) onPick(row.hit);
    else {
      // Khoá dịch và setting không có trên đồ thị: chỉ mở tab chi tiết của chúng.
      go({ node: row.id, tab: "detail" });
      onQuery("");
    }
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
            <p className="muted">{others.state === "loading" ? "Đang tìm…" : "Không có gì khớp."}</p>
          ) : (
            <ul>
              {rows.map((row, index) => (
                <li key={row.id}>
                  {/* Dòng đầu của nhóm thứ hai mang tiêu đề nhóm. */}
                  {row.hit === null && (index === 0 || rows[index - 1]?.hit !== null) && <p className="eyebrow">Khoá dịch và setting</p>}
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
              {hits.length > shown.length && `; gõ thêm để thu hẹp (đang hiện ${shown.length})`}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
