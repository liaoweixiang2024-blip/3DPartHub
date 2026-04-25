export type BeizeSelectionKind = "product" | "solution" | "knowledge";
export type BeizeDetailTemplateKey = "fitting" | "cleaning" | "pneumatic" | "sealant";

export interface BeizeSelectionChild {
  slug: string;
  name: string;
  icon: string;
  pageRange: string;
  selectionFields: string[];
  kind: BeizeSelectionKind;
  detailTemplate: BeizeDetailTemplateKey;
  exampleModels?: string[];
}

export interface BeizeSelectionGroup {
  id: string;
  name: string;
  icon: string;
  pageRange: string;
  children: BeizeSelectionChild[];
}

type RawSelectionChild = Omit<BeizeSelectionChild, "slug">;
type RawSelectionGroup = Omit<BeizeSelectionGroup, "id" | "children"> & {
  children: RawSelectionChild[];
};

function buildSelectionSlug(groupIndex: number, childIndex: number) {
  return `beize-${String(groupIndex + 1).padStart(2, "0")}-${String(childIndex + 1).padStart(2, "0")}`;
}

const rawGroups: RawSelectionGroup[] = [
  {
    name: "接头类",
    icon: "pneumatic_fitting",
    pageRange: "P01-162",
    children: [
      { name: "塑料快插接头", icon: "cat_quick_insert", pageRange: "P01-49", selectionFields: ["接头形态", "适用管外径", "螺纹规格", "螺纹类型", "材质", "颜色", "适用介质"], kind: "product", detailTemplate: "fitting" },
      { name: "全铜快插接头", icon: "cat_copper_quick_insert", pageRange: "P50-66", selectionFields: ["接头形态", "适用管外径", "螺纹规格", "螺纹类型", "表面处理", "材质"], kind: "product", detailTemplate: "fitting" },
      { name: "全铜快拧接头", icon: "cat_copper_quick_screw", pageRange: "P67-73", selectionFields: ["接头形态", "适用管外径", "螺纹规格", "螺纹类型", "材质"], kind: "product", detailTemplate: "fitting" },
      { name: "全铜卡套接头", icon: "cat_copper_sleeve", pageRange: "P74-79", selectionFields: ["接头形态", "卡套规格", "螺纹规格", "螺纹类型", "材质"], kind: "product", detailTemplate: "fitting" },
      { name: "精品铜接头", icon: "copper", pageRange: "P80-89", selectionFields: ["接头形态", "规格", "螺纹", "材质"], kind: "product", detailTemplate: "fitting" },
      { name: "不锈钢快插接头", icon: "cat_quick_insert", pageRange: "P90-99", selectionFields: ["接头形态", "适用管外径", "螺纹规格", "材质304/316", "适用介质"], kind: "product", detailTemplate: "fitting" },
      { name: "不锈钢快拧接头", icon: "cat_quick_screw", pageRange: "P100-105", selectionFields: ["接头形态", "适用管外径", "螺纹规格", "材质", "适用介质"], kind: "product", detailTemplate: "fitting" },
      { name: "不锈钢管件", icon: "cat_ss_pipe", pageRange: "P106-154", selectionFields: ["管件形态", "内外牙形式", "螺纹规格", "通径", "螺纹类型", "材质"], kind: "product", detailTemplate: "fitting" },
      { name: "不锈钢快速接头", icon: "cat_quick_connect", pageRange: "P155-162", selectionFields: ["接头类型", "公母头", "接口规格", "通径", "材质"], kind: "product", detailTemplate: "fitting" },
    ],
  },
  {
    name: "阀门类",
    icon: "valve",
    pageRange: "P163-192",
    children: [
      { name: "不锈钢阀门", icon: "cat_ss_valve", pageRange: "P163-180", selectionFields: ["阀门类型", "螺纹规格", "通径", "材质", "手柄形式", "介质"], kind: "product", detailTemplate: "fitting" },
      { name: "铜阀门", icon: "cat_copper_valve", pageRange: "P181-192", selectionFields: ["阀门类型", "螺纹规格", "通径", "材质", "手柄形式"], kind: "product", detailTemplate: "fitting" },
    ],
  },
  {
    name: "清洗及储气装置",
    icon: "accessories",
    pageRange: "P193-227",
    children: [
      { name: "水枪系列", icon: "cat_water_gun", pageRange: "P193-194", selectionFields: ["枪体类型", "前段选配", "配管长度", "尾段弹簧护套", "球阀开关", "接口尺寸"], kind: "product", detailTemplate: "cleaning" },
      { name: "气枪系列", icon: "cat_air_gun", pageRange: "P195-196", selectionFields: ["枪体类型", "接口尺寸", "喷嘴长度", "配管长度", "压力范围"], kind: "product", detailTemplate: "cleaning" },
      { name: "储气罐", icon: "air_tank", pageRange: "P197-198", selectionFields: ["安装方式", "罐体材质", "容积", "储气罐配件", "进出口"], kind: "product", detailTemplate: "cleaning" },
      { name: "高压喷嘴", icon: "cat_nozzle", pageRange: "P199-220", selectionFields: ["喷射角度", "喷孔孔径", "连接螺纹", "材质", "适用压力"], kind: "product", detailTemplate: "cleaning" },
      { name: "竹节管", icon: "universal_pipe", pageRange: "P221-227", selectionFields: ["管径", "长度", "段数", "底座形式", "喷嘴形式", "颜色"], kind: "product", detailTemplate: "cleaning" },
    ],
  },
  {
    name: "液压油管接头类",
    icon: "iron_hydraulic",
    pageRange: "P228-251",
    children: [
      { name: "布面油管系列", icon: "cat_hydraulic_hose", pageRange: "P228-231", selectionFields: ["内径", "外径", "长度", "耐压等级", "两端接头形式"], kind: "product", detailTemplate: "cleaning" },
      { name: "彩锌油管接头", icon: "cat_zinc_hydraulic", pageRange: "P232-245", selectionFields: ["接头形态", "螺纹规格", "螺纹类型", "适配油管规格", "表面处理"], kind: "product", detailTemplate: "cleaning" },
      { name: "油管 / 管卡 / 喉箍", icon: "cat_crimp_fitting", pageRange: "P246-251", selectionFields: ["类型", "尺寸范围", "材质", "安装方式"], kind: "product", detailTemplate: "cleaning" },
    ],
  },
  {
    name: "气管类",
    icon: "pipeline",
    pageRange: "P252-270",
    children: [
      { name: "气管 / 尼龙管 / 双层管 / 螺旋管", icon: "pipeline", pageRange: "P252-264", selectionFields: ["管材类型", "外径", "内径", "颜色", "长度", "工作压力"], kind: "product", detailTemplate: "cleaning" },
      { name: "公母型快速接头", icon: "cat_quick_connect", pageRange: "P265-270", selectionFields: ["公头/母头", "分路数量", "接口尺寸", "是否带管", "主体尺寸"], kind: "product", detailTemplate: "cleaning" },
    ],
  },
  {
    name: "润滑油路系列",
    icon: "lubrication",
    pageRange: "P271-286",
    children: [
      { name: "润滑配件", icon: "lubrication", pageRange: "P271-286", selectionFields: ["配件类型", "出油口数", "排量", "接口尺寸", "适用油品", "安装方式"], kind: "product", detailTemplate: "cleaning" },
    ],
  },
  {
    name: "气动配件优化方案",
    icon: "pneumatic",
    pageRange: "P287-338",
    children: [
      { name: "压力表系列", icon: "cat_meter", pageRange: "P287-295", selectionFields: ["量程", "表盘尺寸", "接口螺纹", "安装方向", "是否充油"], kind: "product", detailTemplate: "pneumatic" },
      { name: "台湾金器系列", icon: "cat_pneumatic_brand", pageRange: "P296-313", selectionFields: ["组件类型", "接口口径", "电压", "动作方式", "是否带传感/电磁阀"], kind: "product", detailTemplate: "pneumatic" },
      { name: "气控集成方案", icon: "cat_air_board", pageRange: "P314-317", selectionFields: ["方案型号", "工位数", "输入口尺寸", "输出口尺寸", "是否带过滤减压", "应用场景"], kind: "solution", detailTemplate: "pneumatic", exampleModels: ["KAC-04TV", "KAC-02-T", "KAC-03TV-300L", "KAC-03TV-302"] },
      { name: "VBA 系列增压器", icon: "cat_air_combo", pageRange: "P318-324", selectionFields: ["主体尺寸", "配管口径", "螺纹种类", "增压比", "可选项", "配套气罐"], kind: "product", detailTemplate: "pneumatic" },
      { name: "ADTV 排水器", icon: "filter_list", pageRange: "P325-326", selectionFields: ["入口尺寸", "出口尺寸", "壳体材质", "工作压力", "工作温度", "排放量"], kind: "product", detailTemplate: "pneumatic", exampleModels: ["ADTV-50A", "ADTV-50U"] },
      { name: "油、气接方案", icon: "cat_oil_set", pageRange: "P327-328", selectionFields: ["方案型号", "机型", "接口布局", "模块类型", "外形尺寸"], kind: "solution", detailTemplate: "pneumatic", exampleModels: ["KOKFM-1", "KOKFM-2"] },
      { name: "前置过滤器", icon: "filter_list", pageRange: "P329-330", selectionFields: ["外径", "长度", "锁紧方式", "目数/微米", "材质", "流量"], kind: "product", detailTemplate: "pneumatic", exampleModels: ["KOMG-89-125A", "KOMG-89-125B"] },
      { name: "圣戈班密封胶 / 管路螺纹密封系列", icon: "shield", pageRange: "P331-334", selectionFields: ["胶型号", "化学类型", "最大锁牙尺寸", "工作温度", "粘度", "包装"], kind: "product", detailTemplate: "sealant", exampleModels: ["TEK 565", "TEK 567", "TEK 074", "TEK 545"] },
      { name: "流体兼容性对照表", icon: "checklist", pageRange: "P335-338", selectionFields: ["流体名称", "软管兼容性", "密封件兼容性", "金属兼容性"], kind: "knowledge", detailTemplate: "sealant" },
    ],
  },
];

export const beizeSelectionCommonSpecs = [
  "型号",
  "系列",
  "材质",
  "连接形式",
  "接口规格",
  "螺纹类型",
  "适用管径",
  "工作压力",
  "温度范围",
  "适用介质",
];

export const beizeDetailTemplates: Record<BeizeDetailTemplateKey, string[]> = {
  fitting: [
    "型号",
    "产品系列",
    "连接形态",
    "材质",
    "管径 / 通径",
    "螺纹规格",
    "螺纹类型",
    "尺寸图",
    "参数表",
    "适用介质",
    "温度范围",
    "工作压力",
  ],
  cleaning: [
    "型号",
    "枪体 / 喷嘴 / 管路类型",
    "接口规格",
    "配管长度",
    "喷射角度 / 枪嘴形式",
    "工作压力",
    "适用介质",
    "安装方式",
    "外形尺寸",
  ],
  pneumatic: [
    "型号",
    "组件类型",
    "方案说明",
    "输入口尺寸",
    "输出口尺寸",
    "工位数 / 分路数",
    "电压或控制方式",
    "外形尺寸",
    "适用设备",
    "订购编码规则",
  ],
  sealant: [
    "型号",
    "化学类型",
    "适用场景",
    "最大锁牙尺寸",
    "工作温度",
    "粘度",
    "触变性 / 拆卸强度",
    "包装规格",
  ],
};

export const beizeSelectionGroups: BeizeSelectionGroup[] = rawGroups.map((group, groupIndex) => ({
  ...group,
  id: `beize-group-${String(groupIndex + 1).padStart(2, "0")}`,
  children: group.children.map((child, childIndex) => ({
    ...child,
    slug: buildSelectionSlug(groupIndex, childIndex),
  })),
}));

export const beizeAllSelectionChildren = beizeSelectionGroups.flatMap((group) =>
  group.children.map((child) => ({
    ...child,
    parentId: group.id,
    parentName: group.name,
    parentIcon: group.icon,
    parentPageRange: group.pageRange,
  }))
);

export const beizeSelectionBySlug = Object.fromEntries(
  beizeAllSelectionChildren.map((child) => [child.slug, child])
) as Record<string, (typeof beizeAllSelectionChildren)[number]>;
