import { create } from 'zustand';

/**
 * 移动端抽屉开合状态（导航抽屉 + 首页分类抽屉）。
 *
 * 放 store 而非组件 state 的原因：open 原先挂在 Layout/Shell/HomePage 组件级 state 上，
 * 每次点菜单按钮整棵页面树 re-render（产品列表等重内容全量 diff），叠加抽屉动画首帧
 * 造成掉帧；改 store 后点击时只有已常驻挂载的抽屉组件自身 re-render（diff 极小），
 * 页面树零参与。action 引用稳定，调用方 `useMobileDrawerStore((s) => s.toggleNav)` 订阅
 * 不会因 store 更新而重渲染（只选了函数）。
 */
interface MobileDrawerState {
  /** 顶部导航抽屉（MobileNavDrawerRenderer） */
  navOpen: boolean;
  /** 首页模型分类抽屉（MobileDrawer） */
  categoryOpen: boolean;
  toggleNav: () => void;
  closeNav: () => void;
  toggleCategory: () => void;
  openCategory: () => void;
  closeCategory: () => void;
}

export const useMobileDrawerStore = create<MobileDrawerState>((set) => ({
  navOpen: false,
  categoryOpen: false,
  toggleNav: () => set((s) => ({ navOpen: !s.navOpen })),
  closeNav: () => set((s) => (s.navOpen ? { navOpen: false } : s)),
  toggleCategory: () => set((s) => (s.categoryOpen ? { categoryOpen: false } : { categoryOpen: true })),
  openCategory: () => set((s) => (s.categoryOpen ? s : { categoryOpen: true })),
  closeCategory: () => set((s) => (s.categoryOpen ? { categoryOpen: false } : s)),
}));
