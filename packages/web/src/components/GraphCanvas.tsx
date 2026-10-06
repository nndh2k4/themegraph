import { GitBranch, Maximize2, Network, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Sigma from "sigma";
import { createEdgeArrowProgram } from "sigma/rendering";

import { createDashedArrowProgram } from "../dashed-edge.js";
import type { EdgeAttributes, LaidOutGraph, NodeAttributes } from "../graph-layout.js";
import { dimColor } from "../graph-model.js";
import { displayName, kindLabel } from "../labels.js";
import type { GraphLayout } from "../route.js";

/** Yêu cầu đưa một node vào giữa vùng vẽ. `n` tăng mỗi lần, để yêu cầu lặp lại cùng một node vẫn chạy. */
export interface FlyTo {
  id: string;
  n: number;
}

/** Màu của vùng vẽ. Trùng với các biến trong styles.css; Sigma vẽ bằng WebGL nên không đọc được CSS. */
const COLORS = {
  edge: "#3d3d58",
  edgeActive: "#a78bfa",
  label: "#e4e4ed",
  background: "#06060a",
};

/** Những gì đang được làm nổi trên hình. Giữ trong một ref để các hàm tô của Sigma đọc giá trị mới nhất. */
interface Emphasis {
  hovered: string | null;
  selected: string | null;
  // Các node khớp từ khoá đang gõ ở ô tìm kiếm; null khi ô trống.
  matches: ReadonlySet<string> | null;
  // Các node thuộc luồng của trang đang xem; null khi không xem trang nào.
  flow: ReadonlySet<string> | null;
}

/**
 * Vùng vẽ của đồ thị.
 *
 * Sigma được tạo lại mỗi khi đồ thị đổi (đổi bộ lọc, đổi bố cục, đổi tâm). Đổi
 * node đang chọn, gõ tìm kiếm hay rê chuột thì KHÔNG tạo lại: chỉ đổi cách tô
 * rồi vẽ lại, để hình không giật và người xem không mất chỗ đang phóng to.
 *
 * Thứ tự ưu tiên khi nhiều thứ cùng đòi được làm nổi: node đang rê chuột, rồi
 * kết quả tìm kiếm, rồi luồng của trang, rồi node đang chọn.
 */
export function GraphCanvas({
  graph,
  layout,
  selected,
  matches,
  flow,
  flyTo,
  onSelect,
  onLayout,
}: {
  graph: LaidOutGraph;
  layout: GraphLayout;
  selected: string | null;
  matches: ReadonlySet<string> | null;
  flow: ReadonlySet<string> | null;
  flyTo: FlyTo | null;
  onSelect: (id: string) => void;
  onLayout: (layout: GraphLayout) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<Sigma<NodeAttributes, EdgeAttributes> | null>(null);
  const emphasis = useRef<Emphasis>({ hovered: null, selected, matches, flow });
  // Yêu cầu flyTo cuối cùng đã thực hiện, để vẽ lại không làm camera bay lần nữa.
  const flown = useRef(0);
  const select = useRef(onSelect);
  select.current = onSelect;

  // Node đang rê chuột, để hiện tên đầy đủ của nó ở đầu vùng vẽ.
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    if (container.current === null) return;

    const sigma = new Sigma<NodeAttributes, EdgeAttributes>(graph, container.current, {
      defaultEdgeType: "arrow",
      edgeProgramClasses: {
        arrow: createEdgeArrowProgram<NodeAttributes, EdgeAttributes>(),
        dashed: createDashedArrowProgram<NodeAttributes, EdgeAttributes>(),
      },
      labelColor: { color: COLORS.label },
      labelFont: "ui-monospace, Consolas, monospace",
      labelSize: 11,
      // Chỉ in tên của node đủ to trên màn hình; phóng to thì tên hiện dần ra.
      labelRenderedSizeThreshold: 7,
      labelDensity: 0.8,
      // Chừa chỗ quanh đồ thị cho các nút nổi ở mép vùng vẽ.
      stagePadding: 70,
      minCameraRatio: 0.03,
      maxCameraRatio: 4,
      zIndex: true,

      // Hộp tên của node đang rê chuột: nền tối, thay cho hộp trắng mặc định của Sigma.
      defaultDrawNodeHover: (context, data, settings) => {
        if (typeof data.label !== "string" || data.label === "") return;

        const size = settings.labelSize;
        context.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
        const width = context.measureText(data.label).width + 14;
        const x = data.x + data.size + 4;

        context.fillStyle = "#16161f";
        context.strokeStyle = data.color;
        context.lineWidth = 1;
        context.beginPath();
        context.roundRect(x, data.y - size / 2 - 5, width, size + 10, 5);
        context.fill();
        context.stroke();

        context.fillStyle = COLORS.label;
        context.fillText(data.label, x + 7, data.y + size / 3);
      },

      nodeReducer: (id, data) => {
        const { hovered: hover, selected: chosen, matches: found, flow: inFlow } = emphasis.current;
        // Node không liên quan: mờ đi nhưng vẫn đoán được nó thuộc loại nào.
        const dimmed = { ...data, color: dimColor(data.color, COLORS.background, 0.22), label: "", zIndex: 0 };

        // Một tập node được làm nổi (kết quả tìm kiếm, hoặc luồng của một trang).
        const group = hover === null ? (found ?? inFlow) : null;
        if (group !== null) {
          if (!group.has(id)) return dimmed;
          return id === chosen ? { ...data, highlighted: true, forceLabel: true, zIndex: 2 } : { ...data, forceLabel: found !== null, zIndex: 1 };
        }

        // Một node được làm nổi cùng hàng xóm của nó.
        const focus = hover ?? chosen;
        if (focus === null || !graph.hasNode(focus)) return data;

        if (id === focus) return { ...data, highlighted: true, forceLabel: true, zIndex: 2 };
        if (graph.areNeighbors(id, focus)) return { ...data, forceLabel: true, zIndex: 1 };
        return dimmed;
      },

      edgeReducer: (edge, data) => {
        const { hovered: hover, selected: chosen, matches: found, flow: inFlow } = emphasis.current;
        const base = { ...data, type: data.conditional ? "dashed" : "arrow", color: COLORS.edge, size: 1.2 };

        if (hover === null) {
          // Đang tìm kiếm: ẩn cạnh, để nhìn ra các node khớp nằm ở đâu.
          if (found !== null) return { ...base, hidden: true };
          // Luồng của một trang: chỉ giữ cạnh nối hai node trong luồng.
          if (inFlow !== null) {
            const within = inFlow.has(graph.source(edge)) && inFlow.has(graph.target(edge));
            return within ? { ...base, color: COLORS.edgeActive, zIndex: 1 } : { ...base, hidden: true };
          }
        }

        const focus = hover ?? chosen;
        if (focus === null || !graph.hasNode(focus)) return base;

        return graph.hasExtremity(edge, focus) ? { ...base, color: COLORS.edgeActive, size: 1.8, zIndex: 1 } : { ...base, hidden: true };
      },
    });

    sigma.on("clickNode", ({ node }) => select.current(node));
    sigma.on("clickStage", () => select.current(""));
    sigma.on("enterNode", ({ node }) => {
      emphasis.current.hovered = node;
      setHovered(node);
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("leaveNode", () => {
      emphasis.current.hovered = null;
      setHovered(null);
      sigma.refresh({ skipIndexation: true });
    });

    renderer.current = sigma;
    return () => {
      renderer.current = null;
      emphasis.current.hovered = null;
      sigma.kill();
    };
  }, [graph]);

  useEffect(() => {
    emphasis.current.selected = selected;
    emphasis.current.matches = matches;
    emphasis.current.flow = flow;
    renderer.current?.refresh({ skipIndexation: true });
  }, [selected, matches, flow, graph]);

  // Đưa node vừa chọn từ ô tìm kiếm hoặc cây file vào giữa vùng vẽ. Chạy sau
  // effect tạo Sigma, và chạy lại khi đồ thị đổi: chọn một node thuộc loại
  // đang tắt thì loại đó được bật, đồ thị dựng lại, rồi mới có node để bay tới.
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

  const camera = () => renderer.current?.getCamera();
  const selectedKind = selected === null ? null : graph.getNodeAttribute(selected, "kind");

  return (
    <div className="canvas">
      <div ref={container} className="canvas-stage" role="img" aria-label="Đồ thị quan hệ giữa các file của theme" />

      <div className="canvas-modes" role="tablist" aria-label="Cách xếp node">
        <button type="button" role="tab" aria-selected={layout === "force"} className={layout === "force" ? "active" : ""} onClick={() => onLayout("force")}>
          <Network size={14} /> Lực
        </button>
        <button type="button" role="tab" aria-selected={layout === "tree"} className={layout === "tree" ? "active" : ""} onClick={() => onLayout("tree")}>
          <GitBranch size={14} /> Tầng
        </button>
      </div>

      {/* Tên đầy đủ của node đang rê chuột; không rê thì là node đang chọn. */}
      {hovered !== null && hovered !== selected ? (
        <div className="canvas-pill hover">{displayName(hovered)}</div>
      ) : (
        selected !== null && (
          <div className="canvas-pill">
            <span className="pulse" />
            <span className="pill-name">{displayName(selected)}</span>
            <span className="muted">{selectedKind === null ? "" : kindLabel(selectedKind)}</span>
            <button type="button" onClick={() => onSelect("")} aria-label="Bỏ chọn">
              <X size={13} />
            </button>
          </div>
        )
      )}

      <div className="canvas-zoom">
        <button type="button" onClick={() => void camera()?.animatedZoom({ duration: 200 })} aria-label="Phóng to" title="Phóng to">
          <ZoomIn size={16} />
        </button>
        <button type="button" onClick={() => void camera()?.animatedUnzoom({ duration: 200 })} aria-label="Thu nhỏ" title="Thu nhỏ">
          <ZoomOut size={16} />
        </button>
        <button type="button" onClick={() => void camera()?.animatedReset({ duration: 200 })} aria-label="Vừa khung" title="Vừa khung">
          <Maximize2 size={16} />
        </button>
      </div>
    </div>
  );
}
