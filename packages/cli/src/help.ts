import { VERSION } from "@themegraph/core";

/** Nội dung của `themegraph --help`. */
export const HELP = `ThemeGraph ${VERSION} — đồ thị tri thức cho Shopify Liquid theme

Cách dùng:
  themegraph analyze [đường-dẫn]   Phân tích một theme và ghi .themegraph/graph.db
                                   (không có đường dẫn: dùng thư mục đang đứng)
  themegraph list                  Các theme đã phân tích trên máy này
  themegraph status                Đồ thị của theme này có còn khớp với các file không
  themegraph overview              Theme này gồm những gì: số liệu, trang, file dùng nhiều
  themegraph clean                 Xoá dữ liệu ThemeGraph của theme này
                                   (--all: của mọi theme đã phân tích)

  themegraph search [từ-khoá]      Tìm file, trang, khoá dịch, setting theo tên
                                   (--kind <loại>: chỉ lấy một loại node, lặp lại được)
  themegraph impact <file>         Sửa file này thì file nào, trang nào bị ảnh hưởng
  themegraph render-flow <trang>   Trang này render những file nào, lồng nhau ra sao
                                   (--depth <n>: chỉ vẽ cây tới tầng n)
  themegraph context <file>        File này là gì, ai gọi nó, nó gọi ai
  themegraph dead-code             File nào không còn được dùng
  themegraph verify                Đối chiếu truy vấn SQL với phép duyệt bằng JavaScript

  themegraph setup                 Nối ThemeGraph vào Claude Code và Cursor: đăng ký MCP
                                   server, cài skill (--dry-run: chỉ xem; --remove: gỡ)
  themegraph mcp                   Chạy MCP server trên stdin/stdout (do AI agent gọi)
  themegraph serve                 Mở giao diện web và API trên http://localhost:7777
                                   (--port <n>: dùng cổng khác)

Trừ analyze, list, setup, mcp và serve, mọi lệnh chạy trên theme chứa thư mục đang đứng.

Tuỳ chọn:
  -t, --theme <thư-mục>            Dùng theme ở thư mục này thay vì thư mục đang đứng
      --limit <n>                  Mỗi danh sách chỉ in n dòng đầu
      --json                       In kết quả dạng JSON
  -v, --version                    In phiên bản
  -h, --help                       In hướng dẫn này`;
