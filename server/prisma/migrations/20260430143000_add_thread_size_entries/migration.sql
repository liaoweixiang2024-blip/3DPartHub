CREATE TABLE "thread_size_entries" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "family" TEXT,
    "hose_kind" TEXT,
    "primary" TEXT NOT NULL,
    "secondary" TEXT NOT NULL DEFAULT '',
    "meta" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "data" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "thread_size_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "thread_size_entries_kind_idx" ON "thread_size_entries"("kind");
CREATE INDEX "thread_size_entries_family_idx" ON "thread_size_entries"("family");
CREATE INDEX "thread_size_entries_hose_kind_idx" ON "thread_size_entries"("hose_kind");
CREATE INDEX "thread_size_entries_sort_order_idx" ON "thread_size_entries"("sort_order");
