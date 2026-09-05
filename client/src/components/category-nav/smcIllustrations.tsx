/**
 * smc_23/code.html 的等距轴测 SVG 插画——逐字节照搬原文件的 <svg> 内容，
 * 仅转成 JSX（属性驼峰化）。每个导出对应一个节点插画，键名 = 原注释编号。
 */

export function AirTankIcon() {
  return (
    <svg className="h-24 w-24 drop-shadow-sm" fill="none" viewBox="0 0 120 120">
      <ellipse cx="36" cy="52" fill="#CAD3DD" rx="8" ry="18" stroke="#374151" strokeWidth="1.5" />
      <rect
        fill="#8B97A4"
        height="36"
        stroke="#374151"
        strokeDasharray="0 36 50 36"
        strokeWidth="1.5"
        width="50"
        x="36"
        y="34"
      />
      <ellipse cx="86" cy="52" fill="#8B97A4" rx="8" ry="18" stroke="#374151" strokeWidth="1.5" />
      <rect fill="#A3AEB9" height="36" width="50" x="36" y="34" />
      <line stroke="#475569" strokeWidth="3" x1="42" x2="38" y1="70" y2="88" />
      <line stroke="#475569" strokeWidth="3" x1="80" x2="84" y1="70" y2="88" />
      <line stroke="#334155" strokeWidth="2" x1="33" x2="88" y1="88" y2="88" />
      <circle cx="61" cy="28" fill="#FFFFFF" r="6" stroke="#374151" strokeWidth="1.5" />
      <line stroke="#DC2626" strokeWidth="1.2" x1="61" x2="65" y1="28" y2="25" />
    </svg>
  );
}

export function ValveIntegrationIcon() {
  return (
    <svg className="h-24 w-24 drop-shadow-sm" fill="none" viewBox="0 0 120 120">
      <polygon fill="#CAD3DD" points="25,45 55,27 95,41 65,59" stroke="#374151" strokeWidth="1.5" />
      <polygon fill="#718096" points="65,59 95,41 95,70 65,85" stroke="#374151" strokeWidth="1.5" />
      <polygon fill="#9BA6B2" points="25,45 65,59 65,85 25,71" stroke="#374151" strokeWidth="1.5" />
      <line stroke="#374151" strokeWidth="1.5" x1="37" x2="37" y1="49" y2="75" />
      <line stroke="#374151" strokeWidth="1.5" x1="49" x2="49" y1="53" y2="79" />
      <circle cx="42" cy="40" fill="#0284C7" r="2.5" />
      <circle cx="54" cy="44" fill="#0284C7" r="2.5" />
      <circle cx="66" cy="48" fill="#0284C7" r="2.5" />
      <rect fill="#334155" height="8" width="12" x="15" y="51" />
    </svg>
  );
}

export function PipingIcon() {
  return (
    <svg className="h-24 w-24 drop-shadow-sm" fill="none" viewBox="0 0 120 120">
      <ellipse cx="60" cy="52" fill="none" rx="36" ry="22" stroke="#0284C7" strokeWidth="7" />
      <ellipse cx="58" cy="50" fill="none" rx="36" ry="22" stroke="#38BDF8" strokeWidth="4" />
      <ellipse cx="56" cy="48" fill="none" rx="36" ry="22" stroke="#64748B" strokeWidth="2" />
      <rect fill="#475569" height="12" rx="2" width="14" x="78" y="58" />
    </svg>
  );
}

export function FittingIcon() {
  return (
    <svg className="h-24 w-24 drop-shadow-sm" fill="none" viewBox="0 0 100 100">
      <path
        d="M50,22 L50,48 L25,48 L25,65 L50,65 L50,88 L65,88 L65,22 Z"
        fill="#9BA6B2"
        stroke="#374151"
        strokeWidth="1.5"
      />
      <ellipse cx="25" cy="56.5" fill="#0284C7" rx="4" ry="8.5" stroke="#0369A1" strokeWidth="1" />
      <ellipse cx="57.5" cy="88" fill="#D97706" rx="7.5" ry="3" stroke="#78350F" strokeWidth="1" />
      <line stroke="#78350F" strokeWidth="1.5" x1="50" x2="65" y1="82" y2="82" />
      <circle cx="57.5" cy="22" fill="#38BDF8" r="5" />
    </svg>
  );
}

export function AirBlowGunIcon() {
  return (
    <svg className="h-24 w-24 drop-shadow-sm" fill="none" viewBox="0 0 100 100">
      <path
        d="M22,35 L62,35 L68,44 L58,48 L32,48 L22,78 L12,74 L20,44 Z"
        fill="#334155"
        stroke="#1E293B"
        strokeWidth="1.5"
      />
      <rect fill="#94A3B8" height="5" rx="1" stroke="#475569" strokeWidth="1" width="32" x="62" y="37" />
      <path d="M38,48 L32,60" stroke="#EF4444" strokeLinecap="round" strokeWidth="3" />
      <line stroke="#0284C7" strokeDasharray="2 2" strokeWidth="2" x1="94" x2="100" y1="39" y2="39" />
    </svg>
  );
}

export function TurnkeySolutionIcon() {
  return (
    <svg className="h-24 w-24 drop-shadow-sm" fill="none" viewBox="0 0 110 100">
      <rect fill="#CBD5E1" height="40" rx="2" stroke="#374151" strokeWidth="1.2" width="75" x="15" y="32" />
      <line stroke="#374151" strokeWidth="2" x1="15" x2="90" y1="52" y2="52" />
      <circle cx="32" cy="52" fill="#38BDF8" r="5" />
      <circle cx="52" cy="52" fill="#38BDF8" r="5" />
      <circle cx="72" cy="52" fill="#38BDF8" r="5" />
      <path d="M20,72 L20,84 M85,72 L85,84" stroke="#475569" strokeWidth="3" />
    </svg>
  );
}

export function CenterWaterIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 80 80">
      <circle cx="40" cy="40" fill="#CAD3DD" r="26" stroke="#374151" strokeWidth="1.5" />
      <circle cx="40" cy="40" fill="#0284C7" r="15" stroke="#0369A1" strokeWidth="1.5" />
      <circle cx="40" cy="40" fill="#FFFFFF" r="6" />
      <line stroke="#475569" strokeWidth="2" x1="40" x2="40" y1="5" y2="14" />
    </svg>
  );
}

export function ManifoldIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 80 80">
      <rect fill="#9BA6B2" height="42" rx="2" stroke="#374151" strokeWidth="1.5" width="50" x="15" y="20" />
      <circle cx="27" cy="35" fill="#38BDF8" r="3.5" />
      <circle cx="40" cy="35" fill="#38BDF8" r="3.5" />
      <circle cx="53" cy="35" fill="#38BDF8" r="3.5" />
      <circle cx="40" cy="52" fill="#D97706" r="4.5" />
    </svg>
  );
}

export function UniversalTubeIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 80 80">
      <path d="M22,65 Q28,45 42,40 T62,20" fill="none" stroke="#0284C7" strokeLinecap="round" strokeWidth="7" />
      <circle cx="30" cy="48" fill="#F59E0B" r="4" />
      <circle cx="45" cy="35" fill="#F59E0B" r="4" />
      <circle cx="60" cy="22" fill="#F59E0B" r="3" />
    </svg>
  );
}

export function PipeConnectionIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 80 80">
      <rect fill="#CAD3DD" height="20" rx="2" stroke="#374151" strokeWidth="1.2" width="34" x="23" y="30" />
      <line stroke="#0284C7" strokeWidth="4" x1="10" x2="23" y1="40" y2="40" />
      <line stroke="#0284C7" strokeWidth="4" x1="57" x2="70" y1="40" y2="40" />
      <circle cx="40" cy="40" fill="#374151" r="3" />
    </svg>
  );
}

export function SprayUnitIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 80 80">
      <polygon fill="#64748B" points="32,25 48,25 56,52 24,52" stroke="#374151" strokeWidth="1.2" />
      <line stroke="#38BDF8" strokeDasharray="2 2" strokeWidth="2" x1="30" x2="22" y1="55" y2="70" />
      <line stroke="#38BDF8" strokeDasharray="2 2" strokeWidth="2" x1="40" x2="40" y1="55" y2="72" />
      <line stroke="#38BDF8" strokeDasharray="2 2" strokeWidth="2" x1="50" x2="58" y1="55" y2="70" />
    </svg>
  );
}

export function WashGunIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 80 80">
      <path
        d="M20,30 L45,30 L50,38 L40,40 L28,40 L24,58 L16,56 L19,38 Z"
        fill="#1E293B"
        stroke="#0F172A"
        strokeWidth="1.2"
      />
      <line stroke="#38BDF8" strokeWidth="3" x1="46" x2="65" y1="32" y2="32" />
      <path d="M65,28 L72,32 L65,36 Z" fill="#0284C7" />
    </svg>
  );
}

export function WaterModuleIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 80 80">
      <rect fill="#CAD3DD" height="36" rx="2" stroke="#374151" strokeWidth="1.2" width="46" x="17" y="22" />
      <rect fill="#38BDF8" height="8" rx="1" width="20" x="24" y="32" />
      <circle cx="53" cy="36" fill="#EF4444" r="3" />
      <line stroke="#475569" strokeWidth="2" x1="22" x2="58" y1="48" y2="48" />
    </svg>
  );
}

export function OilLineIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 80 80">
      <path d="M15,40 C30,25 50,55 65,40" fill="none" stroke="#D97706" strokeLinecap="round" strokeWidth="5" />
      <circle cx="15" cy="40" fill="#475569" r="4" />
      <circle cx="65" cy="40" fill="#475569" r="4" />
    </svg>
  );
}

export function CouplingIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 80 80">
      <polygon fill="#9BA6B2" points="28,32 52,32 46,54 34,54" stroke="#374151" strokeWidth="1.2" />
      <rect fill="#78350F" height="6" width="12" x="34" y="54" />
      <circle cx="40" cy="26" fill="#D97706" r="4" stroke="#374151" strokeWidth="1" />
    </svg>
  );
}

export function HoseBarbIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 80 80">
      {/* 铜黄色工业倒刺宝塔接头 */}
      <rect fill="#B45309" height="12" rx="1" stroke="#78350F" strokeWidth="1" width="20" x="30" y="20" />
      <path
        d="M26,32 L54,32 L48,42 L52,42 L46,52 L50,52 L42,65 L38,65 L30,52 L34,52 L28,42 L32,42 Z"
        fill="#D97706"
        stroke="#78350F"
        strokeWidth="1"
      />
    </svg>
  );
}

export function LubricationIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 80 80">
      <ellipse cx="40" cy="35" fill="#CAD3DD" rx="14" ry="16" stroke="#374151" strokeWidth="1.2" />
      <path d="M40,19 C42,16 48,15 48,15" stroke="#374151" strokeWidth="1.5" />
      <circle cx="40" cy="38" fill="#D97706" r="5" />
      <rect fill="#78350F" height="12" width="6" x="37" y="51" />
    </svg>
  );
}

export function OilKitIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 80 80">
      <rect fill="#8B97A4" height="34" rx="2" stroke="#374151" strokeWidth="1.2" width="46" x="17" y="26" />
      <circle cx="28" cy="38" fill="#D97706" r="4" />
      <circle cx="40" cy="38" fill="#D97706" r="4" />
      <circle cx="52" cy="38" fill="#D97706" r="4" />
      <line stroke="#D1D5DB" strokeWidth="2" x1="22" x2="58" y1="50" y2="50" />
    </svg>
  );
}

export function ValveIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 70 80">
      <polygon fill="#64748B" points="15,30 35,42 15,54" stroke="#374151" strokeWidth="1.2" />
      <polygon fill="#64748B" points="55,30 35,42 55,54" stroke="#374151" strokeWidth="1.2" />
      <circle cx="35" cy="42" fill="#EF4444" r="4" />
      <line stroke="#374151" strokeWidth="2" x1="35" x2="35" y1="42" y2="20" />
      <circle cx="35" cy="18" fill="#EF4444" r="6" />
    </svg>
  );
}

export function GaugeIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 70 80">
      <circle cx="35" cy="35" fill="#FFFFFF" r="18" stroke="#374151" strokeWidth="1.5" />
      <circle cx="35" cy="35" fill="none" r="14" stroke="#94A3B8" strokeWidth="1" />
      <line stroke="#EF4444" strokeWidth="1.5" x1="35" x2="44" y1="35" y2="27" />
      <rect fill="#374151" height="10" width="6" x="32" y="53" />
    </svg>
  );
}

export function CopperBarbIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 70 80">
      <path
        d="M24,30 L46,30 L42,39 L46,39 L40,49 L44,49 L36,60 L34,60 L26,49 L30,49 L24,39 L28,39 Z"
        fill="#D97706"
        stroke="#78350F"
        strokeWidth="1"
      />
      <rect fill="#92400E" height="8" stroke="#78350F" strokeWidth="1" width="16" x="27" y="22" />
    </svg>
  );
}

export function SheetMetalIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 70 80">
      <polygon fill="#CAD3DD" points="15,35 45,20 60,32 30,47" stroke="#374151" strokeWidth="1.2" />
      <polygon fill="#9BA6B2" points="30,47 60,32 60,48 30,63" stroke="#374151" strokeWidth="1.2" />
      <polygon fill="#718096" points="15,35 30,47 30,63 15,51" stroke="#374151" strokeWidth="1.2" />
      <circle cx="35" cy="35" fill="#374151" r="2" />
    </svg>
  );
}

export function MiscIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 70 80">
      <rect fill="#F1F5F9" height="38" rx="2" stroke="#64748B" strokeWidth="1.2" width="30" x="20" y="22" />
      <line stroke="#94A3B8" strokeWidth="1.5" x1="25" x2="45" y1="32" y2="32" />
      <line stroke="#94A3B8" strokeWidth="1.5" x1="25" x2="45" y1="40" y2="40" />
      <line stroke="#94A3B8" strokeWidth="1.5" x1="25" x2="38" y1="48" y2="48" />
    </svg>
  );
}

/* ───────────────────────── smc_tab/code.html 插画（选型 Tab）───────────────────────── */

/** 顶排 2：组合型过滤调压三联件 + 监测压力表（净化与监测） */
export function FrlMonitorIcon() {
  return (
    <svg className="h-24 w-24 drop-shadow-sm" fill="none" viewBox="0 0 120 120">
      <rect fill="#9BA6B2" height="40" rx="2" stroke="#374151" strokeWidth="1.5" width="22" x="30" y="38" />
      <rect fill="#64748B" height="16" rx="1" width="18" x="32" y="78" />
      <rect fill="#CAD3DD" height="40" rx="2" stroke="#374151" strokeWidth="1.5" width="22" x="58" y="38" />
      <rect fill="#64748B" height="16" rx="1" width="18" x="60" y="78" />
      <line stroke="#0284C7" strokeWidth="4" x1="22" x2="30" y1="48" y2="48" />
      <line stroke="#0284C7" strokeWidth="4" x1="80" x2="88" y1="48" y2="48" />
      {/* 顶部圆形压力表与开关 */}
      <circle cx="41" cy="26" fill="#FFFFFF" r="10" stroke="#374151" strokeWidth="1.5" />
      <line stroke="#DC2626" strokeWidth="1.5" x1="41" x2="46" y1="26" y2="21" />
      <circle cx="69" cy="28" fill="#0284C7" r="4" stroke="#0369A1" strokeWidth="1" />
    </svg>
  );
}

/** 顶排 4：气管与快插锁紧卡套接头 */
export function TubeQuickFittingIcon() {
  return (
    <svg className="h-24 w-24 drop-shadow-sm" fill="none" viewBox="0 0 120 120">
      <ellipse cx="60" cy="50" fill="none" rx="35" ry="22" stroke="#0284C7" strokeWidth="7" />
      <ellipse cx="58" cy="48" fill="none" rx="35" ry="22" stroke="#38BDF8" strokeWidth="4" />
      <ellipse cx="56" cy="46" fill="none" rx="35" ry="22" stroke="#64748B" strokeWidth="2" />
      {/* 快插锁紧卡套接头 */}
      <rect fill="#475569" height="14" rx="2" width="16" x="76" y="54" />
      <circle cx="84" cy="61" fill="#38BDF8" r="3" />
    </svg>
  );
}

/** 冷却 2：高压喷嘴（蓝色虚线喷淋） */
export function HighPressureNozzleIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 80 80">
      <polygon fill="#64748B" points="30,24 50,24 58,52 22,52" stroke="#374151" strokeWidth="1.2" />
      <line stroke="#0284C7" strokeDasharray="2 2" strokeWidth="2.5" x1="28" x2="18" y1="55" y2="72" />
      <line stroke="#0284C7" strokeDasharray="2 2" strokeWidth="2.5" x1="40" x2="40" y1="55" y2="74" />
      <line stroke="#0284C7" strokeDasharray="2 2" strokeWidth="2.5" x1="52" x2="62" y1="55" y2="72" />
    </svg>
  );
}

/** 冷却 4：阀门（红色手柄球阀） */
export function BallValveIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 80 80">
      <polygon fill="#64748B" points="20,30 40,42 20,54" stroke="#374151" strokeWidth="1.2" />
      <polygon fill="#64748B" points="60,30 40,42 60,54" stroke="#374151" strokeWidth="1.2" />
      <circle cx="40" cy="42" fill="#EF4444" r="4.5" />
      <line stroke="#374151" strokeWidth="2.5" x1="40" x2="40" y1="42" y2="20" />
      <ellipse cx="40" cy="18" fill="#EF4444" rx="7" ry="3" />
    </svg>
  );
}

/** 液压 1：油管总成与接头（橙色软管曲线 + 深灰接头） */
export function HoseAssemblyIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 80 80">
      <path d="M15,40 C28,24 52,56 65,40" fill="none" stroke="#D97706" strokeLinecap="round" strokeWidth="6" />
      <circle cx="15" cy="40" fill="#334155" r="4.5" />
      <circle cx="65" cy="40" fill="#334155" r="4.5" />
      <rect fill="#78350F" height="8" rx="1" width="12" x="34" y="46" />
    </svg>
  );
}

/** 通用 2：O 型密封圈与技术文档手册（密封与资料） */
export function SealDocIcon() {
  return (
    <svg className="h-20 w-20 drop-shadow-sm" fill="none" viewBox="0 0 80 80">
      <circle cx="32" cy="44" fill="none" r="14" stroke="#334155" strokeWidth="4" />
      <circle cx="32" cy="44" fill="none" r="18" stroke="#0284C7" strokeWidth="1.5" />
      <rect fill="#F8FAFC" height="36" rx="2" stroke="#475569" strokeWidth="1.2" width="26" x="42" y="22" />
      <line stroke="#0284C7" strokeWidth="1.5" x1="47" x2="63" y1="30" y2="30" />
      <line stroke="#94A3B8" strokeWidth="1.2" x1="47" x2="63" y1="36" y2="36" />
      <line stroke="#94A3B8" strokeWidth="1.2" x1="47" x2="58" y1="42" y2="42" />
    </svg>
  );
}
