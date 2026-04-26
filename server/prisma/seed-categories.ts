import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categories = [
  { name: "不锈钢接头", icon: "stainless_steel", sortOrder: 0, children: ["304焊直通", "不锈钢管件", "卡套接头", "快拧接头", "快插接头", "快速接头", "环喷", "高压喷嘴"] },
  { name: "铁&液压接头", icon: "iron_hydraulic", sortOrder: 1, children: ["中心出水", "分流块", "宝塔", "彩锌液压件", "快速接头", "白锌液压件", "碳钢接头", "铁管件"] },
  { name: "铜接头", icon: "copper", sortOrder: 2, children: ["铜卡套", "铜宝塔", "铜快拧", "铜快插"] },
  { name: "气动元件", icon: "pneumatic", sortOrder: 3, children: ["SMC组件", "亚德客组件", "通用组件", "气枪", "费斯托组件", "金器组件"] },
  { name: "组装成品类", icon: "assembly", sortOrder: 4, children: ["SMC气动模块", "储气罐套装", "气动组合", "气控模块", "气控集成板", "气枪套装", "水枪套装", "水路模组", "油路套装", "费斯托气动模块", "零配件组装", "高压油管总成"] },
  { name: "阀门", icon: "valve", sortOrder: 5, children: ["不锈钢阀门", "铜阀门"] },
  { name: "配件", icon: "accessories", sortOrder: 6, children: ["仪表", "拖链类", "水枪", "油管扣压接头", "钣金", "高压油管"] },
  { name: "万向管", icon: "universal_pipe", sortOrder: 7 },
  { name: "储气罐", icon: "air_tank", sortOrder: 8 },
  { name: "气动接头", icon: "pneumatic_fitting", sortOrder: 9 },
  { name: "润滑配件", icon: "lubrication", sortOrder: 10 },
  { name: "管道", icon: "pipeline", sortOrder: 11 },
  { name: "其他辅料", icon: "other_materials", sortOrder: 12 },
];

async function seed() {
  console.log("Seeding categories...");

  for (const cat of categories) {
    const parent = await prisma.category.upsert({
      where: { id: cat.name },
      update: { name: cat.name, icon: cat.icon, sortOrder: cat.sortOrder },
      create: { id: cat.name, name: cat.name, icon: cat.icon, sortOrder: cat.sortOrder },
    });

    if (cat.children) {
      for (let i = 0; i < cat.children.length; i++) {
        const childName = cat.children[i];
        await prisma.category.upsert({
          where: { id: `${cat.name}_${childName}` },
          update: { name: childName, sortOrder: i },
          create: { id: `${cat.name}_${childName}`, name: childName, parentId: parent.id, sortOrder: i },
        });
      }
    }
  }

  const count = await prisma.category.count();
  console.log(`Done! ${count} categories seeded.`);
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
