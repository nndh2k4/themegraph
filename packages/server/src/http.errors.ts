/** Lỗi do tham số của request, thành mã 400. */
export class BadRequestError extends Error {}

/** Lỗi do mã theme không ứng với theme nào, thành mã 404. */
export class ThemeNotFoundError extends Error {}
