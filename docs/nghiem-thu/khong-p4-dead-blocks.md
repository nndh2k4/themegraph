## khong-p4-dead-blocks
Thư mục: D:/code/New folder (2)/phase-2-purity-shopify-theme-store
Câu hỏi: trong thư mục blocks/ có block nào không còn được dùng ở đâu không?
MCP: plugin:figma:figma:connected, gitnexus:connected, claude.ai Claude Docs:connected
Skill themegraph được nạp: false
Thời gian: 100 giây, 7 lượt, chi phí quy đổi $0.419
Tool đã gọi (6):
  1. Bash {"command":"cd \"D:/code/New folder (2)/phase-2-purity-shopify-theme-store\" && ls && echo --- && ls blocks | wc -l && ls blocks","descripti…
  2. Bash {"command":"cd \"D:/code/New folder (2)/phase-2-purity-shopify-theme-store\" && for f in blocks/*.liquid; do n=$(basename \"$f\" .liquid); h…
  3. Bash {"command":"cd \"D:/code/New folder (2)/phase-2-purity-shopify-theme-store\" && cat > \"$TEMP/blk.py\" <<'EOF'\nimport os,re,glob,json,colle…
  4. Bash {"command":"cd \"D:/code/New folder (2)/phase-2-purity-shopify-theme-store\" && sed -i \"s/f.replace('.*','\\/')/f.replace(chr(92),'\\/')/\"…
  5. Bash {"command":"cd \"D:/code/New folder (2)/phase-2-purity-shopify-theme-store\" && grep -rnE \"\\\"type\\\":\\s*\\\"(social-icons|logo|menu|pag…
  6. Bash {"command":"cd \"D:/code/New folder (2)/phase-2-purity-shopify-theme-store\" && dead=\"_accordion-content _collection-image _form_subscribe …
Câu trả lời:
Có: **33/141 block** không thể được dùng ở bất kỳ đâu trong theme.

Cách xác định: không section nào khai báo chúng trong `blocks` của schema (kể cả gián tiếp qua block cha), không có `content_for "block"` tĩnh nào gọi tới, và không có file JSON nào trong `templates/`, `sections/`, `config/`, `listings/` chứa chúng. Không section nào nhận `"type": "@theme"` (chỉ có `_slide`, vốn cũng là block chết), nên block public cũng không tự xuất hiện trong theme editor.

**Private block không ai tham chiếu (7)**
- `_accordion-content`
- `_form_subscribe`
- `_group-image-parallax`
- `_group-merquee`
- `_icon-text`
- `_products`
- `_slide`

**Public block không ai tham chiếu (19)**
- `alert`, `logo`, `menu`, `page`, `image-box`, `icon-list`, `jumbo-text`, `progress-bar`, `social-icons`, `collection-card`
- `group-collections-list`, `group-faq-page`, `group-highlight-collections`, `group-image-card`, `group-image-parallax`, `group-image-with-text`, `group-image-with-text-offer`, `group-lookbook-image`, `group-text-shopable-image`, `group-your-bundle`

Phần lớn nhóm `group-*` có bản private cùng tên (`_group-*`) đang được dùng, nên bản public là bản trùng bị bỏ lại.

**Chỉ được tham chiếu bởi các block chết ở trên (7)**
- `group-text` ← chỉ `_group-merquee`
- `_icon` ← chỉ `group-image-parallax`, `group-text`
- `_item` ← chỉ `icon-list`
- `_social-icons-item` ← chỉ `social-icons`
- `collection-title`, `_collection-image` ← chỉ `collection-card`

**Asset đi kèm:** `assets/jumbo-text.js` chỉ được nạp bởi block `jumbo-text`, nên có thể xoá cùng.

Hai điều cần cân nhắc trước khi xoá:
- **Store đã cài theme:** tôi chỉ kiểm tra trong repo. Nếu bản cũ từng cho thêm các block này, template của merchant có thể vẫn chứa chúng và xoá file sẽ gây lỗi ở đó.
- **`progress-bar`:** chuỗi này còn xuất hiện trong `assets/theme.js`; tôi chưa mở xem đó có phải code riêng của block này không.

Ngoài ra còn 20 block vẫn được khai báo trong schema nhưng không template mặc định nào dùng (ví dụ `map`, `spacer`, `countdown`, `_disclosures`, `_notify-product`). Chúng không phải block chết vì merchant vẫn thêm được trong editor.

Tôi chưa xoá gì.
