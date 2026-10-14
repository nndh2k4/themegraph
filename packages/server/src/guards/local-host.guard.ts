/**
 * Chỉ cho request gửi tới chính máy này đi qua (giống Guard của NestJS).
 *
 * Server chỉ nghe trên 127.0.0.1, nhưng một trang web lạ vẫn có thể lừa trình
 * duyệt gọi vào đó bằng một tên miền do nó điều khiển trỏ về 127.0.0.1 (DNS
 * rebinding). Request kiểu đó mang Host là tên miền kia, nên bị từ chối.
 */
export class LocalHostGuard {
  canActivate(host: string | undefined): boolean {
    return isLocalHost(host);
  }
}

/** Header Host có trỏ về chính máy này không. */
export function isLocalHost(host: string | undefined): boolean {
  if (host === undefined) return false;

  // Bỏ phần cổng. Địa chỉ IPv6 viết trong ngoặc vuông: [::1]:7777.
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : (host.split(":")[0] ?? "");
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}
