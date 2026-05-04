import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const migrationName = '20260430103000_add_product_wall_images';
const migrationPath = join(process.cwd(), 'prisma/migrations', migrationName, 'migration.sql');
const categoryMigrationName = '20260430112000_add_product_wall_categories';
const categoryMigrationPath = join(process.cwd(), 'prisma/migrations', categoryMigrationName, 'migration.sql');
const productWallDir = join(process.cwd(), 'static/product-wall');
const imageExts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);
const defaultCategories = ['公司产品', '使用案例', '客户案例', '海报'];

const statements = [
  `CREATE TABLE IF NOT EXISTS "product_wall_images" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT '公司产品',
    "image_url" TEXT NOT NULL,
    "preview_image_url" TEXT,
    "ratio" TEXT NOT NULL DEFAULT '4 / 5',
    "tags" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "uploader_id" TEXT,
    "uploader_name" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_id" TEXT,
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_wall_images_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "product_wall_images_status_idx" ON "product_wall_images"("status")`,
  `CREATE INDEX IF NOT EXISTS "product_wall_images_kind_idx" ON "product_wall_images"("kind")`,
  `CREATE INDEX IF NOT EXISTS "product_wall_images_sort_order_idx" ON "product_wall_images"("sort_order")`,
  `CREATE INDEX IF NOT EXISTS "product_wall_images_created_at_idx" ON "product_wall_images"("created_at")`,
  `CREATE INDEX IF NOT EXISTS "product_wall_images_uploader_id_idx" ON "product_wall_images"("uploader_id")`,
  `ALTER TABLE "product_wall_images" ADD COLUMN IF NOT EXISTS "description" TEXT`,
  `DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_wall_images_uploader_id_fkey') THEN
      ALTER TABLE "product_wall_images"
        ADD CONSTRAINT "product_wall_images_uploader_id_fkey"
        FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END $$`,
  `DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_wall_images_reviewed_by_id_fkey') THEN
      ALTER TABLE "product_wall_images"
        ADD CONSTRAINT "product_wall_images_reviewed_by_id_fkey"
        FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END $$`,
  `CREATE TABLE IF NOT EXISTS "product_wall_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_wall_categories_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "product_wall_categories_name_key" ON "product_wall_categories"("name")`,
  `CREATE INDEX IF NOT EXISTS "product_wall_categories_sort_order_idx" ON "product_wall_categories"("sort_order")`,
];

async function markMigrationApplied(migrationName: string, migrationPath: string) {
  const applied = await prisma.$queryRawUnsafe<Array<{ exists: number }>>(
    'SELECT 1 AS exists FROM _prisma_migrations WHERE migration_name = $1 LIMIT 1',
    migrationName,
  );
  if (applied.length) return;
  const checksum = createHash('sha256').update(readFileSync(migrationPath)).digest('hex');
  await prisma.$executeRawUnsafe(
    `INSERT INTO _prisma_migrations
      (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
     VALUES ($1, $2, NOW(), $3, NULL, NULL, NOW(), 1)`,
    randomUUID(),
    checksum,
    migrationName,
  );
}

async function main() {
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }

  await markMigrationApplied(migrationName, migrationPath);
  await markMigrationApplied(categoryMigrationName, categoryMigrationPath);

  const existingRows = await prisma.productWallImage.findMany({ select: { imageUrl: true } });
  const existingUrls = new Set(existingRows.map((row) => row.imageUrl));
  const maxSort = await prisma.productWallImage.aggregate({ _max: { sortOrder: true } });
  let sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
  const localImages = readdirSync(productWallDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && imageExts.has(extname(entry.name).toLowerCase()))
    .map((entry) => `/static/product-wall/${entry.name}`)
    .filter((url) => !existingUrls.has(url));

  if (localImages.length) {
    await prisma.productWallImage.createMany({
      data: localImages.map((url) => {
        const title =
          url
            .split('/')
            .pop()
            ?.replace(/\.[^.]+$/, '') || '产品图片';
        return {
          title,
          kind: '公司产品',
          imageUrl: url,
          previewImageUrl: url,
          ratio: '4 / 5',
          tags: ['本地图片'],
          sortOrder: sortOrder++,
          status: 'approved',
        };
      }),
    });
  }

  const existingCategories = new Set(
    (await prisma.productWallCategory.findMany({ select: { name: true } })).map((row) => row.name),
  );
  const distinctKinds = await prisma.productWallImage.findMany({ distinct: ['kind'], select: { kind: true } });
  const categoryNames = Array.from(
    new Set([...defaultCategories, ...distinctKinds.map((row) => row.kind).filter(Boolean)]),
  );
  const missingCategories = categoryNames.filter((name) => !existingCategories.has(name));
  if (missingCategories.length) {
    const maxCategorySort = await prisma.productWallCategory.aggregate({ _max: { sortOrder: true } });
    await prisma.productWallCategory.createMany({
      data: missingCategories.map((name, index) => ({
        name,
        sortOrder: (maxCategorySort._max.sortOrder ?? -1) + index + 1,
      })),
      skipDuplicates: true,
    });
  }

  const count = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    'SELECT COUNT(*)::int AS count FROM product_wall_images',
  );
  const categoryCount = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    'SELECT COUNT(*)::int AS count FROM product_wall_categories',
  );
  console.log(
    JSON.stringify(
      { ok: true, productWallImages: count[0]?.count ?? 0, productWallCategories: categoryCount[0]?.count ?? 0 },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
