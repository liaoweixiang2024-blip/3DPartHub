import type { PrismaClient } from '@prisma/client';
import { buildColumnsFromFields, loadBeizeStructure } from './selection-column-config.js';

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

const ROOT_ICON_MAP: Record<string, string> = {
  接头类: 'pneumatic_fitting',
  气动接头类: 'pneumatic_fitting',
  管件及快速接头类: 'cat_ss_pipe',
  阀门类: 'valve',
  清洗及储气装置: 'accessories',
  液压油管接头类: 'iron_hydraulic',
  气管类: 'pipeline',
  润滑油路系列: 'lubrication',
  气动配件优化方案: 'pneumatic',
};

const ROOT_GROUP_ID_MAP: Record<string, string> = {
  接头类: 'beize-01',
  气动接头类: 'beize-01',
  管件及快速接头类: 'beize-08',
  阀门类: 'beize-02',
  清洗及储气装置: 'beize-03',
  液压油管接头类: 'beize-04',
  气管类: 'beize-05',
  润滑油路系列: 'beize-06',
  气动配件优化方案: 'beize-07',
};

const CHILD_ICON_MAP: Record<string, string> = {
  塑料快插接头: 'cat_quick_insert',
  全铜快插接头: 'cat_copper_quick_insert',
  全铜快拧接头: 'cat_copper_quick_screw',
  全铜卡套接头: 'cat_copper_sleeve',
  精品铜接头: 'copper',
  不锈钢快插接头: 'cat_quick_insert',
  不锈钢快拧接头: 'cat_quick_screw',
  不锈钢管件: 'cat_ss_pipe',
  不锈钢快速接头: 'cat_quick_connect',
  不锈钢阀门: 'cat_ss_valve',
  铜阀门: 'cat_copper_valve',
  水枪系列: 'cat_water_gun',
  气枪系列: 'cat_air_gun',
  储气罐: 'air_tank',
  高压喷嘴: 'cat_nozzle',
  竹节管: 'universal_pipe',
  高压油管总成: 'cat_hydraulic_hose',
  彩锌油管接头: 'cat_zinc_hydraulic',
  '油管 / 管卡 / 喉箍': 'cat_crimp_fitting',
  '气管 / 尼龙管 / 双层管 / 螺旋管': 'pipeline',
  公母型快速接头: 'cat_quick_connect',
  润滑配件: 'lubrication',
  压力表系列: 'cat_meter',
  压力开关及数显压力传感器: 'cat_meter',
  台湾金器系列: 'cat_pneumatic_brand',
  气控集成方案: 'cat_air_board',
  'VBA 系列增压器': 'cat_air_combo',
  'ADTV 排水器': 'filter_list',
  '油、气接方案': 'cat_oil_set',
  前置过滤器: 'filter_list',
  '圣戈班密封胶 / 管路螺纹密封系列': 'shield',
  流体兼容性对照表: 'checklist',
};

const CHILD_SLUG_MAP: Record<string, string> = {
  塑料快插接头: 'beize-01-01',
  全铜快插接头: 'beize-01-02',
  全铜快拧接头: 'beize-01-03',
  全铜卡套接头: 'beize-01-04',
  精品铜接头: 'beize-01-05',
  不锈钢快插接头: 'beize-01-06',
  不锈钢快拧接头: 'beize-01-07',
  不锈钢管件: 'beize-01-08',
  不锈钢快速接头: 'beize-01-09',
  不锈钢阀门: 'beize-02-01',
  铜阀门: 'beize-02-02',
  水枪系列: 'beize-03-01',
  气枪系列: 'beize-03-02',
  储气罐: 'beize-03-03',
  高压喷嘴: 'beize-03-04',
  竹节管: 'beize-03-05',
  高压油管总成: 'beize-04-01',
  彩锌油管接头: 'beize-04-02',
  '油管 / 管卡 / 喉箍': 'beize-04-03',
  '气管 / 尼龙管 / 双层管 / 螺旋管': 'beize-05-01',
  公母型快速接头: 'beize-05-02',
  润滑配件: 'beize-06-01',
  压力表系列: 'beize-07-01',
  压力开关及数显压力传感器: 'beize-07-10',
  台湾金器系列: 'beize-07-02',
  气控集成方案: 'beize-07-03',
  'VBA 系列增压器': 'beize-07-04',
  'ADTV 排水器': 'beize-07-05',
  '油、气接方案': 'beize-07-06',
  前置过滤器: 'beize-07-07',
  '圣戈班密封胶 / 管路螺纹密封系列': 'beize-07-08',
  流体兼容性对照表: 'beize-07-09',
};

function buildSelectionSlug(childName: string, groupIndex: number, childIndex: number) {
  return (
    CHILD_SLUG_MAP[childName] ||
    `beize-${String(groupIndex + 1).padStart(2, '0')}-${String(childIndex + 1).padStart(2, '0')}`
  );
}

function buildColumns(fields: string[], categoryName: string) {
  return buildColumnsFromFields(fields, categoryName);
}

function loadStructure(): RawStructure {
  return loadBeizeStructure() as RawStructure;
}

export async function seedBeizeCategories(prisma: PrismaClient): Promise<{ upserted: number }> {
  const structure = loadStructure();
  let upserted = 0;
  let globalIndex = 0;

  for (const [groupIndex, group] of structure.categoryTree.entries()) {
    const groupIcon = ROOT_ICON_MAP[group.name] || 'folder';

    for (const [childIndex, child] of group.children.entries()) {
      const slug = buildSelectionSlug(child.name, groupIndex, childIndex);
      const icon = CHILD_ICON_MAP[child.name] || groupIcon;
      const groupId = ROOT_GROUP_ID_MAP[group.name] || `beize-${String(groupIndex + 1).padStart(2, '0')}`;

      await prisma.selectionCategory.upsert({
        where: { slug },
        create: {
          name: child.name,
          slug,
          description: `${group.name} · ${child.pageRange}`,
          icon,
          sortOrder: globalIndex,
          columns: buildColumns(child.selectionFields, child.name),
          image: null,
          kind: 'product',
          groupId,
          groupName: group.name,
          groupIcon,
        },
        update: {
          name: child.name,
          description: `${group.name} · ${child.pageRange}`,
          icon,
          sortOrder: globalIndex,
          columns: buildColumns(child.selectionFields, child.name),
          kind: 'product',
          groupId,
          groupName: group.name,
          groupIcon,
        },
      });

      upserted += 1;
      globalIndex += 1;
    }
  }

  return { upserted };
}

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const result = await seedBeizeCategories(prisma);
    console.log(`Selection categories upserted: ${result.upserted}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
