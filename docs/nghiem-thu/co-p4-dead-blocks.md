## co-p4-dead-blocks
Thư mục: D:/code/New folder (2)/phase-2-purity-shopify-theme-store
Câu hỏi: trong thư mục blocks/ có block nào không còn được dùng ở đâu không?
MCP: plugin:figma:figma:connected, gitnexus:connected, themegraph:connected, claude.ai Claude Docs:connected
Skill themegraph được nạp: true
Thời gian: 22 giây, 7 lượt, chi phí quy đổi $0.292
Tool đã gọi (5):
  1. Skill {"skill":"themegraph"}
  2. ToolSearch {"query":"select:mcp__themegraph__dead_code","max_results":1}
  3. Glob {"pattern":"blocks/*.liquid"}
  4. mcp__themegraph__dead_code {"limit":500}
  5. Grep {"pattern":"[\"'](_accordion-content|_form_subscribe|_group-image-parallax|_group-merquee|_icon-text|_products|_slide)[\"']","output_mode":"…
Câu trả lời:
Có **7 block** trong `blocks/` không còn được dùng ở đâu:

| Block | 
| --- |
| `blocks/_accordion-content.liquid` |
| `blocks/_form_subscribe.liquid` |
| `blocks/_group-image-parallax.liquid` |
| `blocks/_group-merquee.liquid` |
| `blocks/_icon-text.liquid` |
| `blocks/_products.liquid` |
| `blocks/_slide.liquid` |

ThemeGraph xếp cả 7 vào mức "chắc chắn không dùng". Tôi đã grep lại tên của chúng trên toàn repo và không có kết quả nào: không có trong schema của section hay block nào, không có trong JSON template, section group, hay lời gọi `content_for`.

Cả 7 đều là block private (tên bắt đầu bằng `_`), nên `"type": "@theme"` không tự nhận chúng; phải có nơi gọi đúng tên thì mới dùng được. Vì vậy xoá chúng là an toàn về mặt mã nguồn.

Một điểm cần lưu ý trước khi xoá: tôi chỉ kiểm tra được mã trong repo. Nếu một store đang chạy theme này còn lưu block đó trong template JSON trên Shopify admin (dữ liệu chưa được kéo về repo), thì xoá file sẽ làm block đó biến mất trên store ấy.

Các block còn lại (134 file) đều có ít nhất một nơi dùng tới.
