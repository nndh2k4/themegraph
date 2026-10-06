import type { ContextLink, FlowNode, RenderFlowResult } from "@themegraph/core";
import { AlertTriangle, Target, X } from "lucide-react";

import type { Api, OverviewResponse } from "../api.js";
import { deepestFile, defaultPage, flowStats, opensByDefault } from "../flow-model.js";
import { displayName, edgeLabel, kindLabel, linesText, sortedCounts } from "../labels.js";
import type { PanelTab } from "../route.js";
import { Conditional, Failure, Kind, NodeLink, Section, useLoaded, useNavigator } from "../ui.js";
import type { Loaded } from "../ui.js";

/** Số file gọi trực tiếp được nêu sau chữ "qua" ở mỗi trang. */
const MAX_VIA_SHOWN = 3;

/** Số file đã đổi được nêu tên trong cảnh báo đồ thị cũ. */
const MAX_CHANGED_SHOWN = 6;

const TABS: { id: PanelTab; label: string }[] = [
  { id: "overview", label: "Tổng quan" },
  { id: "detail", label: "Chi tiết" },
  { id: "flow", label: "Luồng trang" },
];

/**
 * Panel bên phải, ba tab: tổng quan của theme, chi tiết của node đang chọn,
 * và luồng render của từng trang.
 */
export function RightPanel({
  api,
  tab,
  node,
  depth,
  page,
  overview,
  flow,
  onClose,
}: {
  api: Api;
  tab: PanelTab;
  node: string;
  depth: number;
  page: string;
  overview: Loaded<OverviewResponse>;
  // Luồng của trang đang xem; null khi chưa chọn trang nào.
  flow: Loaded<RenderFlowResult | null>;
  onClose: () => void;
}) {
  const { go } = useNavigator();

  return (
    <aside className="right">
      <div className="panel-tabs">
        <div role="tablist">
          {TABS.map((entry) => (
            <button
              type="button"
              key={entry.id}
              role="tab"
              aria-selected={tab === entry.id}
              className={tab === entry.id ? "active" : ""}
              data-tab={entry.id}
              onClick={() => go({ tab: entry.id })}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <button type="button" className="icon-button small" onClick={onClose} title="Ẩn panel">
          <X size={15} />
        </button>
      </div>

      <div className="panel-scroll pad">
        {tab === "overview" && <OverviewTab api={api} overview={overview} />}
        {tab === "detail" && <DetailTab api={api} node={node} depth={depth} />}
        {tab === "flow" && <FlowTab page={page} overview={overview} flow={flow} />}
      </div>
    </aside>
  );
}

// ---- Tổng quan ----------------------------------------------------------------

function OverviewTab({ api, overview: loaded }: { api: Api; overview: Loaded<OverviewResponse> }) {
  const { themeId } = useNavigator();
  const dead = useLoaded(`dead:${themeId}`, () => api.deadCode(themeId));

  if (loaded.state === "loading") return <p className="muted">Đang tải…</p>;
  if (loaded.state === "failed") return <Failure error={loaded.error} />;

  const { overview, status } = loaded.data;
  const changed = [...status.modified, ...status.added, ...status.removed];

  return (
    <>
      <p className="muted note path">{overview.themeRoot}</p>

      {status.stale && (
        <div className="warning" role="status">
          <AlertTriangle size={14} /> <strong>Đồ thị đã cũ.</strong> {changed.length} file đã đổi từ lần phân tích:{" "}
          {changed.slice(0, MAX_CHANGED_SHOWN).join(", ")}
          {changed.length > MAX_CHANGED_SHOWN && ` và ${changed.length - MAX_CHANGED_SHOWN} file khác`}. Chạy <code>themegraph analyze</code> trong thư
          mục theme rồi tải lại trang.
        </div>
      )}

      <div className="stats">
        <Stat value={overview.nodes} label="node" />
        <Stat value={overview.edges} label="cạnh" />
        <Stat value={overview.pages.length} label="loại trang" />
        <Stat value={overview.brokenRefs} label="tham chiếu hỏng" alert={overview.brokenRefs > 0} />
        <Stat value={overview.unused.certain} label="file chắc chắn không dùng" alert={overview.unused.certain > 0} />
        <Stat value={overview.unused.review} label="file cần xem lại" />
        {overview.unused.notLoaded > 0 && <Stat value={overview.unused.notLoaded} label="file JS dùng mà không nạp" alert />}
      </div>

      <Section title="Được nhiều nơi gọi nhất" count={overview.mostUsed.length} empty="Không file nào gọi file nào.">
        <table>
          <tbody>
            {overview.mostUsed.map((entry) => (
              <tr key={entry.id}>
                <td className="number">{entry.usedBy}</td>
                <td>
                  <NodeLink id={entry.id} />
                </td>
                <td className="narrow">
                  <Kind kind={entry.kind} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {dead.state === "failed" && <Failure error={dead.error} />}
      {dead.state === "ready" && (
        <>
          {dead.data.notLoaded.length > 0 && (
            <Section title="Có nơi dùng thẻ nhưng không trang nào nạp file" count={dead.data.notLoaded.length}>
              <p className="hint">
                File định nghĩa một custom element mà theme đang viết ra, nhưng không thẻ &lt;script&gt; nào nạp nó. Cách chữa là nạp file, không phải
                xoá.
              </p>
              <ul className="plain">
                {dead.data.notLoaded.flatMap((asset) =>
                  asset.elements.map((element) => (
                    <li key={`${asset.id} ${element.name}`}>
                      <NodeLink id={asset.id} /> định nghĩa <code>&lt;{element.name}&gt;</code>, được viết ở{" "}
                      {element.usedBy.map((id, index) => (
                        <span key={id}>
                          {index > 0 && ", "}
                          <NodeLink id={id} />
                        </span>
                      ))}
                    </li>
                  )),
                )}
              </ul>
            </Section>
          )}

          <DeadFiles
            title="Không trang nào dùng: chắc chắn"
            hint="Đồ thị không thấy cách dùng nào. Vẫn nên tìm tên file một lượt trước khi xoá."
            files={dead.data.files.filter((entry) => entry.confidence === "certain")}
          />
          <DeadFiles
            title="Không trang nào dùng: cần xem lại"
            hint="Section có thể được JavaScript tải bằng tên là biến; asset có thể được gọi bằng tên ghép lúc chạy."
            files={dead.data.files.filter((entry) => entry.confidence === "review")}
          />
        </>
      )}

      <Section title="Node theo loại" count={overview.nodes}>
        <table>
          <tbody>
            {sortedCounts(overview.nodesByKind).map(([kind, count]) => (
              <tr key={kind}>
                <td className="number">{count}</td>
                <td>{kindLabel(kind)}</td>
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
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">
          Không thấy dùng: {overview.unused.translationKeys} khoá dịch, {overview.unused.settings} setting.
        </p>
      </Section>
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

/** Một nhóm file không dùng, gập lại sẵn vì danh sách thường dài. */
function DeadFiles({ title, hint, files }: { title: string; hint: string; files: { id: string; usedBy: string[] }[] }) {
  return (
    <Section title={title} count={files.length} empty="Không có file nào ở mức này.">
      <p className="hint">{hint}</p>
      <details>
        <summary>Hiện {files.length} file</summary>
        <ul className="plain">
          {files.map((entry) => (
            <li key={entry.id}>
              <NodeLink id={entry.id} />
              {entry.usedBy.length > 0 && <div className="muted note">chỉ được gọi bởi {entry.usedBy.join(", ")}</div>}
            </li>
          ))}
        </ul>
      </details>
    </Section>
  );
}

// ---- Chi tiết -----------------------------------------------------------------

/**
 * Chi tiết của node đang chọn: sửa nó thì trang nào bị ảnh hưởng, ai gọi nó,
 * nó gọi ai. Dùng cho mọi loại node, kể cả khoá dịch và setting (những thứ
 * không được vẽ trên đồ thị).
 */
function DetailTab({ api, node: id, depth }: { api: Api; node: string; depth: number }) {
  const { themeId, go, href } = useNavigator();
  const loaded = useLoaded(`file:${themeId}:${id}`, () => (id === "" ? Promise.resolve(null) : api.file(themeId, id)));

  if (id === "") {
    return <p className="muted empty">Chọn một node trên đồ thị, trong cây file, hoặc bằng ô tìm kiếm để xem chi tiết của nó.</p>;
  }
  if (loaded.state === "loading") return <p className="muted">Đang tải…</p>;
  if (loaded.state === "failed") return <Failure error={loaded.error} />;
  if (loaded.data === null) return null;

  const { context, impact } = loaded.data;
  const { node } = context;

  // Trang render file ngay khi tải đứng trước; trang chỉ dính qua một section
  // do JavaScript tải đứng sau. sort() giữ thứ tự cũ trong mỗi nhóm.
  const pages = [...impact.pages].sort((a, b) => Number(a.scriptOnly) - Number(b.scriptOnly));
  const files = impact.affected.filter((entry) => entry.kind !== "page_type");
  const offPage = new Set(impact.offPage);

  return (
    <>
      <h2 className="detail-title">{displayName(node.id)}</h2>
      <p className="detail-meta">
        <Kind kind={node.kind} />
        {node.kind === "page_type" && (
          <a className="node" href={href({ tab: "flow", page: displayName(node.id) })}>
            xem luồng của trang này
          </a>
        )}
      </p>

      <button type="button" className={depth > 0 ? "chip-button active" : "chip-button"} aria-pressed={depth > 0} onClick={() => go({ depth: depth > 0 ? 0 : 1 })}>
        <Target size={13} /> Chỉ hiện lân cận của node này
      </button>

      {node.kind !== "page_type" && (
        <Section title={`Trang bị ảnh hưởng khi sửa (trên ${impact.totalPages})`} count={pages.length} empty="Theo đồ thị, không trang nào dùng tới.">
          <ul className="plain">
            {pages.map((page) => (
              <li key={page.id}>
                <NodeLink id={page.id} /> <span className="muted note">cách {page.depth} tầng</span>{" "}
                {page.scriptOnly ? (
                  <span className="tag" title="Chỉ lên trang này khi JavaScript tải riêng một section">
                    qua JavaScript
                  </span>
                ) : (
                  !page.certain && <Conditional />
                )}
                {page.via.length > 0 && (
                  <div className="muted note">
                    qua{" "}
                    {page.via.slice(0, MAX_VIA_SHOWN).map((via, index) => (
                      <span key={via}>
                        {index > 0 && ", "}
                        <NodeLink id={via} />
                      </span>
                    ))}
                    {page.via.length > MAX_VIA_SHOWN && ` và ${page.via.length - MAX_VIA_SHOWN} file khác`}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Được gọi bởi" count={context.usedBy.length} empty="Không file nào gọi trực tiếp.">
        <Links links={context.usedBy} linesOf="other" />
      </Section>

      <Section title="Gọi tới" count={context.uses.length} empty="Không gọi file nào.">
        <Links links={context.uses} linesOf="self" />
      </Section>

      {context.translations.length > 0 && (
        <Section title="Khoá dịch" count={context.translations.length}>
          <Links links={context.translations} linesOf="self" plain />
        </Section>
      )}

      {context.settings.length > 0 && (
        <Section title="Setting được đọc" count={context.settings.length}>
          <Links links={context.settings} linesOf="self" plain />
        </Section>
      )}

      {context.broken.length > 0 && (
        <Section title="Tham chiếu hỏng" count={context.broken.length}>
          <ul className="plain">
            {context.broken.map((entry, index) => (
              <li key={index}>
                <span className="muted note">{entry.line > 0 ? `dòng ${entry.line}` : "(JSON)"}</span> {entry.kind} <code>{entry.expected}</code> không
                có trong theme
              </li>
            ))}
          </ul>
        </Section>
      )}

      {files.length > 0 && (
        <Section title="Mọi file bị ảnh hưởng, gần nhất trước" count={files.length}>
          <details>
            <summary>Hiện {files.length} file</summary>
            <ul className="plain">
              {files.map((entry) => (
                <li key={entry.id}>
                  <span className="number">{entry.depth}</span> <NodeLink id={entry.id} /> {!entry.certain && <Conditional />}{" "}
                  {offPage.has(entry.id) && (
                    <span
                      className="tag"
                      title="Theo đồ thị, file này không nằm trên trang nào; nó vẫn có thể được thêm từ theme editor hoặc được JavaScript tải"
                    >
                      không trang nào dùng
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </Section>
      )}
    </>
  );
}

/**
 * Danh sách các quan hệ trực tiếp. `linesOf` cho biết số dòng thuộc file nào:
 * "other" là dòng trong file ở đầu bên kia (file gọi), "self" là dòng trong
 * chính file đang xem.
 */
function Links({ links, linesOf, plain = false }: { links: readonly ContextLink[]; linesOf: "self" | "other"; plain?: boolean }) {
  return (
    <ul className="plain">
      {links.map((link) => (
        <li key={`${link.id}:${link.type}`}>
          <NodeLink id={link.id} />
          {linesOf === "other" && link.lines.length > 0 && <span className="muted note">:{link.lines.join(",")}</span>}{" "}
          {link.conditional && <Conditional />}
          <div className="muted note">
            {[linesOf === "self" ? linesText(link.lines) : "", plain ? "" : edgeLabel(link.type) + (link.count > 1 ? ` ×${link.count}` : "")]
              .filter((text) => text !== "")
              .join(" · ")}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---- Luồng trang ----------------------------------------------------------------

/**
 * Luồng render của từng loại trang. Chọn một trang thì mọi file trang đó kéo
 * theo sáng lên trên đồ thị, và cây lồng nhau của chúng hiện ở dưới.
 */
function FlowTab({ page, overview, flow }: { page: string; overview: Loaded<OverviewResponse>; flow: Loaded<RenderFlowResult | null> }) {
  const { href } = useNavigator();

  if (overview.state === "loading") return <p className="muted">Đang tải…</p>;
  if (overview.state === "failed") return <Failure error={overview.error} />;

  const pages = overview.data.overview.pages;
  if (defaultPage(pages) === null) return <p className="muted empty">Theme không có template nào, nên không có trang nào để xem.</p>;

  return (
    <>
      <p className="hint">Chọn một loại trang để làm nổi mọi file nó kéo theo trên đồ thị.</p>
      <ul className="pages">
        {pages.map((name) => (
          <li key={name}>
            <a
              // Bấm lại trang đang chọn thì bỏ chọn.
              href={href({ page: name === page ? "" : name })}
              className={name === page ? "page current" : "page"}
              aria-current={name === page ? "page" : undefined}
            >
              {name}
            </a>
          </li>
        ))}
      </ul>

      {page !== "" && flow.state === "loading" && <p className="muted">Đang tải luồng của trang {page}…</p>}
      {page !== "" && flow.state === "failed" && <Failure error={flow.error} />}
      {page !== "" && flow.state === "ready" && flow.data !== null && <FlowTree page={page} result={flow.data} />}
    </>
  );
}

function FlowTree({ page, result }: { page: string; result: RenderFlowResult }) {
  const stats = flowStats(result.tree);

  return (
    <Section title={`Luồng của trang ${page}`} count={result.files.length}>
      <p className="hint">
        Kéo theo {result.files.length} file, sâu nhất {deepestFile(result.files)} tầng. Cây có {stats.rows} dòng
        {stats.repeated > 0 && `, trong đó ${stats.repeated} dòng là file đã liệt kê ở chỗ khác (không mở lại)`}.
      </p>
      <ul className="flow-tree">
        <FlowRow node={result.tree} />
      </ul>
    </Section>
  );
}

/** Một dòng của cây, kèm các con của nó. Dùng <details> của trình duyệt để gập mở. */
function FlowRow({ node }: { node: FlowNode }) {
  const line = (
    <span className="flow-line">
      <NodeLink id={node.id} />
      {node.edge !== null && node.edge !== "RENDERS" && <span className="muted note"> {edgeLabel(node.edge)}</span>}
      {node.count > 1 && <span className="muted note"> ×{node.count}</span>}
      {node.conditional && (
        <>
          {" "}
          <Conditional />
        </>
      )}
      {node.repeated && <span className="muted note"> đã liệt kê ở chỗ khác</span>}
      {node.children.length > 0 && <span className="count"> {node.children.length}</span>}
    </span>
  );

  if (node.children.length === 0) return <li className="flow-leaf">{line}</li>;

  return (
    <li>
      <details open={opensByDefault(node)}>
        <summary>{line}</summary>
        <ul>
          {node.children.map((child, index) => (
            // Cùng một file có thể là con của một node hai lần (hai loại cạnh), nên thêm vị trí vào key.
            <FlowRow key={`${child.id} ${index}`} node={child} />
          ))}
        </ul>
      </details>
    </li>
  );
}
