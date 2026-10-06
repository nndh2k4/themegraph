import type { Api } from "../api.js";
import { edgeLabel, formatTime, kindLabel, sortedCounts } from "../labels.js";
import { formatRoute } from "../route.js";
import { Failure, Kind, NodeLink, Section, useLoaded } from "../ui.js";

/** Số file đã đổi được nêu tên trong cảnh báo đồ thị cũ. */
const MAX_CHANGED_SHOWN = 8;

/** Màn tổng quan: theme gồm những gì, và có gì đáng để ý. */
export function Overview({ api, themeId }: { api: Api; themeId: string }) {
  const loaded = useLoaded(`overview:${themeId}`, () => api.overview(themeId));

  if (loaded.state === "loading") return <p className="muted">Đang tải…</p>;
  if (loaded.state === "failed") return <Failure error={loaded.error} />;

  const { overview, status } = loaded.data;
  const changed = [...status.modified, ...status.added, ...status.removed];

  return (
    <>
      <p className="muted">
        <code className="path">{overview.themeRoot}</code> · phân tích {formatTime(overview.meta.analyzedAt)} bằng
        ThemeGraph {overview.meta.toolVersion}
      </p>

      {status.stale && (
        <div className="warning" role="status">
          <strong>Đồ thị đã cũ.</strong> {changed.length} file đã đổi từ lần phân tích:{" "}
          {changed.slice(0, MAX_CHANGED_SHOWN).join(", ")}
          {changed.length > MAX_CHANGED_SHOWN && ` và ${changed.length - MAX_CHANGED_SHOWN} file khác`}. Chạy{" "}
          <code>themegraph analyze</code> trong thư mục theme rồi tải lại trang.
        </div>
      )}

      <div className="stats">
        <Stat value={overview.nodes} label="node" />
        <Stat value={overview.edges} label="cạnh" />
        <Stat value={overview.pages.length} label="loại trang" />
        <Stat value={overview.brokenRefs} label="tham chiếu hỏng" alert={overview.brokenRefs > 0} />
        <Stat value={overview.unused.certain} label="file chắc chắn không dùng" alert={overview.unused.certain > 0} />
        <Stat value={overview.unused.review} label="file cần xem lại" />
        {overview.unused.notLoaded > 0 && (
          <Stat value={overview.unused.notLoaded} label="file JavaScript dùng mà không nạp" alert />
        )}
      </div>

      <div className="columns">
        <Section title="Trang" count={overview.pages.length} empty="Theme không có template nào.">
          <ul className="chips">
            {overview.pages.map((page) => (
              <li key={page}>
                <a className="node" href={formatRoute({ name: "flow", themeId, page })} title={`Cây render của trang ${page}`}>
                  {page}
                </a>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="File Liquid được nhiều nơi gọi nhất"
          count={overview.mostUsed.length}
          empty="Không file nào gọi file nào."
        >
          <table>
            <tbody>
              {overview.mostUsed.map((entry) => (
                <tr key={entry.id}>
                  <td className="number">{entry.usedBy}</td>
                  <td>
                    <NodeLink themeId={themeId} id={entry.id} />
                  </td>
                  <td>
                    <Kind kind={entry.kind} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>

      <Unused api={api} themeId={themeId} total={overview.unused.certain + overview.unused.review + overview.unused.notLoaded} />

      <div className="columns">
        <Section title="Node theo loại" count={overview.nodes}>
          <table>
            <tbody>
              {sortedCounts(overview.nodesByKind).map(([kind, count]) => (
                <tr key={kind}>
                  <td className="number">{count}</td>
                  <td>
                    <a href={formatRoute({ name: "search", themeId, q: "", kind })}>{kindLabel(kind)}</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Cạnh theo loại" count={overview.edges}>
          <table>
            <tbody>
              {sortedCounts(overview.edgesByType).map(([type, count]) => (
                <tr key={type}>
                  <td className="number">{count}</td>
                  <td>{edgeLabel(type)}</td>
                  <td className="muted">{type}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Không thấy dùng: {overview.unused.translationKeys} khoá dịch, {overview.unused.settings} setting.
          </p>
        </Section>
      </div>
    </>
  );
}

/**
 * Danh sách file không trang nào dùng tới, chia theo hai mức tin cậy. Tải
 * riêng, sau phần tổng quan, vì không phải lúc nào người xem cũng cần nó.
 */
function Unused({ api, themeId, total }: { api: Api; themeId: string; total: number }) {
  const loaded = useLoaded(`dead:${themeId}`, () => api.deadCode(themeId));

  if (total === 0) return null;
  if (loaded.state === "loading") return <p className="muted">Đang tải danh sách file không dùng…</p>;
  if (loaded.state === "failed") return <Failure error={loaded.error} />;

  const certain = loaded.data.files.filter((entry) => entry.confidence === "certain");
  const review = loaded.data.files.filter((entry) => entry.confidence === "review");

  const rows = (files: typeof certain) => (
    <table>
      <tbody>
        {files.map((entry) => (
          <tr key={entry.id}>
            <td>
              <NodeLink themeId={themeId} id={entry.id} />
              {entry.usedBy.length > 0 && <div className="muted note">chỉ được gọi bởi {entry.usedBy.join(", ")}</div>}
            </td>
            <td className="narrow">
              <Kind kind={entry.kind} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      {loaded.data.notLoaded.length > 0 && (
        <Section title="Có nơi dùng thẻ nhưng không trang nào nạp file" count={loaded.data.notLoaded.length} empty="">
          <p className="muted">
            File định nghĩa một custom element mà theme đang viết ra, nhưng không thẻ &lt;script&gt; nào nạp nó: thẻ
            hiện trên trang mà JavaScript của nó không chạy. Cách chữa là nạp file, không phải xoá.
          </p>
          <table>
            <tbody>
              {loaded.data.notLoaded.flatMap((asset) =>
                asset.elements.map((element) => (
                  <tr key={`${asset.id} ${element.name}`}>
                    <td>
                      <NodeLink themeId={themeId} id={asset.id} />
                    </td>
                    <td>
                      <code>&lt;{element.name}&gt;</code> được viết ở{" "}
                      {element.usedBy.map((id, index) => (
                        <span key={id}>
                          {index > 0 && ", "}
                          <NodeLink themeId={themeId} id={id} />
                        </span>
                      ))}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </Section>
      )}
      <div className="columns">
        <Section
          title="Không trang nào dùng: chắc chắn"
          count={certain.length}
          empty="Không có file nào ở mức này."
        >
          <p className="muted">Đồ thị không thấy cách dùng nào. Vẫn nên tìm tên file một lượt trước khi xoá.</p>
          {rows(certain)}
        </Section>
        <Section title="Không trang nào dùng: cần xem lại" count={review.length} empty="Không có file nào ở mức này.">
          <p className="muted">
            Section có thể được JavaScript tải bằng tên là biến; asset có thể được gọi bằng tên ghép lúc chạy.
          </p>
          <details>
            <summary>Hiện {review.length} file</summary>
            {rows(review)}
          </details>
        </Section>
      </div>
    </>
  );
}

function Stat({ value, label, alert = false }: { value: number; label: string; alert?: boolean }) {
  return (
    <div className={alert ? "stat alert" : "stat"}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
