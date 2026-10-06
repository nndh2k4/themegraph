## khong-d1-card-product
Thư mục: C:/Users/DELL/themes/dawn
Câu hỏi: sửa card-product thì trang nào vỡ
MCP: plugin:figma:figma:connected, gitnexus:connected, claude.ai Claude Docs:connected
Skill themegraph được nạp: false
Thời gian: 23 giây, 7 lượt, chi phí quy đổi $0.242
Tool đã gọi (5):
  1. Skill {"skill":"gitnexus-impact-analysis"}
  2. Grep {"pattern":"card-product|component-card","output_mode":"content","glob":"*.{liquid,json,js,css}"}
  3. Grep {"pattern":"\"type\": \"(collage|featured-collection|main-collection-product-grid|related-products|main-search|main-product)\"","output_mode…
  4. Grep {"pattern":"card-wrapper|card__|quick-add|product-card-wrapper","output_mode":"count","glob":"{assets/*.js,assets/*.css,sections/*.liquid,sn…
  5. Read {"file_path":"C:\\Users\\DELL\\themes\\dawn\\sections\\main-product.liquid","offset":595,"limit":30}
Câu trả lời:
Sửa `snippets/card-product.liquid` ảnh hưởng 4 trang trong cấu hình mặc định; thêm bất kỳ trang nào merchant gắn section `collage` hoặc `featured-collection`. Mình dò bằng grep các chỗ `render 'card-product'` rồi đối chiếu với `templates/*.json`, chưa chạy theme để kiểm tra.

| Trang (template) | Section gọi `card-product` | Vị trí |
|---|---|---|
| Trang chủ (`index.json`) | `featured-collection` | `sections/featured-collection.liquid:120`, `:156` |
| Trang collection (`collection.json`) | `main-collection-product-grid` | `sections/main-collection-product-grid.liquid:172` |
| Trang tìm kiếm (`search.json`) | `main-search` | `sections/main-search.liquid:275` |
| Trang sản phẩm (`product.json`) | `related-products` | `sections/related-products.liquid:41` |
| Trang sản phẩm (`product.json`) | `main-product`, block complementary products | `sections/main-product.liquid:609` |
| Chưa gắn template nào | `collage` | `sections/collage.liquid:96` |

Mấy chỗ dễ vỡ nhất khi sửa:

- **Complementary products trên trang sản phẩm:** chỗ này gọi card với `horizontal_class: true` và `horizontal_quick_add: true`, nên card nằm ngang và có CSS riêng trong `assets/component-complementary-products.css`. Sửa cấu trúc HTML của card thì đây thường là nơi lệch đầu tiên.
- **Quick add:** `assets/quick-add.js`, `assets/quick-add-bulk.js` và `assets/quick-add.css` bám vào markup trong card. Đổi class hoặc cấu trúc nút là hỏng modal thêm nhanh ở collection, tìm kiếm và trang chủ.
- **Lọc và phân trang:** trang collection và tìm kiếm render lại lưới sản phẩm qua AJAX khi lọc, nên cần thử cả sau khi áp bộ lọc chứ không chỉ lúc tải trang.
- **Class dùng chung:** nếu bạn sửa cả `assets/component-card.css` thì phạm vi rộng hơn nhiều. File này còn được nạp ở blog, danh sách collection, featured blog và cart drawer, vì `card-collection` và `article-card` dùng chung các class `card__*`.

Sửa xong nên thử theo thứ tự: trang sản phẩm có complementary products, collection có bật lọc, tìm kiếm, rồi trang chủ.
