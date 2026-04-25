import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const prisma = new PrismaClient();

type RawStructure = {
  commonSpecs: string[];
  categoryTree: Array<{
    name: string;
    pageRange: string;
    children: Array<{
      name: string;
      pageRange: string;
      selectionFields: string[];
      exampleModels?: string[];
    }>;
  }>;
};

type ColumnDef = {
  key: string;
  label: string;
  unit: string;
};

const ROOT_ICON_MAP: Record<string, string> = {
  "接头类": "pneumatic_fitting",
  "阀门类": "valve",
  "清洗及储气装置": "accessories",
  "液压油管接头类": "iron_hydraulic",
  "气管类": "pipeline",
  "润滑油路系列": "lubrication",
  "气动配件优化方案": "pneumatic",
};

const CHILD_ICON_MAP: Record<string, string> = {
  "塑料快插接头": "cat_quick_insert",
  "全铜快插接头": "cat_copper_quick_insert",
  "全铜快拧接头": "cat_copper_quick_screw",
  "全铜卡套接头": "cat_copper_sleeve",
  "精品铜接头": "copper",
  "不锈钢快插接头": "cat_quick_insert",
  "不锈钢快拧接头": "cat_quick_screw",
  "不锈钢管件": "cat_ss_pipe",
  "不锈钢快速接头": "cat_quick_connect",
  "不锈钢阀门": "cat_ss_valve",
  "铜阀门": "cat_copper_valve",
  "水枪系列": "cat_water_gun",
  "气枪系列": "cat_air_gun",
  "储气罐": "air_tank",
  "高压喷嘴": "cat_nozzle",
  "竹节管": "universal_pipe",
  "布面油管系列": "cat_hydraulic_hose",
  "彩锌油管接头": "cat_zinc_hydraulic",
  "油管 / 管卡 / 喉箍": "cat_crimp_fitting",
  "气管 / 尼龙管 / 双层管 / 螺旋管": "pipeline",
  "公母型快速接头": "cat_quick_connect",
  "润滑配件": "lubrication",
  "压力表系列": "cat_meter",
  "台湾金器系列": "cat_pneumatic_brand",
  "气控集成方案": "cat_air_board",
  "VBA 系列增压器": "cat_air_combo",
  "ADTV 排水器": "filter_list",
  "油、气接方案": "cat_oil_set",
  "前置过滤器": "filter_list",
  "圣戈班密封胶 / 管路螺纹密封系列": "shield",
  "流体兼容性对照表": "checklist",
};

function buildSelectionSlug(groupIndex: number, childIndex: number) {
  return `beize-${String(groupIndex + 1).padStart(2, "0")}-${String(childIndex + 1).padStart(2, "0")}`;
}

function buildColumns(fields: string[]): ColumnDef[] {
  return [
    { key: "型号", label: "型号", unit: "" },
    ...fields.map((field) => ({
      key: field,
      label: field,
      unit: "",
    })),
  ];
}

function loadStructure(): RawStructure {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const structurePath = resolve(__dirname, "../../docs/北泽选型结构.json");
  return JSON.parse(readFileSync(structurePath, "utf-8")) as RawStructure;
}

async function seedSelectionCategories(structure: RawStructure) {
  let upserted = 0;
  let globalIndex = 0;

  for (const [groupIndex, group] of structure.categoryTree.entries()) {
    const groupIcon = ROOT_ICON_MAP[group.name] || "folder";

    for (const [childIndex, child] of group.children.entries()) {
      const slug = buildSelectionSlug(groupIndex, childIndex);
      const icon = CHILD_ICON_MAP[child.name] || groupIcon;

      await prisma.selectionCategory.upsert({
        where: { slug },
        create: {
          name: child.name,
          slug,
          description: `${group.name} · ${child.pageRange}`,
          icon,
          sortOrder: globalIndex,
          columns: buildColumns(child.selectionFields),
          image: null,
        },
        update: {
          name: child.name,
          description: `${group.name} · ${child.pageRange}`,
          icon,
          sortOrder: globalIndex,
          columns: buildColumns(child.selectionFields),
        },
      });

      upserted += 1;
      globalIndex += 1;
    }
  }

  return { upserted };
}

async function main() {
  const structure = loadStructure();
  console.log("Seeding Beize selection categories...");
  const selectionResult = await seedSelectionCategories(structure);

  console.log("Selection categories:");
  console.log(`  upserted rows: ${selectionResult.upserted}`);
  console.log(
    `  total structure categories: ${structure.categoryTree.reduce((sum, group) => sum + group.children.length, 0)}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
