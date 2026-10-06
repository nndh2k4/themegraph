import { useEffect, useState } from "react";

import type { Api } from "../api.js";
import { kindLabel } from "../labels.js";
import { formatRoute } from "../route.js";
import { Failure, Kind, NodeLink, useLoaded } from "../ui.js";

/** Các loại node chọn được trong bộ lọc, theo thứ tự người dùng hay cần. */
const FILTER_KINDS = [
  "page_type",
  "template",
  "layout",
  "section",
  "section_group",
  "block",
  "snippet",
  "asset",
  "translation_key",
  "setting",
];

/** Màn tìm kiếm: tìm file, trang, khoá dịch, setting theo tên. */
export function Search({ api, themeId, q, kind }: { api: Api; themeId: string; q: string; kind: string }) {
  // Ô nhập giữ chữ đang gõ; địa chỉ chỉ đổi khi người dùng gửi form, để mỗi
  // lần tìm là một mục trong lịch sử trình duyệt chứ không phải mỗi phím gõ.
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);

  const results = useLoaded(`search:${themeId}:${kind}:${q}`, () => api.search(themeId, q, kind));

  const go = (nextQ: string, nextKind: string): void => {
    window.location.hash = formatRoute({ name: "search", themeId, q: nextQ, kind: nextKind });
  };

  return (
    <>
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          go(text.trim(), kind);
        }}
      >
        <input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Tên file, trang, khoá dịch, setting…"
          aria-label="Từ khoá"
          autoFocus
        />
        <select value={kind} onChange={(event) => go(text.trim(), event.target.value)} aria-label="Loại">
          <option value="">mọi loại</option>
          {FILTER_KINDS.map((option) => (
            <option key={option} value={option}>
              {kindLabel(option)}
            </option>
          ))}
        </select>
        <button type="submit">Tìm</button>
      </form>

      {results.state === "loading" && <p className="muted">Đang tìm…</p>}
      {results.state === "failed" && <Failure error={results.error} themeId={themeId} />}
      {results.state === "ready" && (
        <section className="panel">
          <h2>
            {results.data.total === 0
              ? "Không có kết quả"
              : results.data.hits.length < results.data.total
                ? `${results.data.hits.length} trên ${results.data.total} kết quả, sát nhất trước`
                : `${results.data.total} kết quả`}
          </h2>
          <table>
            <tbody>
              {results.data.hits.map((hit) => (
                <tr key={hit.id}>
                  <td>
                    <NodeLink themeId={themeId} id={hit.id} />
                  </td>
                  <td>
                    <Kind kind={hit.kind} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
