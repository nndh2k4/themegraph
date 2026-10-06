## a6-purity-impact
Thư mục: D:/code/New folder (2)/phase-2-purity-shopify-theme-store
Câu hỏi: sửa block button thì ảnh hưởng những trang nào?
MCP: plugin:figma:figma:connected, gitnexus:connected, themegraph:connected, claude.ai Claude Docs:connected
Skill themegraph được nạp: true
Thời gian: 18 giây, 7 lượt, chi phí quy đổi $0.292
Tool đã gọi (5):
  1. Skill {"skill":"themegraph"}
  2. ToolSearch {"query":"select:mcp__themegraph__impact,mcp__themegraph__search,mcp__themegraph__context","max_results":5}
  3. mcp__themegraph__search {"query":"button","limit":40}
  4. mcp__themegraph__impact {"target":"blocks/button.liquid"}
  5. mcp__themegraph__impact {"target":"blocks/button_block.liquid"}
Câu trả lời:
Theme có hai block button, nên phạm vi ảnh hưởng tùy bạn sửa file nào.

## `blocks/button.liquid`: 17 trên 19 trang

Block này nằm trong `sections/overlay-group.json`, được `layout/theme.liquid` nạp, nên gần như mọi trang đều dính.

**Luôn bị ảnh hưởng** (template đang dùng block trực tiếp):
- `index`
- `404`
- `list-collections`
- `page`: `page.about`, `page.beatify-offer`, `page.beauty-bundle`, `page.contact`, `page.theme-feature`
- `product`: `product.json`, `product.stack`, `product.thumb-bottom`, `product.thumb-left`, `product.1-column`, `product.2-columns`

**Bị ảnh hưởng qua layout** (overlay group → `theme.liquid`):
- `article`, `blog`, `cart`, `search`
- `collection` (cả các template thay thế)
- `customers/account`, `activate_account`, `addresses`, `login`, `order`, `register`, `reset_password`

**Các section/block cho phép chứa nó** (chỉ dính khi merchant thêm block vào):
- Section: `rich-text`, `image-with-text`, `image-with-text-overlay`, `image-card`, `video-with-text-overlay`, `parallax-image-with-text`, `multi-content`, `before-after-result`, `flexible-section`, `sticky-image-with-text`, `offers-popup`
- Block: các `group-*` / `_group-*`, `image-with-text`, `_tab-row`, `tab`

Tổng cộng 71 file bị ảnh hưởng; danh sách trên chưa liệt kê 21 file ở tầng xa nhất.

## `blocks/button_block.liquid`: 3 trên 19 trang

- **Luôn bị ảnh hưởng:** `index`
- **Có điều kiện:** `page` (`page.theme-feature`) và `product` (`product.stack`, `product.thumb-bottom`, `product.thumb-left`)
- Đi qua: `flexible-section`, `scrolling-card`, `group`, `carousel`, `popup-link`, `_tab-row`, `tab`, `_accordion-row`, `accordion`, `marquee`, `collection-card`

Nếu sửa `button.liquid`, nên kiểm tra lại ít nhất trang chủ, một trang product, một trang page và phần overlay (popup offers) vì nó hiện trên toàn site.
