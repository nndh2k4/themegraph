## a5-dawn-search
Thư mục: C:/Users/DELL/themes/dawn
Câu hỏi: theme này có những file nào liên quan tới facet?
MCP: plugin:figma:figma:connected, gitnexus:connected, themegraph:connected, claude.ai Claude Docs:connected
Skill themegraph được nạp: true
Thời gian: 18 giây, 5 lượt, chi phí quy đổi $0.209
Tool đã gọi (4):
  1. Glob {"pattern":"**/*facet*"}
  2. Grep {"pattern":"facet","-i":true,"output_mode":"count"}
  3. Grep {"pattern":"facet","-i":true,"output_mode":"content","glob":"{assets/base.css,sections/featured-product.liquid,sections/main-product.liquid,…
  4. Grep {"pattern":"render 'facets'|render 'price-facet'|facets\\.js|component-facets\\.css","output_mode":"content"}
Câu trả lời:
Trong Dawn 16.0.0, facet (bộ lọc và sắp xếp) nằm ở 4 file lõi, được 2 section sử dụng, cộng thêm vài chỗ liên quan gián tiếp.

**File lõi**
- `snippets/facets.liquid` — markup chính của bộ lọc và sắp xếp (dạng ngang, dọc, và drawer trên mobile).
- `snippets/price-facet.liquid` — ô lọc theo khoảng giá, được `facets.liquid` render ở dòng 336 (desktop) và 702 (mobile).
- `assets/facets.js` — JS xử lý form lọc.
- `assets/component-facets.css` — toàn bộ style của facet.

**Section dùng facet** (đều nạp `component-facets.css`, `facets.js` và render snippet `facets`)
- `sections/main-collection-product-grid.liquid` — trang collection (dòng 105–114).
- `sections/main-search.liquid` — trang kết quả tìm kiếm (dòng 7–8, 219).

**Liên quan gián tiếp**
- `assets/base.css:713` — một rule cho `.facets .disclosure-has-popup[open]`.
- `locales/*.json` — nhóm khoá dịch `products.facets.*` (ví dụ `locales/en.default.json:187`), có ở tất cả các file ngôn ngữ.
- `sections/main-product.liquid:449` và `sections/featured-product.liquid:385` — chỉ mượn khoá dịch `products.facets.show_more`, không dùng chức năng lọc.

Tôi tìm theo từ khoá "facet" nên danh sách này không tính các file mà facet phụ thuộc nhưng không chứa từ đó trong tên hay nội dung.
