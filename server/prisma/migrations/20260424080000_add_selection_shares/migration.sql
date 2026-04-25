-- CreateTable
CREATE TABLE "selection_shares" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "category_slug" TEXT NOT NULL,
    "specs" JSONB NOT NULL,
    "product_ids" JSONB NOT NULL,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "selection_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "selection_shares_token_key" ON "selection_shares"("token");

-- AddForeignKey
ALTER TABLE "selection_shares" ADD CONSTRAINT "selection_shares_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
