/**
 * 分类选型导航默认插画注册表（前后台共享）。
 *
 * 节点配置里的 `iconKey` 指向这里的 key：默认插画因此**写进节点、跟节点走**——
 * 后台调换节点顺序时插画跟着换位，而不是留在原卡位。未设置 iconKey 的旧节点
 * 由前台回退「卡位下标默认插画」（与历史渲染一致），后台打开编辑时会自动回填。
 */
import type { ComponentType } from 'react';
import {
  AirBlowGunIcon,
  AirTankIcon,
  CenterWaterIcon,
  CopperBarbIcon,
  CouplingIcon,
  FittingIcon,
  GaugeIcon,
  HoseBarbIcon,
  LubricationIcon,
  ManifoldIcon,
  MiscIcon,
  OilKitIcon,
  OilLineIcon,
  PipeConnectionIcon,
  PipingIcon,
  SheetMetalIcon,
  SprayUnitIcon,
  TurnkeySolutionIcon,
  UniversalTubeIcon,
  ValveIcon,
  ValveIntegrationIcon,
  WashGunIcon,
  WaterModuleIcon,
} from '../components/category-nav/smcIllustrations';

/** 默认插画注册表：key 持久化到节点 iconKey（只收 GROUP_SLOTS 实际用到的 23 张） */
export const NAV_ICON_COMPONENTS: Record<string, ComponentType> = {
  air_tank: AirTankIcon,
  valve_integration: ValveIntegrationIcon,
  piping: PipingIcon,
  fitting: FittingIcon,
  air_blow_gun: AirBlowGunIcon,
  turnkey_solution: TurnkeySolutionIcon,
  center_water: CenterWaterIcon,
  manifold: ManifoldIcon,
  universal_tube: UniversalTubeIcon,
  pipe_connection: PipeConnectionIcon,
  spray_unit: SprayUnitIcon,
  wash_gun: WashGunIcon,
  water_module: WaterModuleIcon,
  oil_line: OilLineIcon,
  coupling: CouplingIcon,
  hose_barb: HoseBarbIcon,
  lubrication: LubricationIcon,
  oil_kit: OilKitIcon,
  valve: ValveIcon,
  gauge: GaugeIcon,
  copper_barb: CopperBarbIcon,
  sheet_metal: SheetMetalIcon,
  misc: MiscIcon,
};

/** 各大类卡位的默认插画 key（按卡位顺序；后台给缺 iconKey 的节点按此回填） */
export const GROUP_DEFAULT_ICON_KEYS: Record<string, string[]> = {
  air: ['air_tank', 'valve_integration', 'piping', 'fitting', 'air_blow_gun', 'turnkey_solution'],
  cooling: ['center_water', 'manifold', 'universal_tube', 'pipe_connection', 'spray_unit', 'wash_gun', 'water_module'],
  oil: ['oil_line', 'coupling', 'hose_barb', 'lubrication', 'oil_kit'],
  common: ['valve', 'gauge', 'copper_barb', 'sheet_metal', 'misc'],
};
