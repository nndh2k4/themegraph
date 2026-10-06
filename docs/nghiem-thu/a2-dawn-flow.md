## a2-dawn-flow
Thư mục: C:/Users/DELL/themes/dawn
Câu hỏi: trang cart của theme này gồm những file nào?
MCP: plugin:figma:figma:connected, gitnexus:connected, themegraph:connected, claude.ai Claude Docs:connected
Skill themegraph được nạp: true
Thời gian: 18 giây, 5 lượt, chi phí quy đổi $0.247
Tool đã gọi (3):
  1. Skill {"skill":"themegraph"}
  2. ToolSearch {"query":"select:mcp__themegraph__render_flow","max_results":5}
  3. mcp__themegraph__render_flow {"page":"cart","max_depth":6,"limit":400}
Câu trả lời:
Trang cart của Dawn kéo theo **90 file**, trong đó phần riêng của trang cart chỉ gồm 1 template, 2 section, 3 snippet và các asset của chúng; còn lại là layout, header và footer dùng chung mọi trang.

## Phần riêng của trang cart

**Template:** `templates/cart.json`, gọi 2 section bên dưới.

**`sections/main-cart-items.liquid`** (danh sách sản phẩm trong giỏ)
- CSS: `component-cart-items.css`, `component-cart.css`, `component-discounts.css`, `component-price.css`, `component-totals.css`, `quantity-popover.css`
- JS: `quantity-popover.js`, `cart.js` *(có điều kiện)*
- Snippet *(có điều kiện)*: `cart-disclosure-indicator.liquid`, `loading-spinner.liquid`, `unit-price.liquid`
- Icon *(có điều kiện)*: `icon-close`, `icon-discount`, `icon-error`, `icon-info`, `icon-minus`, `icon-plus`, `icon-remove`, `icon-warning`, `loading-spinner.svg`

**`sections/main-cart-footer.liquid`** (tổng tiền, ghi chú, nút checkout)
- CSS: `component-cart.css`, `component-discounts.css`, `component-price.css`, `component-totals.css`
- Icon *(có điều kiện)*: `icon-discount.svg`

## Phần dùng chung qua `layout/theme.liquid`

- **Asset luôn tải:** `base.css`, `component-cart-items.css`, `global.js`, `constants.js`, `pubsub.js`, `details-disclosure.js`, `details-modal.js`, `search-form.js`, `cart-disclosure-modal.js`, `cart-disclosure-tooltip.js`, `standard-actions-override.js`
- **Snippet luôn tải:** `snippets/meta-tags.liquid`
- **Header** (`sections/header-group.json`): `announcement-bar.liquid` và `header.liquid`, kèm các snippet `header-search`, `header-drawer`, `header-dropdown-menu`, `header-mega-menu`, `cart-notification`, `country-localization`, `language-localization`, `social-icons`
- **Footer** (`sections/footer-group.json`): `footer.liquid`, kèm `country-localization`, `language-localization`, `social-icons`
- **Cart drawer** *(có điều kiện)*: `snippets/cart-drawer.liquid` cùng `cart-drawer.js`, `component-cart-drawer.css`, `component-card.css` và snippet `card-collection.liquid`

Các mục ghi *(có điều kiện)* chỉ được tải trong một nhánh `if`/`case` hoặc theo setting của theme. Đồ thị không phân tích bên trong file JavaScript, nên những gì `cart.js` hay `cart-drawer.js` tự gọi lúc chạy không nằm trong danh sách này.
