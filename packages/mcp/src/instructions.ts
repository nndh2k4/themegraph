/**
 * Giới hạn mặc định của đầu ra. Client cắt đầu ra của tool ở vài chục nghìn
 * token, và JSON đầy đủ của một trang trên theme lớn dài gần 300 KB; các con
 * số dưới đây giữ mọi câu trả lời mặc định dưới khoảng 20 KB (đo trên Purity,
 * 3811 node). Agent tăng được từng giới hạn qua tham số khi cần xem thêm.
 */
export const DEFAULT_LIST_LIMIT = 50; // số dòng của mỗi danh sách
export const DEFAULT_SEARCH_RESULTS = 20; // số kết quả của search
export const DEFAULT_FLOW_DEPTH = 3; // số tầng của cây render_flow
export const DEFAULT_FLOW_LINES = 150; // số dòng của cây render_flow

/**
 * Lời dặn gửi cho client lúc bắt tay; client đưa nó vào ngữ cảnh của agent.
 * Viết ngắn: đây là thứ agent luôn mang theo, kể cả khi không dùng tới theme.
 */
export const INSTRUCTIONS = `ThemeGraph trả lời câu hỏi về CẤU TRÚC của một Shopify theme (Liquid) từ một đồ thị đã dựng sẵn: file nào render file nào, trang nào dùng file nào.

Dùng các tool này thay cho việc grep "render '...'" qua nhiều file, vì đồ thị đã đi hết các tầng trung gian (snippet -> section -> template -> loại trang):
- Trước khi sửa hoặc xoá một snippet, section, block, layout hay asset: gọi impact để biết trang nào bị ảnh hưởng.
- Cần biết một trang (product, collection, cart...) gồm những file nào: gọi render_flow.
- Cần biết ai gọi một file, nó gọi ai, nó đọc setting và khoá dịch nào: gọi context.
- Chưa biết đường dẫn chính xác của file: gọi search.
- Dọn dẹp theme: gọi dead_code.

Tên file là đường dẫn tính từ gốc theme, ví dụ snippets/card-product.liquid; tên trang là product, collection, index... Quan hệ ghi "[có điều kiện]" chỉ xảy ra trong một nhánh if/case hoặc ở một template thay thế.
Nếu câu trả lời báo đồ thị đã cũ, kết quả có thể thiếu các thay đổi gần đây; chạy "themegraph analyze" trong thư mục theme để cập nhật.`;
