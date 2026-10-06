import type { FlowNode } from "@themegraph/core";

import type { Api } from "../api.js";
import { deepestFile, defaultPage, flowStats, opensByDefault } from "../flow-model.js";
import { displayName, edgeLabel } from "../labels.js";
import { formatRoute } from "../route.js";
import { Conditional, Failure, Kind, NodeLink, useLoaded } from "../ui.js";

/**
 * Màn cây render: một loại trang kéo theo những file nào, lồng nhau ra sao.
 * Là cùng dữ liệu với lệnh `themegraph render-flow`, nhưng gập mở được.
 */
export function Flow({ api, themeId, page }: { api: Api; themeId: string; page: string }) {
  // Danh sách trang lấy từ phần tổng quan của theme.
  const overview = useLoaded(`overview:${themeId}`, () => api.overview(themeId));

  if (overview.state === "loading") return <p className="muted">Đang tải…</p>;
  if (overview.state === "failed") return <Failure error={overview.error} themeId={themeId} />;

  const pages = overview.data.overview.pages;
  const current = page !== "" ? page : defaultPage(pages);

  if (current === null) {
    return (
      <div className="panel">
        <h1>Cây render</h1>
        <p className="muted">Theme không có template nào, nên không có trang nào để xem.</p>
      </div>
    );
  }

  return (
    <>
      <h1>Cây render</h1>
      <ul className="chips flow-pages">
        {pages.map((name) => (
          <li key={name}>
            <a
              className={name === current ? "node current" : "node"}
              href={formatRoute({ name: "flow", themeId, page: name })}
              aria-current={name === current ? "page" : undefined}
            >
              {name}
            </a>
          </li>
        ))}
      </ul>
      <Tree api={api} themeId={themeId} page={current} />
    </>
  );
}

function Tree({ api, themeId, page }: { api: Api; themeId: string; page: string }) {
  const loaded = useLoaded(`flow:${themeId}:${page}`, () => api.flow(themeId, page));

  if (loaded.state === "loading") return <p className="muted">Đang tải cây của trang {page}…</p>;
  if (loaded.state === "failed") return <Failure error={loaded.error} themeId={themeId} />;

  const { tree, files } = loaded.data;
  const stats = flowStats(tree);

  return (
    <section className="panel">
      <p className="muted">
        Trang <strong>{page}</strong> kéo theo {files.length} file, sâu nhất {deepestFile(files)} tầng. Cây có {stats.rows} dòng
        {stats.repeated > 0 && `, trong đó ${stats.repeated} dòng là file đã liệt kê ở chỗ khác (không mở lại)`}.
      </p>
      <ul className="flow-tree">
        <Row themeId={themeId} node={tree} />
      </ul>
    </section>
  );
}

/** Một dòng của cây, kèm các con của nó. Dùng <details> của trình duyệt để gập mở. */
function Row({ themeId, node }: { themeId: string; node: FlowNode }) {
  const line = (
    <span className="flow-line">
      <NodeLink themeId={themeId} id={node.id} /> <Kind kind={node.kind} />
      {node.edge !== null && node.edge !== "RENDERS" && <span className="muted note"> {edgeLabel(node.edge)}</span>}
      {node.count > 1 && <span className="muted note"> ×{node.count}</span>}
      {node.conditional && (
        <>
          {" "}
          <Conditional />
        </>
      )}
      {node.repeated && <span className="muted note"> đã liệt kê ở chỗ khác</span>}
      {node.children.length > 0 && <span className="muted note"> · gọi {node.children.length} file</span>}
      {node.kind !== "page_type" && (
        <a
          className="flow-to-graph note"
          href={formatRoute({ name: "graph", themeId, kinds: "", node: node.id, near: true })}
          title={`Xem ${displayName(node.id)} trên đồ thị`}
        >
          đồ thị
        </a>
      )}
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
            <Row key={`${child.id} ${index}`} themeId={themeId} node={child} />
          ))}
        </ul>
      </details>
    </li>
  );
}
