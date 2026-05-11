ALTER TABLE "inquiries"
  ADD COLUMN "sales_assignee_id" TEXT,
  ADD COLUMN "sales_assigned_by_id" TEXT,
  ADD COLUMN "sales_assigned_at" TIMESTAMP(3),
  ADD COLUMN "sales_mode" TEXT,
  ADD COLUMN "sales_channel" TEXT,
  ADD COLUMN "sales_region" TEXT,
  ADD COLUMN "sales_handoff_note" TEXT;

CREATE INDEX "inquiries_sales_assignee_id_idx" ON "inquiries"("sales_assignee_id");
CREATE INDEX "inquiries_sales_assigned_at_idx" ON "inquiries"("sales_assigned_at");

ALTER TABLE "inquiries"
  ADD CONSTRAINT "inquiries_sales_assignee_id_fkey"
  FOREIGN KEY ("sales_assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inquiries"
  ADD CONSTRAINT "inquiries_sales_assigned_by_id_fkey"
  FOREIGN KEY ("sales_assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
