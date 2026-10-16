/**
 * Ghi đè tên hiển thị tiếng Việt theo mã vạch, dùng khi OpenFoodFacts không có bản dịch "product_name_vi"
 * cho sản phẩm (dữ liệu cộng đồng, nhiều sản phẩm chỉ có tên tiếng Anh/Pháp/Slovak...).
 * Thêm dòng mới khi người dùng báo tên hiển thị sai ngôn ngữ cho một mã vạch cụ thể.
 */
export const BARCODE_NAME_OVERRIDES: Record<string, string> = {
  '8936010530713': 'Cozy Ice Tea - Trà đào hòa tan',
};
