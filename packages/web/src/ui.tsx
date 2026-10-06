import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { ApiFailure } from "./api.js";
import { displayName, kindLabel } from "./labels.js";
import { formatRoute } from "./route.js";

/** Trạng thái của một lần tải dữ liệu. */
export type Loaded<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "failed"; error: ApiFailure };

/**
 * Tải dữ liệu mỗi khi `key` đổi. Kết quả của một lần tải cũ về muộn (người
 * dùng đã chuyển sang màn khác) bị bỏ qua, để không ghi đè dữ liệu mới.
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

/** Nhãn nhỏ ghi loại của một node. */
export function Kind({ kind }: { kind: string }) {
  return <span className={`kind kind-${kind}`}>{kindLabel(kind)}</span>;
}

/** Nhãn cho một quan hệ chỉ xảy ra trong một điều kiện. */
export function Conditional() {
  return (
    <span className="tag" title="Chỉ xảy ra trong một nhánh if/case, hoặc ở một template thay thế">
      có điều kiện
    </span>
  );
}

/** Tên một node, bấm vào thì mở màn chi tiết của nó. */
export function NodeLink({ themeId, id }: { themeId: string; id: string }) {
  return (
    <a className="node" href={formatRoute({ name: "file", themeId, path: id })}>
      {displayName(id)}
    </a>
  );
}

/**
 * Bỏ phần "Có phải ý bạn là: ...?" ở cuối thông báo của server. Màn hình tự
 * liệt kê các gợi ý thành liên kết bấm được, nên không lặp lại chúng ở dạng chữ.
 */
function withoutHint(message: string): string {
  const at = message.indexOf(" Có phải ý bạn là");
  return at < 0 ? message : message.slice(0, at);
}

/** Hộp báo lỗi; với lỗi "không có file" thì kèm các gợi ý bấm được. */
export function Failure({ error, themeId }: { error: ApiFailure; themeId?: string }) {
  const hasSuggestions = themeId !== undefined && error.suggestions.length > 0;

  return (
    <div className="failure" role="alert">
      <p>{hasSuggestions ? `${withoutHint(error.message)} Có phải ý bạn là:` : error.message}</p>
      {hasSuggestions && (
        <ul>
          {error.suggestions.map((id) => (
            <li key={id}>
              <NodeLink themeId={themeId} id={id} />
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
    <section className="panel">
      <h2>
        {title} <span className="count">{count}</span>
      </h2>
      {count === 0 ? <p className="muted">{empty ?? "Không có."}</p> : children}
    </section>
  );
}
