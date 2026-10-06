## a4-dawn-dead
Thư mục: C:/Users/DELL/themes/dawn
Câu hỏi: theme này có file nào thừa, xoá được không?
MCP: plugin:figma:figma:connected, gitnexus:connected, themegraph:connected, claude.ai Claude Docs:connected
Skill themegraph được nạp: true
Thời gian: 37 giây, 15 lượt, chi phí quy đổi $0.376
Tool đã gọi (13):
  1. Skill {"skill":"themegraph"}
  2. ToolSearch {"query":"select:mcp__themegraph__dead_code","max_results":5}
  3. mcp__themegraph__dead_code {}
  4. mcp__themegraph__dead_code {"limit":60}
  5. Grep {"pattern":"quick-order-product-row|component-progress-bar|customer\\.js|sparkle\\.gif|icon-tick","output_mode":"content"}
  6. Grep {"pattern":"icon-\\{\\{|'icon-' *\\| *append|append: *'\\.svg'|inline_asset_content","output_mode":"content","head_limit":30}
  7. Grep {"pattern":"append: *['\"]\\.svg|prepend: *['\"]icon-|['\"]icon-['\"] *\\| *append","output_mode":"content"}
  8. Grep {"pattern":"bulk-quick-order-list|cart-drawer|cart-icon-bubble|cart-live-region-text|cart-notification-button|cart-notification-product|pick…
  9. Grep {"pattern":"progress-bar|customer-addresses|CustomerAddresses|\\bcustomer\\b.*asset_url","output_mode":"content","head_limit":30}
  10. Glob {"pattern":"templates/customers/*"}
  11. Grep {"pattern":"render 'icon-accordion'","output_mode":"count"}
  12. Grep {"pattern":"\"value\": \"(apple|check_mark|paw_print|washing|truck|silhouette)\"","output_mode":"count"}
  13. Grep {"pattern":"data-customer-addresses|data-address|customers/","glob":"*.{liquid,json}","output_mode":"files_with_matches"}
Câu trả lời:
Có, nhưng rất ít: chỉ **3 file** xoá được an toàn. ThemeGraph báo 56 file "không trang nào dùng", nhưng khi grep lại thì 53 file trong số đó vẫn đang được dùng theo cách đồ thị không thấy.

## Xoá được (3 file)

| File | Lý do |
|---|---|
| `snippets/quick-order-product-row.liquid` | Không file nào render nó; chỗ duy nhất nhắc tên là ví dụ trong comment của chính nó. |
| `assets/component-progress-bar.css` | Không file nào nạp nó, và các rule `.progress-bar*` đã có sẵn trong `assets/base.css` (dòng 3605–3623). |
| `assets/customer.js` | Không file Liquid nào nạp nó, theme không có `templates/customers/`, và `data-customer-addresses` chỉ xuất hiện trong chính file này. |

Riêng `customer.js`: nếu bạn định thêm lại trang tài khoản kiểu cũ (classic customer accounts) thì nên giữ, vì đó là script cho trang địa chỉ.

## Không xoá (53 file bị báo nhầm)

- **44 file `assets/icon-*.svg`** (apple, banana, truck, washing…): `snippets/icon-accordion.liquid:2` ghép tên file từ giá trị merchant chọn trong setting icon của `main-product`, `featured-product` và `collapsible-content`.
- **8 section** được JavaScript tải qua Section Rendering API:
  - `cart-drawer`, `cart-icon-bubble`, `cart-live-region-text` (`assets/cart.js`, `assets/cart-drawer.js`)
  - `cart-notification-button`, `cart-notification-product` (`assets/cart-notification.js`)
  - `bulk-quick-order-list` (`assets/global.js:658`)
  - `pickup-availability` (`assets/pickup-availability.js:22`)
  - `predictive-search` (`assets/predictive-search.js:183`)
- **`assets/icon-tick.svg`**: được `sections/pickup-availability.liquid` dùng.
- **`assets/sparkle.gif`**: được gọi trong `assets/base.css:3488`.

## Khoá dịch

ThemeGraph còn liệt kê 110 khoá dịch không file nào gọi, phần lớn thuộc nhóm `customer.*`. Tôi chưa kiểm tra từng khoá nên chưa khuyên xoá.

Tôi chưa xoá gì. Bạn muốn tôi xoá 3 file trên không?
