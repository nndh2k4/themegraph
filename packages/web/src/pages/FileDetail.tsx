import type { ContextLink } from "@themegraph/core";

import type { Api } from "../api.js";
import { displayName, edgeLabel, linesText } from "../labels.js";
import { Conditional, Failure, Kind, NodeLink, Section, useLoaded } from "../ui.js";

/** Số file gọi trực tiếp được nêu sau chữ "qua" ở mỗi trang. */
const MAX_VIA_SHOWN = 3;

/**
 * Màn chi tiết của một node: ai gọi nó, nó gọi ai, và sửa nó thì trang nào bị
 * ảnh hưởng. Dùng cho mọi loại node: file, trang, khoá dịch, setting.
 */
export function FileDetail({ api, themeId, path }: { api: Api; themeId: string; path: string }) {
  const loaded = useLoaded(`file:${themeId}:${path}`, () => api.file(themeId, path));

  if (loaded.state === "loading") return <p className="muted">Đang tải…</p>;
  if (loaded.state === "failed") return <Failure error={loaded.error} themeId={themeId} />;

  const { context, impact } = loaded.data;
  const { node } = context;

  // Trang render file ngay khi tải đứng trước; trang chỉ dính qua một section
  // do JavaScript tải đứng sau. sort() giữ thứ tự cũ trong mỗi nhóm.
  const pages = [...impact.pages].sort((a, b) => Number(a.scriptOnly) - Number(b.scriptOnly));
  const files = impact.affected.filter((entry) => entry.kind !== "page_type");
  const offPage = new Set(impact.offPage);

  return (
    <>
      <h1>
        {displayName(node.id)} <Kind kind={node.kind} />
      </h1>

      {node.kind !== "page_type" && (
        <Section
          title={`Trang bị ảnh hưởng khi sửa (trên ${impact.totalPages})`}
          count={pages.length}
          empty="Theo đồ thị, không trang nào dùng tới."
        >
          <table>
            <tbody>
              {pages.map((page) => (
                <tr key={page.id}>
                  <td>
                    <NodeLink themeId={themeId} id={page.id} />
                  </td>
                  <td className="muted">cách {page.depth} tầng</td>
                  <td>
                    {page.scriptOnly ? (
                      <span className="tag" title="Chỉ lên trang này khi JavaScript tải riêng một section">
                        qua JavaScript
                      </span>
                    ) : (
                      !page.certain && <Conditional />
                    )}
                  </td>
                  <td className="muted">
                    {page.via.length > 0 && (
                      <>
                        qua{" "}
                        {page.via.slice(0, MAX_VIA_SHOWN).map((id, index) => (
                          <span key={id}>
                            {index > 0 && ", "}
                            <NodeLink themeId={themeId} id={id} />
                          </span>
                        ))}
                        {page.via.length > MAX_VIA_SHOWN && ` và ${page.via.length - MAX_VIA_SHOWN} file khác`}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <div className="columns">
        <Section title="Được gọi bởi" count={context.usedBy.length} empty="Không file nào gọi trực tiếp.">
          <Links themeId={themeId} links={context.usedBy} linesOf="other" />
        </Section>

        <Section title="Gọi tới" count={context.uses.length} empty="Không gọi file nào.">
          <Links themeId={themeId} links={context.uses} linesOf="self" />
        </Section>
      </div>

      {(context.translations.length > 0 || context.settings.length > 0) && (
        <div className="columns">
          <Section title="Khoá dịch" count={context.translations.length}>
            <Links themeId={themeId} links={context.translations} linesOf="self" plain />
          </Section>
          <Section title="Setting được đọc" count={context.settings.length}>
            <Links themeId={themeId} links={context.settings} linesOf="self" plain />
          </Section>
        </div>
      )}

      {context.broken.length > 0 && (
        <Section title="Tham chiếu hỏng" count={context.broken.length}>
          <table>
            <tbody>
              {context.broken.map((entry, index) => (
                <tr key={index}>
                  <td className="muted">{entry.line > 0 ? `dòng ${entry.line}` : "(JSON)"}</td>
                  <td>{entry.kind}</td>
                  <td>
                    <code>{entry.expected}</code> không có trong theme
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {files.length > 0 && (
        <Section title="Mọi file bị ảnh hưởng, gần nhất trước" count={files.length}>
          <table>
            <tbody>
              {files.map((entry) => (
                <tr key={entry.id}>
                  <td className="number">{entry.depth}</td>
                  <td>
                    <NodeLink themeId={themeId} id={entry.id} />
                  </td>
                  <td>
                    <Kind kind={entry.kind} />
                  </td>
                  <td>
                    {!entry.certain && <Conditional />}{" "}
                    {offPage.has(entry.id) && (
                      <span
                        className="tag"
                        title="Theo đồ thị, file này không nằm trên trang nào; nó vẫn có thể được thêm từ theme editor hoặc được JavaScript tải"
                      >
                        không trang nào dùng
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );
}

/**
 * Bảng các quan hệ trực tiếp. `linesOf` cho biết số dòng thuộc file nào:
 * "other" là dòng trong file ở đầu bên kia (file gọi), "self" là dòng trong
 * chính file đang xem.
 */
function Links({
  themeId,
  links,
  linesOf,
  plain = false,
}: {
  themeId: string;
  links: readonly ContextLink[];
  linesOf: "self" | "other";
  plain?: boolean;
}) {
  return (
    <table>
      <tbody>
        {links.map((link) => (
          <tr key={`${link.id}:${link.type}`}>
            <td>
              <NodeLink themeId={themeId} id={link.id} />
              {linesOf === "other" && link.lines.length > 0 && <span className="muted">:{link.lines.join(",")}</span>}
            </td>
            {linesOf === "self" && <td className="muted">{linesText(link.lines)}</td>}
            {!plain && (
              <td className="muted">
                {edgeLabel(link.type)}
                {link.count > 1 && ` ×${link.count}`}
              </td>
            )}
            <td>{link.conditional && <Conditional />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
