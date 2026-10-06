import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { ApiFailure } from "./api.js";
import { kindColor } from "./graph-model.js";
import { displayName, kindLabel } from "./labels.js";
import { formatRoute, workspaceRoute } from "./route.js";
import type { WorkspaceRoute } from "./route.js";

/** Trạng thái của một lần tải dữ liệu. */
export type Loaded<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "failed"; error: ApiFailure };

/**
 * Tải dữ liệu mỗi khi `key` đổi. Kết quả của một lần tải cũ về muộn (người
 * dùng đã chuyển sang thứ khác) bị bỏ qua, để không ghi đè dữ liệu mới.
 */
export function useLoaded<T>(key: string, load: () => Promise<T>): Loaded<T> {
  const [result, setResult] = useState<{ key: string; value: Loaded<T> }>({ key, value: { state: "loading" } });

  useEffect(() => {
    let current = true;

    load().then(
      (data) => {
        if (current) setResult({ key, value: { state: "ready", data } });
      },
      (error: unknown) => {
        const failure = error instanceof ApiFailure ? error : new ApiFailure(0, "unknown", String(error));
        if (current) setResult({ key, value: { state: "failed", error: failure } });
      },
    );

    return () => {
      current = false;
    };
    // `load` được tạo lại mỗi lần render; chỉ `key` mới nói lên việc cần tải lại.
  }, [key]);

  // Key vừa đổi mà effect chưa chạy xong: đang tải, không hiện dữ liệu của key cũ.
  return result.key === key ? result.value : { state: "loading" };
}

/** Giá trị `value`, nhưng chỉ đổi sau khi `value` đứng yên `delay` mili giây. */
export function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}

/** Những phần của trạng thái màn làm việc mà một liên kết có thể đổi. */
export type RouteChanges = Partial<Omit<WorkspaceRoute, "name" | "themeId">>;

/**
 * Cách đổi trạng thái của màn làm việc đang mở: `href` cho địa chỉ ứng với
 * trạng thái hiện tại cộng các thay đổi (để gắn vào thẻ <a>), `go` chuyển
 * luôn tới đó. Mọi thành phần con lấy nó từ context, nên một liên kết ở bất
 * cứ đâu cũng giữ nguyên bộ lọc đang chọn.
 */
export interface Navigator {
  themeId: string;
  href: (changes: RouteChanges) => string;
  go: (changes: RouteChanges) => void;
}

const NavigatorContext = createContext<Navigator | null>(null);

export const NavigatorProvider = NavigatorContext.Provider;

/** Dựng Navigator cho một trạng thái của màn làm việc. */
export function navigatorFor(route: WorkspaceRoute): Navigator {
  const href = (changes: RouteChanges): string => formatRoute({ ...route, ...changes });

  return {
    themeId: route.themeId,
    href,
    go: (changes) => {
      window.location.hash = href(changes);
    },
  };
}

export function useNavigator(): Navigator {
  const navigator = useContext(NavigatorContext);
  if (navigator === null) throw new Error("useNavigator chỉ dùng được bên trong màn làm việc.");
  return navigator;
}

/** Địa chỉ mở một theme ở trạng thái ban đầu; dùng ở màn chọn theme, nơi chưa có Navigator. */
export function themeHref(themeId: string): string {
  return formatRoute(workspaceRoute(themeId));
}

/** Nhãn nhỏ ghi loại của một node, kèm chấm màu của loại đó trên đồ thị. */
export function Kind({ kind }: { kind: string }) {
  return (
    <span className="kind">
      <span className="dot" style={{ background: kindColor(kind) }} />
      {kindLabel(kind)}
    </span>
  );
}

/** Nhãn cho một quan hệ chỉ xảy ra trong một điều kiện. */
export function Conditional() {
  return (
    <span className="tag" title="Chỉ xảy ra trong một nhánh if/case, hoặc ở một template thay thế">
      có điều kiện
    </span>
  );
}

/** Tên một node; bấm vào thì chọn node đó và mở tab chi tiết. */
export function NodeLink({ id, children }: { id: string; children?: ReactNode }) {
  const { href } = useNavigator();

  return (
    <a className="node" href={href({ node: id, tab: "detail" })}>
      {children ?? displayName(id)}
    </a>
  );
}

/**
 * Bỏ phần "Có phải ý bạn là: ...?" ở cuối thông báo của server. Giao diện tự
 * liệt kê các gợi ý thành liên kết bấm được, nên không lặp lại chúng ở dạng chữ.
 */
function withoutHint(message: string): string {
  const at = message.indexOf(" Có phải ý bạn là");
  return at < 0 ? message : message.slice(0, at);
}

/** Hộp báo lỗi; với lỗi "không có file" thì kèm các gợi ý bấm được. */
export function Failure({ error }: { error: ApiFailure }) {
  const hasSuggestions = error.suggestions.length > 0;

  return (
    <div className="failure" role="alert">
      <p>{hasSuggestions ? `${withoutHint(error.message)} Có phải ý bạn là:` : error.message}</p>
      {hasSuggestions && (
        <ul>
          {error.suggestions.map((id) => (
            <li key={id}>
              <NodeLink id={id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Một mục có tiêu đề và số lượng; không có phần tử nào thì hiện `empty`. */
export function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty?: string;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <h3>
        {title} <span className="count">{count}</span>
      </h3>
      {count === 0 ? <p className="muted">{empty ?? "Không có."}</p> : children}
    </section>
  );
}
