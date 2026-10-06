## co2-p4-dead-blocks
Thư mục: D:/code/New folder (2)/phase-2-purity-shopify-theme-store
Câu hỏi: trong thư mục blocks/ có block nào không còn được dùng ở đâu không?
MCP: plugin:figma:figma:connected, gitnexus:connected, themegraph:connected, claude.ai Claude Docs:connected
Skill themegraph được nạp: true
Thời gian: 31 giây, 7 lượt, chi phí quy đổi $0.318
Tool đã gọi (5):
  1. Skill {"skill":"themegraph"}
  2. ToolSearch {"query":"select:mcp__themegraph__dead_code,mcp__themegraph__context,mcp__themegraph__list_themes","max_results":5}
  3. mcp__themegraph__dead_code {"limit":500}
  4. Glob {"pattern":"blocks/*.liquid"}
  5. Bash {"command":"cd \"D:/code/New folder (2)/phase-2-purity-shopify-theme-store\" && echo \"== @theme / @app acceptors ==\" && grep -rlE '\"type\…
Câu trả lời:
Có: **33 trong số 141 block** không còn được dùng ở đâu. Tôi lấy danh sách từ ThemeGraph rồi grep lại `"type": "<tên block>"` và `content_for` trong `sections/`, `blocks/`, `templates/`, `config/`, `snippets/`, `layout/`; kết quả khớp.

Không section nào khai báo `"type": "@theme"` (chỉ có `blocks/_slide.liquid`, mà chính nó cũng không được dùng), nên các block public dưới đây cũng không thể được thêm qua theme editor.

**Không có tham chiếu nào (25 block)**

- Block private:
  - `_accordion-content`
  - `_form_subscribe`
  - `_group-image-parallax`
  - `_group-merquee`
  - `_icon-text`
  - `_products`
  - `_slide`
- Block public dạng group:
  - `group-collections-list`
  - `group-faq-page`
  - `group-highlight-collections`
  - `group-image-card`
  - `group-image-parallax`
  - `group-image-with-text-offer`
  - `group-image-with-text`
  - `group-lookbook-image`
  - `group-text-shopable-image`
  - `group-your-bundle`
- Block public khác:
  - `alert`
  - `collection-card`
  - `icon-list`
  - `image-box`
  - `jumbo-text`
  - `logo`
  - `menu`
  - `page`
  - `progress-bar`
  - `social-icons`

**Chỉ được gọi bởi một block không dùng khác (6 block)**

| Block | Chỉ được gọi bởi |
| --- | --- |
| `_collection-image` | `collection-card` |
| `collection-title` | `collection-card` |
| `_icon` | `group-image-parallax`, `group-text` |
| `_item` | `icon-list` |
| `_social-icons-item` | `social-icons` |
| `group-text` | `_group-merquee` |

`assets/jumbo-text.js` cũng chỉ được `blocks/jumbo-text.liquid` gọi, nên nếu xoá block này thì file đó thừa theo.

**Lưu ý trước khi xoá**

- Một số tên có bản gần giống đang được dùng, đừng xoá nhầm: ví dụ `group-image-parallax` (không dùng) so với `_group-image-parallax` (cũng không dùng), nhưng `_group-collections-list`, `_group-faq-page`, `_group-lookbook-image`, `_group-text` (có gạch dưới) không nằm trong danh sách này.
- Tôi chỉ kiểm tra mã trong repo. Nếu store đang chạy có template JSON được chỉnh trong theme editor mà chưa pull về, block vẫn có thể đang được dùng ở đó.

Tôi chưa xoá gì.
