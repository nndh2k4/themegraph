import { useMemo, useState } from "react";

import type { Api } from "../api.js";
import { layoutGraph } from "../graph-layout.js";
import { drawGraph, formatKinds, parseEdgeTypes, parseKinds, searchNodes, toggleKind } from "../graph-model.js";
import type { NodeHit } from "../graph-model.js";
import { displayName, formatTime } from "../labels.js";
import type { WorkspaceRoute } from "../route.js";
import { Failure, navigatorFor, NavigatorProvider, useLoaded } from "../ui.js";
import { GraphCanvas } from "./GraphCanvas.js";
import type { FlyTo } from "./GraphCanvas.js";
import { Header } from "./Header.js";
import { LeftPanel } from "./LeftPanel.js";

/**
 * Màn làm việc của một theme: thanh trên, panel trái (cây file và bộ lọc),
 * vùng vẽ đồ thị chiếm phần còn lại, và thanh trạng thái ở dưới.
 *
 * Thành phần này giữ mọi dữ liệu dùng chung và nối các vùng với nhau. Trạng
 * thái nằm trong địa chỉ (`route`); các vùng đổi trạng thái bằng cách đổi địa
 * chỉ. Chỉ hai thứ thoáng qua nằm ở đây: từ khoá đang gõ, và yêu cầu đưa
 * camera tới một node.
 */
export function Workspace({ api, route }: { api: Api; route: WorkspaceRoute }) {
  const { themeId } = route;
  const navigator = useMemo(() => navigatorFor(route), [route]);

  const themes = useLoaded("themes", () => api.themes());
  const graphData = useLoaded(`graph:${themeId}`, () => api.graph(themeId));
  const overview = useLoaded(`overview:${themeId}`, () => api.overview(themeId));

  const kinds = useMemo(() => parseKinds(route.kinds), [route.kinds]);
  const edgeTypes = useMemo(() => parseEdgeTypes(route.edges), [route.edges]);

  // Phần sẽ vẽ, và vị trí của từng node. Chỉ tính lại khi dữ liệu, bộ lọc
  // hoặc bố cục đổi; chọn một node khác (khi không giới hạn độ sâu) thì hình
  // giữ nguyên.
  const exported = graphData.state === "ready" ? graphData.data : null;
  const center = route.depth > 0 ? route.node : "";
  const draw = useMemo(
    () => (exported === null ? null : drawGraph(exported, { kinds, edgeTypes, ...(center === "" ? {} : { center, depth: route.depth }) })),
    [exported, kinds, edgeTypes, center, route.depth],
  );
  const graph = useMemo(() => (draw === null ? null : layoutGraph(draw, route.layout)), [draw, route.layout]);

  const [query, setQuery] = useState("");
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);

  const hits = useMemo(() => (exported === null ? [] : searchNodes(exported.nodes, query)), [exported, query]);
  const matches = useMemo(() => (query.trim() === "" ? null : new Set(hits.map((hit) => hit.id))), [hits, query]);

  if (graphData.state === "loading") return <div className="screen-message muted">Đang tải đồ thị…</div>;
  if (graphData.state === "failed") {
    return (
      <div className="screen-message">
        <Failure error={graphData.error} />
        <p>
          <a href="#/">Về danh sách theme</a>
        </p>
      </div>
    );
  }
  if (exported === null || draw === null || graph === null) return null;

  // Chọn một node từ ô tìm kiếm hoặc cây file: chọn nó, bật loại của nó nếu
  // đang tắt, và đưa nó vào giữa vùng vẽ.
  const pick = (hit: NodeHit): void => {
    navigator.go({ node: hit.id, kinds: formatKinds(kinds.includes(hit.kind) ? kinds : toggleKind(kinds, hit.kind)) });
    setFlyTo((previous) => ({ id: hit.id, n: (previous?.n ?? 0) + 1 }));
    setQuery("");
  };

  const theme = themes.state === "ready" ? themes.data.find((entry) => entry.id === themeId) : undefined;
  const selected = route.node !== "" && graph.hasNode(route.node) ? route.node : null;
  const status = overview.state === "ready" ? overview.data.status : null;
  const changed = status === null ? 0 : status.modified.length + status.added.length + status.removed.length;

  return (
    <NavigatorProvider value={navigator}>
      <div className="workspace">
        <Header api={api} theme={theme} query={query} hits={hits} onQuery={setQuery} onPick={pick} />

        <main className="workspace-main">
          <LeftPanel exported={exported} kinds={kinds} edgeTypes={edgeTypes} depth={route.depth} selected={route.node} onPick={pick} />

          <div className="workspace-canvas">
            {draw.nodes.length === 0 ? (
              <p className="screen-message muted">Không có node nào thuộc các loại đang chọn. Bật lại một loại ở tab Bộ lọc.</p>
            ) : (
              <GraphCanvas
                graph={graph}
                layout={route.layout}
                selected={selected}
                matches={matches}
                flyTo={flyTo}
                onSelect={(id) => navigator.go(id === "" ? { node: "", depth: 0 } : { node: id })}
                onLayout={(layout) => navigator.go({ layout })}
              />
            )}
          </div>
        </main>

        <footer className="statusbar">
          <div className="statusbar-left" data-testid="status">
            {status === null ? (
              <span>Đang kiểm tra file trên đĩa…</span>
            ) : status.stale ? (
              <>
                <span className="dot stale" />
                <span>
                  Đồ thị đã cũ: {changed} file đã đổi. Chạy <code>themegraph analyze</code> rồi tải lại trang.
                </span>
              </>
            ) : (
              <>
                <span className="dot live" />
                <span>Đồ thị khớp với file trên đĩa</span>
              </>
            )}
          </div>
          <div className="statusbar-right" data-testid="counts">
            <span>
              đang vẽ {draw.nodes.length} node, {draw.edges.length} cạnh
              {draw.center !== null && ` (lân cận ${route.depth} bước của ${displayName(draw.center)})`}
            </span>
            {overview.state === "ready" && (
              <>
                <span className="sep">•</span>
                <span>
                  cả theme {overview.data.overview.nodes} node, {overview.data.overview.edges} cạnh
                </span>
                <span className="sep">•</span>
                <span>phân tích {formatTime(overview.data.overview.meta.analyzedAt)}</span>
              </>
            )}
          </div>
        </footer>
      </div>
    </NavigatorProvider>
  );
}
