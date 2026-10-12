import { createContext, useContext, useEffect, useState } from "react";

import { ApiFailure } from "./api.js";
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

/** Hộp báo lỗi. */
export function Failure({ error }: { error: ApiFailure }) {
  return (
    <div className="failure" role="alert">
      <p>{error.message}</p>
    </div>
  );
}
