import type { EdgeType, ExportedGraph, NodeKind } from "@themegraph/core";
import { ChevronDown, ChevronRight, Eye, EyeOff, FileCode, Filter, Folder, FolderOpen, PanelLeft, PanelLeftClose, Search, Target } from "lucide-react";
import { useMemo, useState } from "react";

import {
  buildFileTree,
  DRAWN_EDGE_TYPES,
  DRAWN_KINDS,
  filterFileTree,
  formatEdgeTypes,
  formatKinds,
  kindColor,
  PAGES_FOLDER,
  toggleEdgeType,
  toggleKind,
} from "../graph-model.js";
import type { FileTreeNode, NodeHit } from "../graph-model.js";
import { edgeLabel, kindLabel } from "../labels.js";
import { MAX_DEPTH } from "../route.js";
import { useNavigator } from "../ui.js";

type Tab = "files" | "filters";

/**
 * Panel bên trái, hai tab: cây file của theme, và các bộ lọc của đồ thị. Thu
 * gọn được thành một dải icon để nhường chỗ cho vùng vẽ.
 */
export function LeftPanel({
  exported,
  kinds,
  edgeTypes,
  depth,
  selected,
  onPick,
}: {
  exported: ExportedGraph;
  kinds: readonly NodeKind[];
  edgeTypes: readonly EdgeType[];
  depth: number;
  selected: string;
  onPick: (hit: NodeHit) => void;
}) {
  const [tab, setTab] = useState<Tab>("files");
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    const open = (next: Tab) => () => {
      setTab(next);
      setCollapsed(false);
    };

    return (
      <aside className="left rail">
        <button type="button" className="icon-button" onClick={() => setCollapsed(false)} title="Mở panel">
          <PanelLeft size={18} />
        </button>
        <span className="rail-divider" />
        <button type="button" className={tab === "files" ? "icon-button active" : "icon-button"} onClick={open("files")} title="Cây file">
          <Folder size={18} />
        </button>
        <button type="button" className={tab === "filters" ? "icon-button active" : "icon-button"} onClick={open("filters")} title="Bộ lọc">
          <Filter size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="left">
      <div className="panel-tabs">
        <div role="tablist">
          <button type="button" role="tab" aria-selected={tab === "files"} className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}>
            Tệp
          </button>
          <button type="button" role="tab" aria-selected={tab === "filters"} className={tab === "filters" ? "active" : ""} onClick={() => setTab("filters")}>
            Bộ lọc
          </button>
        </div>
        <button type="button" className="icon-button small" onClick={() => setCollapsed(true)} title="Thu gọn panel">
          <PanelLeftClose size={15} />
        </button>
      </div>

      {tab === "files" ? (
        <FileTree exported={exported} selected={selected} onPick={onPick} />
      ) : (
        <Filters exported={exported} kinds={kinds} edgeTypes={edgeTypes} depth={depth} hasSelection={selected !== ""} />
      )}
    </aside>
  );
}

/** Cây file của theme. Bấm một file thì chọn node đó trên đồ thị. */
function FileTree({ exported, selected, onPick }: { exported: ExportedGraph; selected: string; onPick: (hit: NodeHit) => void }) {
  const [query, setQuery] = useState("");
  // Thư mục đang mở, theo đường dẫn. Ban đầu mở thư mục ảo chứa các trang.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set([PAGES_FOLDER]));

  const tree = useMemo(() => buildFileTree(exported.nodes), [exported]);
  const shown = useMemo(() => filterFileTree(tree, query), [tree, query]);
  const filtering = query.trim() !== "";

  const toggle = (path: string): void => {
    const next = new Set(open);
    if (!next.delete(path)) next.add(path);
    setOpen(next);
  };

  const rows = (nodes: readonly FileTreeNode[], level: number) =>
    nodes.map((node) => {
      const indent = { paddingLeft: 10 + level * 14 };

      if (node.id === null || node.kind === null) {
        // Đang lọc thì mở hết, để thấy ngay file khớp.
        const expanded = filtering || open.has(node.path);

        return (
          <li key={node.path}>
            <button type="button" className="tree-row" style={indent} onClick={() => toggle(node.path)} aria-expanded={expanded}>
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {expanded ? <FolderOpen size={15} className="folder" /> : <Folder size={15} className="folder" />}
              <span className="tree-name">{node.name}</span>
              <span className="count">{node.files}</span>
            </button>
            {expanded && <ul>{rows(node.children, level + 1)}</ul>}
          </li>
        );
      }

      const hit: NodeHit = { id: node.id, kind: node.kind, label: node.name };

      return (
        <li key={node.path}>
          <button
            type="button"
            className={node.id === selected ? "tree-row file selected" : "tree-row file"}
            style={indent}
            onClick={() => onPick(hit)}
            title={node.id}
          >
            <FileCode size={14} style={{ color: kindColor(node.kind) }} />
            <span className="tree-name">{node.name}</span>
          </button>
        </li>
      );
    });

  return (
    <>
      <div className="panel-search">
        <Search size={13} />
        <input type="text" value={query} placeholder="Lọc file…" aria-label="Lọc cây file" onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="panel-scroll">
        {shown.length === 0 ? <p className="muted pad">Không có file nào khớp.</p> : <ul className="tree">{rows(shown, 0)}</ul>}
      </div>
    </>
  );
}

/** Tab bộ lọc: loại node, loại quan hệ, độ sâu lân cận, và chú giải. */
function Filters({
  exported,
  kinds,
  edgeTypes,
  depth,
  hasSelection,
}: {
  exported: ExportedGraph;
  kinds: readonly NodeKind[];
  edgeTypes: readonly EdgeType[];
  depth: number;
  hasSelection: boolean;
}) {
  const { go } = useNavigator();

  const nodeCount = (kind: NodeKind): number => exported.nodes.filter((node) => node.kind === kind).length;
  const edgeCount = (type: EdgeType): number => exported.edges.filter((edge) => edge.type === type).length;

  return (
    <div className="panel-scroll pad">
      <h3>Loại node</h3>
      <p className="hint">Bật tắt từng loại file trên đồ thị.</p>
      <ul className="toggles">
        {DRAWN_KINDS.filter((kind) => nodeCount(kind) > 0).map((kind) => {
          const on = kinds.includes(kind);

          return (
            <li key={kind}>
              <button
                type="button"
                className={on ? "toggle on" : "toggle"}
                aria-pressed={on}
                data-kind={kind}
                onClick={() => go({ kinds: formatKinds(toggleKind(kinds, kind)) })}
              >
                <span className="dot" style={{ background: on ? kindColor(kind) : "transparent", borderColor: kindColor(kind) }} />
                <span className="toggle-name">{kindLabel(kind)}</span>
                <span className="count">{nodeCount(kind)}</span>
                {on ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </li>
          );
        })}
      </ul>

      <h3>Loại quan hệ</h3>
      <p className="hint">Bật tắt từng loại mũi tên.</p>
      <ul className="toggles">
        {DRAWN_EDGE_TYPES.filter((type) => edgeCount(type) > 0).map((type) => {
          const on = edgeTypes.includes(type);

          return (
            <li key={type}>
              <button
                type="button"
                className={on ? "toggle on" : "toggle"}
                aria-pressed={on}
                data-edge={type}
                onClick={() => go({ edges: formatEdgeTypes(toggleEdgeType(edgeTypes, type)) })}
              >
                <span className="toggle-name">{edgeLabel(type)}</span>
                <span className="count">{edgeCount(type)}</span>
                {on ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </li>
          );
        })}
      </ul>

      <h3>
        <Target size={12} /> Độ sâu lân cận
      </h3>
      <p className="hint">Chỉ hiện những gì cách node đang chọn chừng đó bước.</p>
      <div className="depths">
        {Array.from({ length: MAX_DEPTH + 1 }, (_, value) => (
          <button type="button" key={value} className={depth === value ? "active" : ""} aria-pressed={depth === value} onClick={() => go({ depth: value })}>
            {value === 0 ? "Tất cả" : `${value} bước`}
          </button>
        ))}
      </div>
      {depth > 0 && !hasSelection && <p className="hint warn">Chọn một node để áp dụng độ sâu.</p>}

      <h3>Chú giải</h3>
      <ul className="legend">
        <li>
          <span className="line" /> luôn xảy ra
        </li>
        <li>
          <span className="line dashed" /> có điều kiện (trong if/case, hoặc template thay thế)
        </li>
        <li>
          <span className="dot big" /> node càng to càng nhiều nơi gọi
        </li>
      </ul>
    </div>
  );
}
