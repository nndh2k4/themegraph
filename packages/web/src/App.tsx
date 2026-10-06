import { useEffect, useState } from "react";

import type { Api } from "./api.js";
import { ThemeLanding } from "./components/ThemeLanding.js";
import { Workspace } from "./components/Workspace.js";
import { parseRoute } from "./route.js";
import type { Route } from "./route.js";

/** Route hiện tại, cập nhật mỗi khi phần hash của địa chỉ đổi. */
function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onChange = (): void => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}

/** Giao diện có hai màn: chọn theme, và màn làm việc của một theme. */
export function App({ api }: { api: Api }) {
  const route = useRoute();

  if (route.name === "workspace") return <Workspace api={api} route={route} />;
  if (route.name === "themes") return <ThemeLanding api={api} />;

  return (
    <div className="screen-message">
      <h1>Không có trang này</h1>
      <p>
        <a href="#/">Về danh sách theme</a>
      </p>
    </div>
  );
}
