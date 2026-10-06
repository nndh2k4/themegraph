import type { NodeKind } from "@themegraph/core";
import { useEffect, useMemo, useRef, useState } from "react";
import Sigma from "sigma";
import { createEdgeArrowProgram } from "sigma/rendering";

import type { Api } from "../api.js";
import { createDashedArrowProgram } from "../dashed-edge.js";
import { layoutGraph } from "../graph-layout.js";
import type { EdgeAttributes, LaidOutGraph, NodeAttributes } from "../graph-layout.js";
import { drawGraph, DRAWN_KINDS, formatKinds, kindColor, parseKinds, searchNodes, toggleKind } from "../graph-model.js";
import type { DrawGraph, NodeHit } from "../graph-model.js";
import { displayName, kindLabel } from "../labels.js";
import { formatRoute } from "../route.js";
import { Conditional, Failure, Kind, NodeLink, useLoaded } from "../ui.js";

/** Số quan hệ trực tiếp liệt kê trong panel trước khi rút gọn. */
const MAX_LINKS_SHOWN = 12;

/** Số kết quả hiện dưới ô tìm kiếm. */
const MAX_HITS_SHOWN = 8;

/** Yêu cầu đưa một node vào giữa vùng vẽ. `n` tăng mỗi lần, để yêu cầu lặp lại cùng một node vẫn chạy. */
interface FlyTo {
  id: string;
  n: number;
}

/**
 * Màn đồ thị: mọi file của theme và quan hệ giữa chúng, vẽ bằng Sigma.
 *
 * Trạng thái của màn (loại node đang hiện, node đang chọn, có thu về lân cận
 * hay không) nằm hết trong địa chỉ. Mọi thao tác chỉ đổi địa chỉ; màn hình
 * vẽ lại theo địa chỉ. Nhờ vậy nút Back đưa về đúng trạng thái trước, và một
 * đường dẫn chép cho người khác mở ra đúng cái đang xem.
 */
export function GraphView({
  api,
  themeId,
  kinds: kindsText,
  node,
  near,
}: {
  api: Api;
  themeId: string;
  kinds: string;
  node: string;
  near: boolean;
}) {
  const loaded = useLoaded(`graph:${themeId}`, () => api.graph(themeId));
  const kinds = useMemo(() => parseKinds(kindsText), [kindsText]);

  // Phần sẽ vẽ, và vị trí của từng node. Chỉ tính lại khi dữ liệu hoặc bộ lọc
  // đổi; chọn một node khác (không ở chế độ lân cận) thì hình giữ nguyên.
  const center = near ? node : "";
  const exported = loaded.state === "ready" ? loaded.data : null;
  const draw = useMemo(
    () => (exported === null ? null : drawGraph(exported, { kinds, ...(center === "" ? {} : { center }) })),
    [exported, kinds, center],
  );
  const graph = useMemo(() => (draw === null ? null : layoutGraph(draw)), [draw]);

  // Từ khoá đang gõ trong ô tìm kiếm. Không nằm trong địa chỉ: nó chỉ là bước
  // trung gian để chọn một node, và node được chọn thì đã nằm trong địa chỉ.
  const [query, setQuery] = useState("");
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);
  const hits = useMemo(() => (exported === null ? [] : searchNodes(exported.nodes, query)), [exported, query]);
  const matches = useMemo(() => (query.trim() === "" ? null : new Set(hits.map((hit) => hit.id))), [hits, query]);

  if (loaded.state === "loading") return <p className="muted">Đang tải đồ thị…</p>;
  if (loaded.state === "failed") return <Failure error={loaded.error} themeId={themeId} />;
  if (draw === null || graph === null || exported === null) return null;

  const go = (next: { kinds?: readonly NodeKind[]; node?: string; near?: boolean }): void => {
    window.location.hash = formatRoute({
      name: "graph",
      themeId,
      kinds: formatKinds(next.kinds ?? kinds),
      node: next.node ?? node,
      near: next.near ?? near,
    });
  };

  // Chọn một kết quả tìm kiếm: chọn node đó, bật loại của nó nếu đang tắt,
  // và đưa nó vào giữa vùng vẽ.
  const pick = (hit: NodeHit): void => {
    go({ node: hit.id, kinds: kinds.includes(hit.kind) ? kinds : toggleKind(kinds, hit.kind) });
    setFlyTo((previous) => ({ id: hit.id, n: (previous?.n ?? 0) + 1 }));
    setQuery("");
  };

  const countOf = (kind: NodeKind): number => exported.nodes.filter((entry) => entry.kind === kind).length;
  const selected = node !== "" && graph.hasNode(node) ? node : null;

  return (
    <div className="graph-screen">
      <div className="graph-toolbar panel">
        <GraphSearch query={query} hits={hits} onQuery={setQuery} onPick={pick} />
        <div className="graph-kinds">
          {DRAWN_KINDS.filter((kind) => countOf(kind) > 0).map((kind) => (
            <label key={kind} className="graph-kind">
              <input type="checkbox" checked={kinds.includes(kind)} onChange={() => go({ kinds: toggleKind(kinds, kind) })} />
              <span className="swatch" style={{ background: kindColor(kind) }} />
              {kindLabel(kind)} <span className="count">{countOf(kind)}</span>
            </label>
          ))}
        </div>
        <div className="graph-legend muted">
          <span className="line solid" /> luôn xảy ra
          <span className="line dashed" /> có điều kiện
          <span>
            · {draw.nodes.length} node, {draw.edges.length} cạnh
            {draw.center !== null && ` (lân cận của ${displayName(draw.center)}, trên ${draw.available} node)`}
          </span>
        </div>
      </div>

      <div className="graph-body">
        {draw.nodes.length === 0 ? (
          <p className="muted graph-empty">Không có node nào thuộc các loại đang chọn.</p>
        ) : (
          <Canvas
            graph={graph}
            selected={selected}
            matches={matches}
            flyTo={flyTo}
            onSelect={(id) => go({ node: id, near: id === "" ? false : near })}
          />
        )}
        {node !== "" && (
          <NodePanel
            api={api}
            themeId={themeId}
            kinds={kinds}
            id={node}
            draw={draw}
            near={near}
            onNear={(value) => go({ near: value })}
            onClose={() => go({ node: "", near: false })}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Ô tìm node theo tên. Gõ tới đâu, danh sách bên dưới và các node khớp trên
 * hình đổi tới đó. Chọn bằng chuột, hoặc bằng phím mũi tên rồi Enter; Enter
 * ngay thì lấy kết quả đầu tiên; Escape xoá từ khoá.
 */
function GraphSearch({
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
  // Kết quả đang được tô đậm khi dùng phím mũi tên.
  const [active, setActive] = useState(0);
  const shown = hits.slice(0, MAX_HITS_SHOWN);
  const current = Math.min(active, Math.max(shown.length - 1, 0));

  return (
    <div className="graph-search">
      <input
        type="search"
        value={query}
        placeholder="Tìm section, block, snippet, layout…"
        aria-label="Tìm node trên đồ thị"
        onChange={(event) => {
          onQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (shown.length > 0) setActive((current + (event.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length);
          } else if (event.key === "Enter") {
            const hit = shown[current];
            if (hit !== undefined) onPick(hit);
          } else if (event.key === "Escape") {
            onQuery("");
          }
        }}
      />
      {query.trim() !== "" && (
        <div className="graph-hits panel">
          {hits.length === 0 ? (
            <p className="muted">Không có file nào khớp.</p>
          ) : (
            <>
              <ul>
                {shown.map((hit, index) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      className={index === current ? "graph-hit active" : "graph-hit"}
                      // mousedown chứ không phải click: click tới sau khi ô nhập mất tiêu điểm.
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onPick(hit);
                      }}
                    >
                      <span className="swatch" style={{ background: kindColor(hit.kind) }} />
                      <span className="node">{hit.label}</span>
                      <span className="muted note">{kindLabel(hit.kind)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="muted note">
                {hits.length} file khớp, đang được làm nổi trên hình
                {hits.length > shown.length && `; gõ thêm để thu hẹp (đang hiện ${shown.length})`}.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Đọc một màu khai trong styles.css, để hình vẽ đi theo chế độ sáng / tối của trang. */
function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

/**
 * Vùng vẽ. Sigma được tạo lại mỗi khi đồ thị đổi (đổi bộ lọc, đổi tâm). Đổi
 * node đang chọn hay rê chuột thì KHÔNG tạo lại: chỉ đổi cách tô rồi vẽ lại,
 * để hình không giật và người xem không mất chỗ đang phóng to.
 */
function Canvas({
  graph,
  selected,
  matches,
  flyTo,
  onSelect,
}: {
  graph: LaidOutGraph;
  selected: string | null;
  // Các node khớp từ khoá đang gõ; null khi ô tìm kiếm trống.
  matches: ReadonlySet<string> | null;
  flyTo: FlyTo | null;
  onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<Sigma<NodeAttributes, EdgeAttributes> | null>(null);
  // Giữ trong ref chứ không trong state: các hàm tô của Sigma đọc giá trị mới
  // nhất mà không cần React vẽ lại component.
  const active = useRef<{ selected: string | null; hovered: string | null; matches: ReadonlySet<string> | null }>({
    selected,
    hovered: null,
    matches,
  });
  // Yêu cầu flyTo cuối cùng đã thực hiện, để vẽ lại không làm camera bay lần nữa.
  const flown = useRef(0);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    if (container.current === null) return;

    const edgeColor = cssColor("--edge", "#9aa4b2");
    const fadedColor = cssColor("--line", "#dde1e7");
    const textColor = cssColor("--text", "#1c2330");

    const sigma = new Sigma<NodeAttributes, EdgeAttributes>(graph, container.current, {
      defaultEdgeType: "arrow",
      edgeProgramClasses: {
        arrow: createEdgeArrowProgram<NodeAttributes, EdgeAttributes>(),
        dashed: createDashedArrowProgram<NodeAttributes, EdgeAttributes>(),
      },
      labelColor: { color: textColor },
      labelSize: 12,
      // Chỉ in tên của node đủ to trên màn hình; phóng to thì tên hiện dần ra.
      labelRenderedSizeThreshold: 6,
      labelDensity: 1,
      minCameraRatio: 0.05,
      maxCameraRatio: 4,
      zIndex: true,

      nodeReducer: (id, data) => {
        const found = active.current.matches;

        // Đang gõ tìm kiếm (và không rê chuột lên node nào): làm nổi các node
        // khớp, kèm tên; phần còn lại mờ đi.
        if (found !== null && active.current.hovered === null) {
          return found.has(id) ? { ...data, forceLabel: true, zIndex: 1 } : { ...data, color: fadedColor, label: "", zIndex: 0 };
        }

        const focus = active.current.hovered ?? active.current.selected;
        if (focus === null || !graph.hasNode(focus)) return data;

        if (id === focus) return { ...data, highlighted: true, forceLabel: true, zIndex: 2 };
        if (graph.areNeighbors(id, focus)) return { ...data, forceLabel: true, zIndex: 1 };
        // Node không liên quan: mờ đi và bỏ tên, để phần liên quan nổi lên.
        return { ...data, color: fadedColor, label: "", zIndex: 0 };
      },

      edgeReducer: (edge, data) => {
        const base = { ...data, type: data.conditional ? "dashed" : "arrow", color: edgeColor, size: 1.5 };
        // Đang tìm kiếm: ẩn cạnh, để nhìn ra các node khớp nằm ở đâu.
        if (active.current.matches !== null && active.current.hovered === null) return { ...base, hidden: true };

        const focus = active.current.hovered ?? active.current.selected;
        if (focus === null || !graph.hasNode(focus)) return base;

        return graph.hasExtremity(edge, focus) ? { ...base, color: textColor, size: 2, zIndex: 1 } : { ...base, hidden: true };
      },
    });

    sigma.on("clickNode", ({ node }) => select.current(node));
    sigma.on("clickStage", () => select.current(""));
    sigma.on("enterNode", ({ node }) => {
      active.current.hovered = node;
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("leaveNode", () => {
      active.current.hovered = null;
      sigma.refresh({ skipIndexation: true });
    });

    renderer.current = sigma;
    return () => {
      renderer.current = null;
      sigma.kill();
    };
  }, [graph]);

  useEffect(() => {
    active.current.selected = selected;
    active.current.matches = matches;
    renderer.current?.refresh({ skipIndexation: true });
  }, [selected, matches, graph]);

  // Đưa node vừa chọn từ ô tìm kiếm vào giữa vùng vẽ. Chạy sau effect tạo
  // Sigma, và chạy lại khi đồ thị đổi: chọn một node thuộc loại đang tắt thì
  // loại đó được bật, đồ thị dựng lại, rồi mới có node để bay tới.
  useEffect(() => {
    const sigma = renderer.current;
    if (sigma === null || flyTo === null || flyTo.n === flown.current || !graph.hasNode(flyTo.id)) return;

    flown.current = flyTo.n;
    const position = sigma.getNodeDisplayData(flyTo.id);
    if (position === undefined) return;

    // Chỉ phóng to thêm, không bao giờ thu nhỏ lại so với mức đang xem.
    const ratio = Math.min(sigma.getCamera().ratio, 0.5);
    void sigma.getCamera().animate({ x: position.x, y: position.y, ratio }, { duration: 400 });
  }, [flyTo, graph]);

  return (
    <div className="graph-canvas">
      <div ref={container} className="graph-stage" role="img" aria-label="Đồ thị quan hệ giữa các file của theme" />
      <div className="graph-zoom">
        <button type="button" onClick={() => void renderer.current?.getCamera().animatedZoom({ duration: 200 })} aria-label="Phóng to">
          +
        </button>
        <button type="button" onClick={() => void renderer.current?.getCamera().animatedUnzoom({ duration: 200 })} aria-label="Thu nhỏ">
          −
        </button>
        <button type="button" onClick={() => void renderer.current?.getCamera().animatedReset({ duration: 200 })}>
          Vừa khung
        </button>
      </div>
    </div>
  );
}

/**
 * Panel của node đang chọn. Phần quan hệ trực tiếp lấy ngay từ đồ thị đang
 * vẽ (nên khớp với hình); phần "trang bị ảnh hưởng" hỏi route /file, vì nó
 * cần đi qua nhiều tầng và qua cả những loại node đang bị ẩn.
 */
function NodePanel({
  api,
  themeId,
  kinds,
  id,
  draw,
  near,
  onNear,
  onClose,
}: {
  api: Api;
  themeId: string;
  kinds: readonly NodeKind[];
  id: string;
  draw: DrawGraph;
  near: boolean;
  onNear: (value: boolean) => void;
  onClose: () => void;
}) {
  const loaded = useLoaded(`file:${themeId}:${id}`, () => api.file(themeId, id));
  const shown = draw.nodes.find((entry) => entry.id === id);

  const callers = draw.edges.filter((edge) => edge.to === id);
  const callees = draw.edges.filter((edge) => edge.from === id);

  const links = (title: string, edges: typeof callers, other: (edge: (typeof callers)[number]) => string) => (
    <>
      <h3>
        {title} <span className="count">{edges.length}</span>
      </h3>
      {edges.length === 0 ? (
        <p className="muted">Không có trong phần đang hiện.</p>
      ) : (
        <ul className="graph-links">
          {edges.slice(0, MAX_LINKS_SHOWN).map((edge) => (
            <li key={edge.key}>
              <a
                className="node"
                href={formatRoute({ name: "graph", themeId, kinds: formatKinds(kinds), node: other(edge), near })}
              >
                {displayName(other(edge))}
              </a>{" "}
              {edge.conditional && <Conditional />}
            </li>
          ))}
          {edges.length > MAX_LINKS_SHOWN && <li className="muted">… và {edges.length - MAX_LINKS_SHOWN} file nữa</li>}
        </ul>
      )}
    </>
  );

  return (
    <aside className="graph-panel panel">
      <button type="button" className="graph-panel-close" onClick={onClose} aria-label="Đóng panel">
        ×
      </button>
      <h2 className="graph-panel-title">{displayName(id)}</h2>
      <p>
        {shown !== undefined && <Kind kind={shown.kind} />} <NodeLink themeId={themeId} id={id} />
      </p>
      {shown === undefined && <p className="muted">Node này không nằm trong phần đang hiện (loại của nó đang tắt).</p>}

      <label className="graph-near">
        <input type="checkbox" checked={near} onChange={(event) => onNear(event.target.checked)} /> Chỉ hiện lân cận của node này
      </label>

      {links("Được gọi bởi", callers, (edge) => edge.from)}
      {links("Gọi tới", callees, (edge) => edge.to)}

      <h3>Trang bị ảnh hưởng khi sửa</h3>
      {loaded.state === "loading" && <p className="muted">Đang tải…</p>}
      {loaded.state === "failed" && <Failure error={loaded.error} themeId={themeId} />}
      {loaded.state === "ready" &&
        (loaded.data.context.node.kind === "page_type" ? (
          <p className="muted">Đây là một loại trang.</p>
        ) : loaded.data.impact.pages.length === 0 ? (
          <p className="muted">Theo đồ thị, không trang nào dùng tới.</p>
        ) : (
          <p>
            {loaded.data.impact.pages.length} trên {loaded.data.impact.totalPages} trang:{" "}
            {loaded.data.impact.pages.map((page, index) => (
              <span key={page.id}>
                {index > 0 && ", "}
                <NodeLink themeId={themeId} id={page.id} />
              </span>
            ))}
          </p>
        ))}
    </aside>
  );
}
