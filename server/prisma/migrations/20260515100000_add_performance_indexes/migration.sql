-- Read-path indexes for high-traffic public lists and admin dashboards.
-- They match the application's common filter + sort patterns and are safe to re-run.

-- Users
CREATE INDEX IF NOT EXISTS "users_role_created_at_idx" ON "users"("role", "created_at");
CREATE INDEX IF NOT EXISTS "users_created_at_idx" ON "users"("created_at");

-- Product wall
CREATE INDEX IF NOT EXISTS "product_wall_images_reviewed_by_id_idx" ON "product_wall_images"("reviewed_by_id");
CREATE INDEX IF NOT EXISTS "product_wall_images_reviewed_at_idx" ON "product_wall_images"("reviewed_at");
CREATE INDEX IF NOT EXISTS "product_wall_images_status_sort_order_created_at_idx" ON "product_wall_images"("status", "sort_order", "created_at");
CREATE INDEX IF NOT EXISTS "product_wall_images_kind_sort_order_idx" ON "product_wall_images"("kind", "sort_order");
CREATE INDEX IF NOT EXISTS "product_wall_image_favorites_image_id_idx" ON "product_wall_image_favorites"("image_id");
CREATE INDEX IF NOT EXISTS "product_wall_image_favorites_user_id_created_at_idx" ON "product_wall_image_favorites"("user_id", "created_at");

-- Models and favorites
CREATE INDEX IF NOT EXISTS "models_status_updated_at_idx" ON "models"("status", "updated_at");
CREATE INDEX IF NOT EXISTS "models_status_format_created_at_idx" ON "models"("status", "format", "created_at");
CREATE INDEX IF NOT EXISTS "models_status_gltf_size_idx" ON "models"("status", "gltf_size");
CREATE INDEX IF NOT EXISTS "models_status_category_id_name_idx" ON "models"("status", "category_id", "name");
CREATE INDEX IF NOT EXISTS "models_status_download_count_created_at_idx" ON "models"("status", "download_count", "created_at");
CREATE INDEX IF NOT EXISTS "favorites_user_id_created_at_idx" ON "favorites"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "favorites_model_id_idx" ON "favorites"("model_id");

-- Downloads
CREATE INDEX IF NOT EXISTS "downloads_model_id_created_at_idx" ON "downloads"("model_id", "created_at");
CREATE INDEX IF NOT EXISTS "downloads_created_at_idx" ON "downloads"("created_at");
CREATE INDEX IF NOT EXISTS "downloads_format_idx" ON "downloads"("format");
CREATE INDEX IF NOT EXISTS "downloads_format_created_at_idx" ON "downloads"("format", "created_at");

-- Share lists
CREATE INDEX IF NOT EXISTS "share_links_created_by_id_idx" ON "share_links"("created_by_id");
CREATE INDEX IF NOT EXISTS "share_links_created_by_id_created_at_idx" ON "share_links"("created_by_id", "created_at");
CREATE INDEX IF NOT EXISTS "share_links_created_at_idx" ON "share_links"("created_at");
CREATE INDEX IF NOT EXISTS "share_links_expires_at_idx" ON "share_links"("expires_at");
CREATE INDEX IF NOT EXISTS "selection_shares_created_by_id_created_at_idx" ON "selection_shares"("created_by_id", "created_at");
CREATE INDEX IF NOT EXISTS "selection_shares_category_slug_idx" ON "selection_shares"("category_slug");
CREATE INDEX IF NOT EXISTS "selection_shares_created_at_idx" ON "selection_shares"("created_at");

-- Audit log dashboards
CREATE INDEX IF NOT EXISTS "audit_logs_resource_created_at_idx" ON "audit_logs"("resource", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_resource_action_created_at_idx" ON "audit_logs"("resource", "action", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_resource_id_idx" ON "audit_logs"("resource_id");

-- Categories and selection data
CREATE INDEX IF NOT EXISTS "categories_parent_id_sort_order_idx" ON "categories"("parent_id", "sort_order");
CREATE INDEX IF NOT EXISTS "categories_sort_order_idx" ON "categories"("sort_order");
CREATE INDEX IF NOT EXISTS "thread_size_entries_kind_family_sort_order_idx" ON "thread_size_entries"("kind", "family", "sort_order");
CREATE INDEX IF NOT EXISTS "thread_size_entries_kind_hose_kind_sort_order_idx" ON "thread_size_entries"("kind", "hose_kind", "sort_order");
CREATE INDEX IF NOT EXISTS "selection_categories_sort_order_idx" ON "selection_categories"("sort_order");
CREATE INDEX IF NOT EXISTS "selection_categories_group_id_sort_order_idx" ON "selection_categories"("group_id", "sort_order");
CREATE INDEX IF NOT EXISTS "selection_categories_kind_sort_order_idx" ON "selection_categories"("kind", "sort_order");
CREATE INDEX IF NOT EXISTS "selection_categories_catalog_shared_idx" ON "selection_categories"("catalog_shared");
CREATE INDEX IF NOT EXISTS "selection_products_category_id_sort_order_idx" ON "selection_products"("category_id", "sort_order");
CREATE INDEX IF NOT EXISTS "selection_products_category_id_model_no_idx" ON "selection_products"("category_id", "model_no");
CREATE INDEX IF NOT EXISTS "selection_products_sort_order_idx" ON "selection_products"("sort_order");

-- Inquiries and tickets
CREATE INDEX IF NOT EXISTS "inquiries_user_id_created_at_idx" ON "inquiries"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "inquiries_status_created_at_idx" ON "inquiries"("status", "created_at");
CREATE INDEX IF NOT EXISTS "inquiries_sales_assignee_id_status_created_at_idx" ON "inquiries"("sales_assignee_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "inquiries_created_at_idx" ON "inquiries"("created_at");
CREATE INDEX IF NOT EXISTS "inquiry_items_product_id_idx" ON "inquiry_items"("product_id");
CREATE INDEX IF NOT EXISTS "inquiry_items_model_no_idx" ON "inquiry_items"("model_no");
CREATE INDEX IF NOT EXISTS "inquiry_messages_user_id_idx" ON "inquiry_messages"("user_id");
CREATE INDEX IF NOT EXISTS "support_tickets_user_id_created_at_idx" ON "support_tickets"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "support_tickets_status_created_at_idx" ON "support_tickets"("status", "created_at");
CREATE INDEX IF NOT EXISTS "support_tickets_created_at_idx" ON "support_tickets"("created_at");
