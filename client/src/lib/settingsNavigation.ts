export interface SettingModule {
  key: string;
  title: string;
  desc: string;
  icon: string;
  tabTitles: string[];
}

export const SETTINGS_MODULES: SettingModule[] = [
  {
    key: 'basic',
    title: '基础设置',
    desc: '站点品牌、外观主题、公告、菜单和法律条款。',
    icon: 'tune',
    tabTitles: ['站点与品牌', '外观与主题', '系统公告', '菜单配置', '法律条款'],
  },
  {
    key: 'access',
    title: '访问与安全',
    desc: '登录注册、弹窗登录、页面访问、防盗链与账号安全规则。',
    icon: 'shield',
    tabTitles: ['访问控制', '安全防护'],
  },
  {
    key: 'content',
    title: '业务内容',
    desc: '下载分享、3D 预览、产品选型、询价工单和上传限制。',
    icon: 'inventory_2',
    tabTitles: ['下载与分享', '3D 预览', '选型设置', '业务字典', '上传与限制', '邮件服务'],
  },
  {
    key: 'storage',
    title: '缓存与云存储',
    desc: 'Redis、对象存储、资源目录、本地云端同步和图片优化。',
    icon: 'storage',
    tabTitles: [
      'Redis 与页面缓存',
      '对象存储服务商',
      '资源目录与访问策略',
      '本地与云同步',
      '图片与资源优化',
      '缓存清理',
    ],
  },
  {
    key: 'operations',
    title: '运维维护',
    desc: '维护页、转换队列和备份恢复。',
    icon: 'build',
    tabTitles: ['系统运维', '数据备份'],
  },
];
