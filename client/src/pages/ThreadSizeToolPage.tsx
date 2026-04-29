import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import Icon from "../components/shared/Icon";
import { AdminPageShell } from "../components/shared/AdminPageShell";
import { AdminContentPanel, AdminManagementPage } from "../components/shared/AdminManagementPage";

type ThreadFamily = "metric" | "metricH" | "metricA" | "metricC" | "g" | "r" | "npt" | "jic";
type ToolTab = "thread" | "pipe" | "hose";

interface ThreadSpec {
  family: ThreadFamily;
  familyLabel: string;
  size: string;
  majorMm: number;
  pitchMm?: number;
  tpi?: number;
  seal: string;
  note: string;
}

interface PipeSpec {
  dn: string;
  inch: string;
  odMm: number;
  commonUse: string;
}

interface HoseSpec {
  kind?: "液压油管" | "气管";
  dash: string;
  nominalInch: string;
  innerMm: number;
  outerRangeMm: string;
  pressureMpa: string;
  jic: string;
  commonUse: string;
}

const THREADS: ThreadSpec[] = [
  { family: "metric", familyLabel: "M 公制", size: "M3×0.5", majorMm: 3, pitchMm: 0.5, seal: "直螺纹", note: "小型传感器、微型接头" },
  { family: "metric", familyLabel: "M 公制", size: "M4×0.7", majorMm: 4, pitchMm: 0.7, seal: "直螺纹", note: "小型固定接口" },
  { family: "metric", familyLabel: "M 公制", size: "M5×0.8", majorMm: 5, pitchMm: 0.8, seal: "直螺纹", note: "小型接头、传感器接口" },
  { family: "metric", familyLabel: "M 公制", size: "M6×1", majorMm: 6, pitchMm: 1, seal: "直螺纹", note: "小型固定接口" },
  { family: "metric", familyLabel: "M 公制", size: "M8×1.25", majorMm: 8, pitchMm: 1.25, seal: "直螺纹", note: "小型接头" },
  { family: "metric", familyLabel: "M 公制", size: "M10×1", majorMm: 10, pitchMm: 1, seal: "直螺纹", note: "细牙接头" },
  { family: "metric", familyLabel: "M 公制", size: "M12×1.5", majorMm: 12, pitchMm: 1.5, seal: "直螺纹", note: "常见液压/气动接口" },
  { family: "metric", familyLabel: "M 公制", size: "M14×1.5", majorMm: 14, pitchMm: 1.5, seal: "直螺纹", note: "常见接头接口" },
  { family: "metric", familyLabel: "M 公制", size: "M16×1.5", majorMm: 16, pitchMm: 1.5, seal: "直螺纹", note: "常见液压接口" },
  { family: "metric", familyLabel: "M 公制", size: "M18×1.5", majorMm: 18, pitchMm: 1.5, seal: "直螺纹", note: "中型接头" },
  { family: "metric", familyLabel: "M 公制", size: "M20×1.5", majorMm: 20, pitchMm: 1.5, seal: "直螺纹", note: "中型液压接口" },
  { family: "metric", familyLabel: "M 公制", size: "M22×1.5", majorMm: 22, pitchMm: 1.5, seal: "直螺纹", note: "中型接头" },
  { family: "metric", familyLabel: "M 公制", size: "M24×1.5", majorMm: 24, pitchMm: 1.5, seal: "直螺纹", note: "中大型接头" },
  { family: "metric", familyLabel: "M 公制", size: "M27×2", majorMm: 27, pitchMm: 2, seal: "直螺纹", note: "中大型接口" },
  { family: "metric", familyLabel: "M 公制", size: "M30×2", majorMm: 30, pitchMm: 2, seal: "直螺纹", note: "大型接口" },
  { family: "metric", familyLabel: "M 公制", size: "M32×2", majorMm: 32, pitchMm: 2, seal: "直螺纹", note: "大型液压/机械接口" },
  { family: "metric", familyLabel: "M 公制", size: "M33×2", majorMm: 33, pitchMm: 2, seal: "直螺纹", note: "大型液压接口" },
  { family: "metric", familyLabel: "M 公制", size: "M36×3", majorMm: 36, pitchMm: 3, seal: "直螺纹", note: "大型接口" },
  { family: "metric", familyLabel: "M 公制", size: "M39×3", majorMm: 39, pitchMm: 3, seal: "直螺纹", note: "大型接口" },
  { family: "metric", familyLabel: "M 公制", size: "M42×3", majorMm: 42, pitchMm: 3, seal: "直螺纹", note: "大型接口" },
  { family: "metric", familyLabel: "M 公制", size: "M45×3", majorMm: 45, pitchMm: 3, seal: "直螺纹", note: "大型接口" },
  { family: "metric", familyLabel: "M 公制", size: "M48×3", majorMm: 48, pitchMm: 3, seal: "直螺纹", note: "大型接口" },
  { family: "metric", familyLabel: "M 公制", size: "M52×3", majorMm: 52, pitchMm: 3, seal: "直螺纹", note: "大型接口" },
  { family: "metric", familyLabel: "M 公制", size: "M56×4", majorMm: 56, pitchMm: 4, seal: "直螺纹", note: "大型设备接口参考" },
  { family: "metric", familyLabel: "M 公制", size: "M60×4", majorMm: 60, pitchMm: 4, seal: "直螺纹", note: "大型设备接口参考" },
  { family: "metric", familyLabel: "M 公制", size: "M64×4", majorMm: 64, pitchMm: 4, seal: "直螺纹", note: "大型设备接口参考" },
  { family: "metric", familyLabel: "M 公制", size: "M68×4", majorMm: 68, pitchMm: 4, seal: "直螺纹", note: "大型设备接口参考" },
  { family: "metric", familyLabel: "M 公制", size: "M72×4", majorMm: 72, pitchMm: 4, seal: "直螺纹", note: "大型设备接口参考" },
  { family: "metric", familyLabel: "M 公制", size: "M76×4", majorMm: 76, pitchMm: 4, seal: "直螺纹", note: "大型设备接口参考" },
  { family: "metric", familyLabel: "M 公制", size: "M80×4", majorMm: 80, pitchMm: 4, seal: "直螺纹", note: "大型设备接口参考" },
  { family: "metric", familyLabel: "M 公制", size: "M90×4", majorMm: 90, pitchMm: 4, seal: "直螺纹", note: "大型设备接口参考" },
  { family: "metric", familyLabel: "M 公制", size: "M100×4", majorMm: 100, pitchMm: 4, seal: "直螺纹", note: "大型设备接口参考" },
  { family: "metricH", familyLabel: "液压 H型", size: "M14×1.5 H型", majorMm: 14, pitchMm: 1.5, seal: "公制H型", note: "液压扣压/活动接头常见，按样品确认密封面" },
  { family: "metricH", familyLabel: "液压 H型", size: "M16×1.5 H型", majorMm: 16, pitchMm: 1.5, seal: "公制H型", note: "液压扣压/活动接头常见，按样品确认密封面" },
  { family: "metricH", familyLabel: "液压 H型", size: "M18×1.5 H型", majorMm: 18, pitchMm: 1.5, seal: "公制H型", note: "油管扣压接头常见 H 型规格" },
  { family: "metricH", familyLabel: "液压 H型", size: "M22×1.5 H型", majorMm: 22, pitchMm: 1.5, seal: "公制H型", note: "油管扣压接头常见 H 型规格" },
  { family: "metricH", familyLabel: "液压 H型", size: "M26×1.5 H型", majorMm: 26, pitchMm: 1.5, seal: "公制H型", note: "油管扣压接头常见 H 型规格" },
  { family: "metricH", familyLabel: "液压 H型", size: "M30×1.5 H型", majorMm: 30, pitchMm: 1.5, seal: "公制H型", note: "油管扣压接头常见 H 型规格" },
  { family: "metricH", familyLabel: "液压 H型", size: "M36×2 H型", majorMm: 36, pitchMm: 2, seal: "公制H型", note: "大流量液压接头，按样品确认密封面" },
  { family: "metricH", familyLabel: "液压 H型", size: "M45×2 H型", majorMm: 45, pitchMm: 2, seal: "公制H型", note: "大流量液压接头，按样品确认密封面" },
  { family: "metricH", familyLabel: "液压 H型", size: "M52×2 H型", majorMm: 52, pitchMm: 2, seal: "公制H型", note: "大流量液压接头，按样品确认密封面" },
  { family: "metricA", familyLabel: "液压 A型", size: "M14×1.5 A型", majorMm: 14, pitchMm: 1.5, seal: "公制A型", note: "油管扣压接头 A 型，需确认端面/锥面结构" },
  { family: "metricA", familyLabel: "液压 A型", size: "M16×1.5 A型", majorMm: 16, pitchMm: 1.5, seal: "公制A型", note: "油管扣压接头 A 型，需确认端面/锥面结构" },
  { family: "metricA", familyLabel: "液压 A型", size: "M18×1.5 A型", majorMm: 18, pitchMm: 1.5, seal: "公制A型", note: "油管扣压接头 A 型，需确认端面/锥面结构" },
  { family: "metricA", familyLabel: "液压 A型", size: "M22×1.5 A型", majorMm: 22, pitchMm: 1.5, seal: "公制A型", note: "油管扣压接头 A 型，需确认端面/锥面结构" },
  { family: "metricA", familyLabel: "液压 A型", size: "M30×1.5 A型", majorMm: 30, pitchMm: 1.5, seal: "公制A型", note: "油管扣压接头 A 型，需确认端面/锥面结构" },
  { family: "metricA", familyLabel: "液压 A型", size: "M36×2 A型", majorMm: 36, pitchMm: 2, seal: "公制A型", note: "油管扣压接头 A 型，需确认端面/锥面结构" },
  { family: "metricA", familyLabel: "液压 A型", size: "M42×2 A型", majorMm: 42, pitchMm: 2, seal: "公制A型", note: "油管扣压接头 A 型，需确认端面/锥面结构" },
  { family: "metricC", familyLabel: "液压 C型", size: "M16×1.5 C型", majorMm: 16, pitchMm: 1.5, seal: "公制C型", note: "油管扣压接头 C 型，需确认端面/锥面结构" },
  { family: "metricC", familyLabel: "液压 C型", size: "M18×1.5 C型", majorMm: 18, pitchMm: 1.5, seal: "公制C型", note: "油管扣压接头 C 型，需确认端面/锥面结构" },
  { family: "metricC", familyLabel: "液压 C型", size: "M22×1.5 C型", majorMm: 22, pitchMm: 1.5, seal: "公制C型", note: "油管扣压接头 C 型，需确认端面/锥面结构" },
  { family: "metricC", familyLabel: "液压 C型", size: "M30×1.5 C型", majorMm: 30, pitchMm: 1.5, seal: "公制C型", note: "油管扣压接头 C 型，需确认端面/锥面结构" },
  { family: "metricC", familyLabel: "液压 C型", size: "M36×2 C型", majorMm: 36, pitchMm: 2, seal: "公制C型", note: "油管扣压接头 C 型，需确认端面/锥面结构" },
  { family: "metricC", familyLabel: "液压 C型", size: "M42×2 C型", majorMm: 42, pitchMm: 2, seal: "公制C型", note: "油管扣压接头 C 型，需确认端面/锥面结构" },
  { family: "g", familyLabel: "G 管螺纹", size: "G1/16", majorMm: 7.723, tpi: 28, seal: "直管螺纹", note: "BSPP，小型仪表接口" },
  { family: "g", familyLabel: "G 管螺纹", size: "G1/8", majorMm: 9.728, tpi: 28, seal: "直管螺纹", note: "BSPP，常配密封垫/端面密封" },
  { family: "g", familyLabel: "G 管螺纹", size: "G1/4", majorMm: 13.157, tpi: 19, seal: "直管螺纹", note: "气动、仪表常见" },
  { family: "g", familyLabel: "G 管螺纹", size: "G3/8", majorMm: 16.662, tpi: 19, seal: "直管螺纹", note: "常见中小接口" },
  { family: "g", familyLabel: "G 管螺纹", size: "G1/2", majorMm: 20.955, tpi: 14, seal: "直管螺纹", note: "水、气、液压常见" },
  { family: "g", familyLabel: "G 管螺纹", size: "G3/4", majorMm: 26.441, tpi: 14, seal: "直管螺纹", note: "中型管路接口" },
  { family: "g", familyLabel: "G 管螺纹", size: "G1", majorMm: 33.249, tpi: 11, seal: "直管螺纹", note: "中大型管路接口" },
  { family: "g", familyLabel: "G 管螺纹", size: "G1-1/4", majorMm: 41.91, tpi: 11, seal: "直管螺纹", note: "大型管路接口" },
  { family: "g", familyLabel: "G 管螺纹", size: "G1-1/2", majorMm: 47.803, tpi: 11, seal: "直管螺纹", note: "大型管路接口" },
  { family: "g", familyLabel: "G 管螺纹", size: "G2", majorMm: 59.614, tpi: 11, seal: "直管螺纹", note: "大型管路接口" },
  { family: "g", familyLabel: "G 管螺纹", size: "G2-1/2", majorMm: 75.184, tpi: 11, seal: "直管螺纹", note: "大型管路接口" },
  { family: "g", familyLabel: "G 管螺纹", size: "G3", majorMm: 87.884, tpi: 11, seal: "直管螺纹", note: "大型管路接口" },
  { family: "g", familyLabel: "G 管螺纹", size: "G4", majorMm: 113.03, tpi: 11, seal: "直管螺纹", note: "大型管路接口" },
  { family: "g", familyLabel: "G 管螺纹", size: "G5", majorMm: 138.43, tpi: 11, seal: "直管螺纹", note: "大型管路接口" },
  { family: "g", familyLabel: "G 管螺纹", size: "G6", majorMm: 163.83, tpi: 11, seal: "直管螺纹", note: "大型管路接口" },
  { family: "r", familyLabel: "R/PT/ZG", size: "R1/16 / PT1/16 / ZG1/16", majorMm: 7.723, tpi: 28, seal: "锥管螺纹", note: "小型锥管接口" },
  { family: "r", familyLabel: "R/PT/ZG", size: "R1/8 / PT1/8 / ZG1/8", majorMm: 9.728, tpi: 28, seal: "锥管螺纹", note: "靠螺纹锥面密封" },
  { family: "r", familyLabel: "R/PT/ZG", size: "R1/4 / PT1/4 / ZG1/4", majorMm: 13.157, tpi: 19, seal: "锥管螺纹", note: "国内日系设备常见" },
  { family: "r", familyLabel: "R/PT/ZG", size: "R3/8 / PT3/8 / ZG3/8", majorMm: 16.662, tpi: 19, seal: "锥管螺纹", note: "中小接口" },
  { family: "r", familyLabel: "R/PT/ZG", size: "R1/2 / PT1/2 / ZG1/2", majorMm: 20.955, tpi: 14, seal: "锥管螺纹", note: "常见管路接口" },
  { family: "r", familyLabel: "R/PT/ZG", size: "R3/4 / PT3/4 / ZG3/4", majorMm: 26.441, tpi: 14, seal: "锥管螺纹", note: "中型管路接口" },
  { family: "r", familyLabel: "R/PT/ZG", size: "R1 / PT1 / ZG1", majorMm: 33.249, tpi: 11, seal: "锥管螺纹", note: "中大型管路接口" },
  { family: "r", familyLabel: "R/PT/ZG", size: "R1-1/4 / PT1-1/4 / ZG1-1/4", majorMm: 41.91, tpi: 11, seal: "锥管螺纹", note: "大型管路接口" },
  { family: "r", familyLabel: "R/PT/ZG", size: "R1-1/2 / PT1-1/2 / ZG1-1/2", majorMm: 47.803, tpi: 11, seal: "锥管螺纹", note: "大型管路接口" },
  { family: "r", familyLabel: "R/PT/ZG", size: "R2 / PT2 / ZG2", majorMm: 59.614, tpi: 11, seal: "锥管螺纹", note: "大型管路接口" },
  { family: "r", familyLabel: "R/PT/ZG", size: "R2-1/2 / PT2-1/2 / ZG2-1/2", majorMm: 75.184, tpi: 11, seal: "锥管螺纹", note: "大型管路接口" },
  { family: "r", familyLabel: "R/PT/ZG", size: "R3 / PT3 / ZG3", majorMm: 87.884, tpi: 11, seal: "锥管螺纹", note: "大型管路接口" },
  { family: "r", familyLabel: "R/PT/ZG", size: "R4 / PT4 / ZG4", majorMm: 113.03, tpi: 11, seal: "锥管螺纹", note: "大型管路接口" },
  { family: "r", familyLabel: "R/PT/ZG", size: "R5 / PT5 / ZG5", majorMm: 138.43, tpi: 11, seal: "锥管螺纹", note: "大型管路接口" },
  { family: "r", familyLabel: "R/PT/ZG", size: "R6 / PT6 / ZG6", majorMm: 163.83, tpi: 11, seal: "锥管螺纹", note: "大型管路接口" },
  { family: "npt", familyLabel: "NPT 美制", size: "NPT1/16", majorMm: 7.895, tpi: 27, seal: "锥管螺纹", note: "美制小型接口" },
  { family: "npt", familyLabel: "NPT 美制", size: "NPT1/8", majorMm: 10.287, tpi: 27, seal: "锥管螺纹", note: "美标设备常见" },
  { family: "npt", familyLabel: "NPT 美制", size: "NPT1/4", majorMm: 13.716, tpi: 18, seal: "锥管螺纹", note: "美制仪表/阀件" },
  { family: "npt", familyLabel: "NPT 美制", size: "NPT3/8", majorMm: 17.055, tpi: 18, seal: "锥管螺纹", note: "美制中小接口" },
  { family: "npt", familyLabel: "NPT 美制", size: "NPT1/2", majorMm: 21.223, tpi: 14, seal: "锥管螺纹", note: "美制常见管路接口" },
  { family: "npt", familyLabel: "NPT 美制", size: "NPT3/4", majorMm: 26.568, tpi: 14, seal: "锥管螺纹", note: "美制中型接口" },
  { family: "npt", familyLabel: "NPT 美制", size: "NPT1", majorMm: 33.228, tpi: 11.5, seal: "锥管螺纹", note: "美制中大型接口" },
  { family: "npt", familyLabel: "NPT 美制", size: "NPT1-1/4", majorMm: 41.985, tpi: 11.5, seal: "锥管螺纹", note: "美制大型接口" },
  { family: "npt", familyLabel: "NPT 美制", size: "NPT1-1/2", majorMm: 48.054, tpi: 11.5, seal: "锥管螺纹", note: "美制大型接口" },
  { family: "npt", familyLabel: "NPT 美制", size: "NPT2", majorMm: 60.092, tpi: 11.5, seal: "锥管螺纹", note: "美制大型接口" },
  { family: "npt", familyLabel: "NPT 美制", size: "NPT2-1/2", majorMm: 72.699, tpi: 8, seal: "锥管螺纹", note: "美制大型接口" },
  { family: "npt", familyLabel: "NPT 美制", size: "NPT3", majorMm: 88.608, tpi: 8, seal: "锥管螺纹", note: "美制大型接口" },
  { family: "npt", familyLabel: "NPT 美制", size: "NPT3-1/2", majorMm: 101.316, tpi: 8, seal: "锥管螺纹", note: "美制大型接口" },
  { family: "npt", familyLabel: "NPT 美制", size: "NPT4", majorMm: 113.973, tpi: 8, seal: "锥管螺纹", note: "美制大型接口" },
  { family: "npt", familyLabel: "NPT 美制", size: "NPT5", majorMm: 141.3, tpi: 8, seal: "锥管螺纹", note: "美制大型接口" },
  { family: "npt", familyLabel: "NPT 美制", size: "NPT6", majorMm: 168.275, tpi: 8, seal: "锥管螺纹", note: "美制大型接口" },
  { family: "jic", familyLabel: "JIC 37°", size: "JIC-02 5/16-24 UNF", majorMm: 7.938, tpi: 24, seal: "37°扩口", note: "适配 1/8 管，SAE J514 常见规格" },
  { family: "jic", familyLabel: "JIC 37°", size: "JIC-03 3/8-24 UNF", majorMm: 9.525, tpi: 24, seal: "37°扩口", note: "适配 3/16 管，小型液压接口" },
  { family: "jic", familyLabel: "JIC 37°", size: "JIC-04 7/16-20 UNF", majorMm: 11.113, tpi: 20, seal: "37°扩口", note: "适配 1/4 管，常见液压软管接头" },
  { family: "jic", familyLabel: "JIC 37°", size: "JIC-05 1/2-20 UNF", majorMm: 12.7, tpi: 20, seal: "37°扩口", note: "适配 5/16 管" },
  { family: "jic", familyLabel: "JIC 37°", size: "JIC-06 9/16-18 UNF", majorMm: 14.288, tpi: 18, seal: "37°扩口", note: "适配 3/8 管，液压系统常见" },
  { family: "jic", familyLabel: "JIC 37°", size: "JIC-08 3/4-16 UNF", majorMm: 19.05, tpi: 16, seal: "37°扩口", note: "适配 1/2 管，液压系统常见" },
  { family: "jic", familyLabel: "JIC 37°", size: "JIC-10 7/8-14 UNF", majorMm: 22.225, tpi: 14, seal: "37°扩口", note: "适配 5/8 管" },
  { family: "jic", familyLabel: "JIC 37°", size: "JIC-12 1-1/16-12 UN", majorMm: 26.988, tpi: 12, seal: "37°扩口", note: "适配 3/4 管，大流量液压接口" },
  { family: "jic", familyLabel: "JIC 37°", size: "JIC-14 1-3/16-12 UN", majorMm: 30.163, tpi: 12, seal: "37°扩口", note: "适配 7/8 管" },
  { family: "jic", familyLabel: "JIC 37°", size: "JIC-16 1-5/16-12 UN", majorMm: 33.338, tpi: 12, seal: "37°扩口", note: "适配 1 管，大型液压接口" },
  { family: "jic", familyLabel: "JIC 37°", size: "JIC-20 1-5/8-12 UN", majorMm: 41.275, tpi: 12, seal: "37°扩口", note: "适配 1-1/4 管" },
  { family: "jic", familyLabel: "JIC 37°", size: "JIC-24 1-7/8-12 UN", majorMm: 47.625, tpi: 12, seal: "37°扩口", note: "适配 1-1/2 管" },
  { family: "jic", familyLabel: "JIC 37°", size: "JIC-32 2-1/2-12 UN", majorMm: 63.5, tpi: 12, seal: "37°扩口", note: "适配 2 管，大型液压接口" },
];

const PIPES: PipeSpec[] = [
  { dn: "DN6", inch: "1/8", odMm: 10.2, commonUse: "小流量仪表管路" },
  { dn: "DN8", inch: "1/4", odMm: 13.5, commonUse: "小型气液管路" },
  { dn: "DN10", inch: "3/8", odMm: 17.2, commonUse: "小型管路" },
  { dn: "DN15", inch: "1/2", odMm: 21.3, commonUse: "常见支路接口" },
  { dn: "DN20", inch: "3/4", odMm: 26.9, commonUse: "中小管路" },
  { dn: "DN25", inch: "1", odMm: 33.7, commonUse: "常见主管接口" },
  { dn: "DN32", inch: "1-1/4", odMm: 42.4, commonUse: "中型管路" },
  { dn: "DN40", inch: "1-1/2", odMm: 48.3, commonUse: "中型管路" },
  { dn: "DN50", inch: "2", odMm: 60.3, commonUse: "大型支路/主管" },
  { dn: "DN65", inch: "2-1/2", odMm: 76.1, commonUse: "大型管路" },
  { dn: "DN80", inch: "3", odMm: 88.9, commonUse: "大型管路" },
  { dn: "DN100", inch: "4", odMm: 114.3, commonUse: "大型主管" },
];

const HOSES: HoseSpec[] = [
  { dash: "-03", nominalInch: "3/16", innerMm: 4.8, outerRangeMm: "11-13", pressureMpa: "20-35", jic: "JIC-03 3/8-24", commonUse: "仪表、小流量液压控制管路" },
  { dash: "-04", nominalInch: "1/4", innerMm: 6.4, outerRangeMm: "12-15", pressureMpa: "18-35", jic: "JIC-04 7/16-20", commonUse: "常见小型液压软管" },
  { dash: "-05", nominalInch: "5/16", innerMm: 7.9, outerRangeMm: "14-17", pressureMpa: "16-30", jic: "JIC-05 1/2-20", commonUse: "小中流量液压管路" },
  { dash: "-06", nominalInch: "3/8", innerMm: 9.5, outerRangeMm: "16-19", pressureMpa: "14-28", jic: "JIC-06 9/16-18", commonUse: "工程机械、液压站常用" },
  { dash: "-08", nominalInch: "1/2", innerMm: 12.7, outerRangeMm: "19-24", pressureMpa: "12-28", jic: "JIC-08 3/4-16", commonUse: "中流量主油路、回油支路" },
  { dash: "-10", nominalInch: "5/8", innerMm: 15.9, outerRangeMm: "23-28", pressureMpa: "10-24", jic: "JIC-10 7/8-14", commonUse: "中大流量液压管路" },
  { dash: "-12", nominalInch: "3/4", innerMm: 19.0, outerRangeMm: "27-33", pressureMpa: "8-21", jic: "JIC-12 1-1/16-12", commonUse: "大流量主油路、回油管" },
  { dash: "-16", nominalInch: "1", innerMm: 25.4, outerRangeMm: "35-42", pressureMpa: "6-18", jic: "JIC-16 1-5/16-12", commonUse: "大流量低中压液压管路" },
  { dash: "-20", nominalInch: "1-1/4", innerMm: 31.8, outerRangeMm: "44-52", pressureMpa: "5-16", jic: "JIC-20 1-5/8-12", commonUse: "大型设备主回油、吸油管路" },
  { dash: "-24", nominalInch: "1-1/2", innerMm: 38.1, outerRangeMm: "51-60", pressureMpa: "4-14", jic: "JIC-24 1-7/8-12", commonUse: "大流量回油、吸油管路" },
  { dash: "-32", nominalInch: "2", innerMm: 50.8, outerRangeMm: "64-75", pressureMpa: "3-10", jic: "JIC-32 2-1/2-12", commonUse: "超大流量低压管路" },
  { kind: "气管", dash: "Φ4×2.5", nominalInch: "4 mm", innerMm: 2.5, outerRangeMm: "4", pressureMpa: "0-1.0", jic: "4mm 快插/快拧", commonUse: "小型气缸、真空、信号气路" },
  { kind: "气管", dash: "Φ6×4", nominalInch: "6 mm", innerMm: 4, outerRangeMm: "6", pressureMpa: "0-1.0", jic: "6mm 快插/快拧", commonUse: "常用气动控制管路" },
  { kind: "气管", dash: "Φ8×5", nominalInch: "8 mm", innerMm: 5, outerRangeMm: "8", pressureMpa: "0-1.0", jic: "8mm 快插/快拧", commonUse: "中小型气缸、夹爪、吹气" },
  { kind: "气管", dash: "Φ10×6.5", nominalInch: "10 mm", innerMm: 6.5, outerRangeMm: "10", pressureMpa: "0-1.0", jic: "10mm 快插/快拧", commonUse: "较大流量气缸、主管支路" },
  { kind: "气管", dash: "Φ12×8", nominalInch: "12 mm", innerMm: 8, outerRangeMm: "12", pressureMpa: "0-1.0", jic: "12mm 快插/快拧", commonUse: "主管支路、大流量执行元件" },
  { kind: "气管", dash: "Φ16×12", nominalInch: "16 mm", innerMm: 12, outerRangeMm: "16", pressureMpa: "0-1.0", jic: "16mm 快插/快拧", commonUse: "大流量气路、设备主管" },
];

const CATEGORY_FILTERS: Array<{
  key: string;
  label: string;
  apply: () => { tab: ToolTab; family?: "all" | ThreadFamily; hoseKind?: "all" | "hydraulic" | "air" };
}> = [
  { key: "thread:all", label: "螺纹", apply: () => ({ tab: "thread", family: "all", hoseKind: "all" }) },
  { key: "thread:g", label: "G", apply: () => ({ tab: "thread", family: "g", hoseKind: "all" }) },
  { key: "thread:r", label: "R/PT", apply: () => ({ tab: "thread", family: "r", hoseKind: "all" }) },
  { key: "thread:npt", label: "NPT", apply: () => ({ tab: "thread", family: "npt", hoseKind: "all" }) },
  { key: "thread:jic", label: "JIC", apply: () => ({ tab: "thread", family: "jic", hoseKind: "all" }) },
  { key: "pipe", label: "管径", apply: () => ({ tab: "pipe", family: "all", hoseKind: "all" }) },
  { key: "hose:hydraulic", label: "油管", apply: () => ({ tab: "hose", family: "all", hoseKind: "hydraulic" }) },
  { key: "hose:air", label: "气管", apply: () => ({ tab: "hose", family: "all", hoseKind: "air" }) },
];
const CATEGORY_WHEEL_OFFSETS = [-3, -2, -1, 0, 1, 2, 3];

const TABLE_SCROLL = "min-h-0 flex-1 max-w-full overflow-auto overscroll-contain [-webkit-overflow-scrolling:touch]";
const TABLE_BASE = "min-w-full border-separate border-spacing-0 text-left text-xs md:text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap";
const TABLE_HEAD = "text-xs text-on-surface-variant";
const TABLE_CARD = "flex h-full min-h-0 flex-col overflow-hidden border-t border-outline-variant/10 bg-surface";
const TABLE_TH = "sticky top-0 z-20 bg-surface-container-high px-3 py-2.5 text-[11px] font-semibold shadow-[0_1px_0_rgba(0,0,0,0.08)]";
const TABLE_FIRST_TH = "sticky left-0 top-0 z-30 bg-surface-container-high px-3 py-2.5 text-[11px] font-semibold shadow-[1px_0_0_rgba(0,0,0,0.08),0_1px_0_rgba(0,0,0,0.08)]";
const TABLE_FIRST_TD = "sticky left-0 z-10 bg-surface px-3 py-2.5 font-semibold shadow-[1px_0_0_rgba(0,0,0,0.06)]";
const TABLE_TD = "px-3 py-2.5";

const PRIORITY_TERMS: Record<ToolTab, string[]> = {
  thread: ["G1/4", "G1/2", "R1/4", "R1/2", "NPT1/4", "JIC-06", "JIC-08", "M16", "M20", "M12"],
  pipe: ["DN15", "DN20", "DN25", "DN32", "DN40", "DN50", "DN10", "DN8"],
  hose: ["-04", "-06", "-08", "-10", "-12", "-03", "-16"],
};

const COMMON_PIPE_NAME_ALIASES: Record<string, string[]> = {
  "一分": ["g1/8", "r1/8", "pt1/8", "zg1/8", "npt1/8", "dn6"],
  "1分": ["g1/8", "r1/8", "pt1/8", "zg1/8", "npt1/8", "dn6"],
  "二分": ["g1/4", "r1/4", "pt1/4", "zg1/4", "npt1/4", "dn8"],
  "2分": ["g1/4", "r1/4", "pt1/4", "zg1/4", "npt1/4", "dn8"],
  "三分": ["g3/8", "r3/8", "pt3/8", "zg3/8", "npt3/8", "dn10"],
  "3分": ["g3/8", "r3/8", "pt3/8", "zg3/8", "npt3/8", "dn10"],
  "四分": ["g1/2", "r1/2", "pt1/2", "zg1/2", "npt1/2", "dn15"],
  "半寸": ["g1/2", "r1/2", "pt1/2", "zg1/2", "npt1/2", "dn15"],
  "4分": ["g1/2", "r1/2", "pt1/2", "zg1/2", "npt1/2", "dn15"],
  "六分": ["g3/4", "r3/4", "pt3/4", "zg3/4", "npt3/4", "dn20"],
  "6分": ["g3/4", "r3/4", "pt3/4", "zg3/4", "npt3/4", "dn20"],
  "1寸": ["g1", "r1", "pt1", "zg1", "npt1", "dn25"],
  "一寸": ["g1", "r1", "pt1", "zg1", "npt1", "dn25"],
  "一吋": ["g1", "r1", "pt1", "zg1", "npt1", "dn25"],
  "1.2寸": ["g1-1/4", "npt1-1/4", "dn32"],
  "一寸二": ["g1-1/4", "npt1-1/4", "dn32"],
  "1.5寸": ["g1-1/2", "npt1-1/2", "dn40"],
  "一寸半": ["g1-1/2", "npt1-1/2", "dn40"],
  "2寸": ["g2", "npt2", "dn50"],
  "两寸": ["g2", "npt2", "dn50"],
  "二寸": ["g2", "npt2", "dn50"],
};

function commonPipeNameAliases(value: string) {
  const q = normalizeText(value);
  if (!q) return undefined;
  const compact = q.replace(/(?:管螺纹|螺纹|管径|外牙|内牙|接口|接头|管|牙)+$/g, "");
  if (COMMON_PIPE_NAME_ALIASES[compact]) return COMMON_PIPE_NAME_ALIASES[compact];

  const matchedName = Object.keys(COMMON_PIPE_NAME_ALIASES)
    .sort((a, b) => b.length - a.length)
    .find((name) => q.includes(name));
  return matchedName ? COMMON_PIPE_NAME_ALIASES[matchedName] : undefined;
}

function threadPitchText(spec: ThreadSpec) {
  if (spec.pitchMm) return `${spec.pitchMm} mm`;
  return `${spec.tpi} 牙/英寸`;
}

function pitchToMm(spec: ThreadSpec) {
  return spec.pitchMm || (spec.tpi ? 25.4 / spec.tpi : 0);
}

function isMetricThreadFamily(family: ThreadFamily) {
  return family === "metric" || family === "metricH" || family === "metricA" || family === "metricC";
}

function threadInnerReference(spec: ThreadSpec) {
  const commonTapDrills: Record<string, string> = {
    "M5×0.8": "4.2 mm",
    "M6×1": "5.0 mm",
    "M8×1.25": "6.8 mm",
    "M10×1": "9.0 mm",
    "M12×1.5": "10.5 mm",
    "M14×1.5": "12.5 mm",
    "M16×1.5": "14.5 mm",
    "M18×1.5": "16.5 mm",
    "M20×1.5": "18.5 mm",
    "M22×1.5": "20.5 mm",
    "M24×1.5": "22.5 mm",
    "M27×2": "25.0 mm",
    "M30×2": "28.0 mm",
  };
  if (isMetricThreadFamily(spec.family)) return commonTapDrills[spec.size] || `${(spec.majorMm - pitchToMm(spec)).toFixed(1)} mm`;

  const pitch = pitchToMm(spec);
  if (!pitch) return "-";
  const minor = spec.majorMm - pitch * 1.28;
  if (spec.family === "r" || spec.family === "npt") return `${minor.toFixed(2)} mm（基准位置）`;
  if (spec.family === "jic") return `${minor.toFixed(2)} mm（UN/UNF 小径）`;
  return `${minor.toFixed(2)} mm`;
}

function threadInnerValue(spec: ThreadSpec) {
  const pitch = pitchToMm(spec);
  if (!pitch) return null;
  if (isMetricThreadFamily(spec.family)) return spec.majorMm - pitch;
  return spec.majorMm - pitch * 1.28;
}

function threadAngleText(spec: ThreadSpec) {
  if (spec.family === "g" || spec.family === "r") return "55°";
  return "60°";
}

function threadTaperText(spec: ThreadSpec) {
  if (spec.family === "metricH") return "直牙，H型密封";
  if (spec.family === "metricA") return "直牙，A型密封";
  if (spec.family === "metricC") return "直牙，C型密封";
  if (spec.family === "r") return "1:16 锥管";
  if (spec.family === "npt") return "1:16 锥管";
  if (spec.family === "jic") return "直牙，37°锥面";
  return "直牙";
}

function parseMeasurementQuery(value: string) {
  const text = value.trim();
  if (!text) return { hasMeasurement: false };

  const normalized = normalizeText(text);
  if (/^\d+(?:-\d+)?\/\d+$/.test(normalized)) return { hasMeasurement: false };
  if (/^(?:m|g|r|pt|zg|npt|jic)[\d-]/.test(normalized)) return { hasMeasurement: false };
  if (commonPipeNameAliases(text) || /^dn\d+/i.test(normalized) || /[寸分]/.test(text)) return { hasMeasurement: false };
  const hasInnerIntent = /(内螺纹|内牙|母螺纹|母牙|内孔|孔径|内径|底孔|小径|\bid\b)/i.test(text);
  const hasOuterIntent = /(外螺纹|外牙|公螺纹|公牙|外径|大径|\bod\b)/i.test(text);
  const hasMeasurementWord = /(外螺纹|外牙|公螺纹|公牙|外径|大径|内螺纹|内牙|母螺纹|母牙|内孔|孔径|内径|底孔|小径|牙距|螺距|牙\/英寸|毫米|mm|tpi|\bod\b|\bid\b|牙)/i.test(text);
  const looksLikeMeasurementOnly = /^[\s\d.,，;；:/\\+\-毫米牙距螺距外径大径内径底孔小径内孔孔径牙英寸mtpiodid]+$/i.test(normalized);
  const numberMatches = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter((num) => Number.isFinite(num) && num > 0);

  if (!numberMatches.length || (!hasMeasurementWord && !looksLikeMeasurementOnly)) {
    return { hasMeasurement: false };
  }

  const outerMatch = text.match(/(?:外螺纹|外牙|公螺纹|公牙|外径|大径|\bod\b)\s*[:：]?\s*(\d+(?:\.\d+)?)/i);
  const innerMatch = text.match(/(?:内螺纹|内牙|母螺纹|母牙|内孔|孔径|内径|底孔|小径|\bid\b)\s*[:：]?\s*(\d+(?:\.\d+)?)/i);
  const tpiMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:牙\/英寸|牙每英寸|牙|tpi)/i);
  const pitchMatch = text.match(/(?:牙距|螺距|pitch)\s*[:：]?\s*(\d+(?:\.\d+)?)(?!\s*(?:牙|tpi))/i);

  let outer = outerMatch ? Number(outerMatch[1]) : undefined;
  let inner = innerMatch ? Number(innerMatch[1]) : undefined;
  let pitchMm = pitchMatch ? Number(pitchMatch[1]) : undefined;
  let pitchLabel = pitchMm ? `${pitchMm} mm` : "";

  if (tpiMatch) {
    const tpi = Number(tpiMatch[1]);
    pitchMm = 25.4 / tpi;
    pitchLabel = `${tpi} 牙/英寸`;
  }

  const used = new Set<number>();
  if (outer !== undefined) used.add(outer);
  if (inner !== undefined) used.add(inner);
  if (pitchMatch) used.add(Number(pitchMatch[1]));
  if (tpiMatch) used.add(Number(tpiMatch[1]));
  const freeNumbers = numberMatches.filter((num) => !used.has(num));

  if (hasInnerIntent && !hasOuterIntent) {
    if (inner === undefined && freeNumbers.length) inner = freeNumbers.shift();
    if (outer === undefined && freeNumbers.length >= 2) outer = freeNumbers.shift();
  } else {
    if (outer === undefined && freeNumbers.length) outer = freeNumbers.shift();
    if (inner === undefined && freeNumbers.length >= 2) inner = freeNumbers.shift();
  }
  if (pitchMm === undefined && freeNumbers.length) {
    const pitchValue = freeNumbers.shift();
    if (pitchValue !== undefined) {
      if (pitchValue >= 4) {
        pitchMm = 25.4 / pitchValue;
        pitchLabel = `${pitchValue} 牙/英寸`;
      } else {
        pitchMm = pitchValue;
        pitchLabel = `${pitchValue} mm`;
      }
    }
  }

  const hasMeasurement = outer !== undefined || inner !== undefined || pitchMm !== undefined;
  return { hasMeasurement, outer, inner, pitchMm, pitchLabel };
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[×＊*]/g, "x")
    .replace(/[，。；：、]/g, "")
    .replace(/\s+/g, "");
}

function normalizeMetricPitchZero(value: string) {
  return value.replace(/(m\d+x\d+)\.0(?=$|[^\d])/g, "$1");
}

function queryAliases(value: string) {
  const q = normalizeText(value);
  const aliases = new Set([q]);
  if (!q) return [];

  aliases.add(normalizeMetricPitchZero(q));
  aliases.add(q.replace(/^dash/, "-"));
  aliases.add(q.replace(/^dash0?/, "-0"));
  aliases.add(q.replace(/^jic0?/, "jic-0"));
  aliases.add(q.replace(/^dn/, "dn"));
  if (/^\d+(?:-\d+)?\/\d+$/.test(q)) {
    aliases.add(`g${q}`);
    aliases.add(`r${q}`);
    aliases.add(`pt${q}`);
    aliases.add(`zg${q}`);
    aliases.add(`npt${q}`);
  }

  const hydraulicMetricTypeMatch = q.match(/^m(\d+)([hac])型$/);
  if (hydraulicMetricTypeMatch) {
    aliases.add(`m${hydraulicMetricTypeMatch[1]}`);
    aliases.add(`${hydraulicMetricTypeMatch[2]}型`);
  }

  commonPipeNameAliases(value)?.forEach((alias) => aliases.add(alias));

  const dashMatch = q.match(/^(?:dash|-)?0?(\d{1,2})号?$/);
  if (dashMatch) aliases.add(`-${dashMatch[1].padStart(2, "0")}`);

  const tubeSizeMatch = q.match(/(?:φ|直径)?(\d+(?:\.\d+)?)mm?(?:气管|pu管|管)?|(?:气管|pu管)(\d+(?:\.\d+)?)/);
  const tubeSize = tubeSizeMatch?.[1] || tubeSizeMatch?.[2];
  if (tubeSize) {
    aliases.add(`φ${tubeSize}`);
    aliases.add(`${tubeSize}mm`);
    aliases.add(tubeSize);
  }

  return [...aliases].filter(Boolean);
}

function includesAnyAlias(text: string, aliases: string[]) {
  const normalized = normalizeText(text);
  return aliases.some((alias) => normalized.includes(alias));
}

function threadSizeTokens(spec: ThreadSpec) {
  const tokens = spec.size.includes(" / ")
    ? spec.size.split(/\s+\/\s+/).map(normalizeText).filter(Boolean)
    : [normalizeText(spec.size)];
  return [...new Set(tokens.flatMap((token) => [token, normalizeMetricPitchZero(token)]))];
}

function matchScore(text: string, query: string) {
  const aliases = queryAliases(query);
  const q = aliases[0] || "";
  if (!q) return 0;
  const normalized = normalizeText(text);
  if (aliases.some((alias) => normalized === alias)) return -400;
  if (aliases.some((alias) => normalized.startsWith(alias))) return -300;
  if (aliases.some((alias) => normalized.includes(alias))) return -200;
  return 0;
}

function priorityScore(text: string, tab: ToolTab) {
  const normalized = normalizeText(text);
  const index = PRIORITY_TERMS[tab].findIndex((term) => normalized.includes(normalizeText(term)));
  return index === -1 ? 1000 : index;
}

function rankedItems<T>(
  items: T[],
  query: string,
  tab: ToolTab,
  getText: (item: T) => string,
  tieBreaker?: (a: T, b: T) => number,
) {
  const q = normalizeText(query);
  return [...items].sort((a, b) => {
    if (!q && tieBreaker) return tieBreaker(a, b);
    const aText = getText(a);
    const bText = getText(b);
    return matchScore(aText, q) - matchScore(bText, q)
      || tieBreaker?.(a, b)
      || priorityScore(aText, tab) - priorityScore(bText, tab)
      || 0;
  });
}

function compareThreadSizeAsc(a: ThreadSpec, b: ThreadSpec) {
  return a.majorMm - b.majorMm || pitchToMm(a) - pitchToMm(b) || a.familyLabel.localeCompare(b.familyLabel, "zh-Hans-CN");
}

function comparePipeSizeAsc(a: PipeSpec, b: PipeSpec) {
  return a.odMm - b.odMm;
}

function compareHoseSizeAsc(a: HoseSpec, b: HoseSpec) {
  return a.innerMm - b.innerMm || a.dash.localeCompare(b.dash, "zh-Hans-CN");
}

function detectToolTab(value: string, fallback: ToolTab): ToolTab {
  const q = normalizeText(value);
  const aliases = queryAliases(value);
  if (!q) return fallback;
  if (commonPipeNameAliases(value) || q.includes("几分") || q.includes("几寸")) return "thread";
  if (q.startsWith("dn") || q.includes("管径")) return "pipe";
  if (aliases.some((alias) => /^-\d+/.test(alias) || alias.startsWith("φ")) || q.includes("油管") || q.includes("气管") || q.includes("管路") || q.includes("pu管") || q.includes("液压软管") || q.includes("dash")) return "hose";
  if (/^\d+(?:-\d+)?\/\d+$/.test(q)) return "thread";
  if (aliases.some((alias) => /^(g|r|pt|zg|npt|jic|m)\d/.test(alias)) || q.includes("h型") || q.includes("a型") || q.includes("c型") || q.includes("unf") || q.includes("螺纹")) return "thread";
  if (parseMeasurementQuery(value).hasMeasurement) return "thread";
  return fallback;
}

function familyFromQuery(value: string): "all" | ThreadFamily {
  if (commonPipeNameAliases(value)) return "all";
  const q = normalizeText(value);
  if (q.includes("h型")) return "metricH";
  if (q.includes("a型")) return "metricA";
  if (q.includes("c型")) return "metricC";
  const aliases = queryAliases(value);
  if (aliases.some((alias) => alias.startsWith("g"))) return "g";
  if (aliases.some((alias) => alias.startsWith("r") || alias.startsWith("pt") || alias.startsWith("zg"))) return "r";
  if (aliases.some((alias) => alias.startsWith("npt"))) return "npt";
  if (aliases.some((alias) => alias.startsWith("jic"))) return "jic";
  if (aliases.some((alias) => alias.startsWith("m"))) return "metric";
  return "all";
}

export default function ThreadSizeToolPage() {
  useDocumentTitle("规格速查");
  const [activeTab, setActiveTab] = useState<ToolTab>("thread");
  const [family, setFamily] = useState<"all" | ThreadFamily>("all");
  const [hoseKind, setHoseKind] = useState<"all" | "hydraulic" | "air">("all");
  const [query, setQuery] = useState("");
  const [hasChosenCategory, setHasChosenCategory] = useState(false);
  const wheelDragRef = useRef<{ x: number; y: number } | null>(null);
  const categoryWheelLockRef = useRef(0);
  const measurementQuery = useMemo(() => parseMeasurementQuery(query), [query]);
  const detectedTab = detectToolTab(query, activeTab);
  const visibleTab = query.trim() ? detectedTab : activeTab;

  const filteredThreads = useMemo(() => {
    const aliases = measurementQuery.hasMeasurement ? [] : queryAliases(query);
    const commonNameAliases = commonPipeNameAliases(query)?.filter((alias) => !alias.startsWith("dn"));
    const items = THREADS.filter((item) => {
      const queryFamily = familyFromQuery(query);
      const activeFamily = query.trim() ? queryFamily : family;
      if (activeFamily !== "all" && item.family !== activeFamily) return false;
      if (commonNameAliases?.length) return commonNameAliases.some((alias) => threadSizeTokens(item).includes(alias));
      if (!aliases.length) return true;
      return includesAnyAlias(`${item.familyLabel}${item.size}${item.seal}${item.note}${threadAngleText(item)}${threadTaperText(item)}`, aliases);
    });
    if (commonNameAliases?.length) {
      return [...items].sort((a, b) => {
        const aIndex = Math.min(...threadSizeTokens(a).map((token) => commonNameAliases.indexOf(token)).filter((index) => index >= 0));
        const bIndex = Math.min(...threadSizeTokens(b).map((token) => commonNameAliases.indexOf(token)).filter((index) => index >= 0));
        return aIndex - bIndex || compareThreadSizeAsc(a, b);
      });
    }
    return rankedItems(
      items,
      query,
      "thread",
      (item) => `${item.size}${item.familyLabel}${item.seal}${item.note}${threadAngleText(item)}${threadTaperText(item)}`,
      compareThreadSizeAsc,
    );
  }, [family, measurementQuery.hasMeasurement, query]);

  const matchedThreads = useMemo(() => {
    const measuredDiameter = measurementQuery.outer || 0;
    const measuredInnerDiameter = measurementQuery.inner || 0;
    const measuredPitchMm = measurementQuery.pitchMm || null;
    const hasOuter = !!measurementQuery.outer;
    const hasInner = !!measurementQuery.inner;
    if (!hasOuter && !hasInner) return [];

    return THREADS
      .filter((item) => measurementQuery.hasMeasurement || family === "all" || item.family === family)
      .map((item) => {
        const diameterDiff = hasOuter ? Math.abs(item.majorMm - measuredDiameter) : 0;
        const innerValue = threadInnerValue(item);
        const innerDiff = hasInner && innerValue ? Math.abs(innerValue - measuredInnerDiameter) : 0;
        const pitchDiff = measuredPitchMm ? Math.abs(pitchToMm(item) - measuredPitchMm) : 0;
        const score = diameterDiff * 1.8 + innerDiff * 1.5 + pitchDiff * 4;
        return { item, diameterDiff, innerDiff, pitchDiff, score };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);
  }, [family, measurementQuery.hasMeasurement, measurementQuery.inner, measurementQuery.outer, measurementQuery.pitchMm]);

  const filteredPipes = useMemo(() => {
    const aliases = queryAliases(query);
    const items = aliases.length ? PIPES.filter((item) => includesAnyAlias(`${item.dn}${item.inch}${item.odMm}${item.commonUse}`, aliases)) : PIPES;
    return rankedItems(items, query, "pipe", (item) => `${item.dn}${item.inch}${item.odMm}${item.commonUse}`, comparePipeSizeAsc);
  }, [query]);

  const filteredHoses = useMemo(() => {
    const aliases = queryAliases(query);
    const scopedHoses = !query.trim() && hoseKind !== "all"
      ? HOSES.filter((item) => (hoseKind === "air" ? item.kind === "气管" : item.kind !== "气管"))
      : HOSES;
    const items = aliases.length
      ? scopedHoses.filter((item) => includesAnyAlias(`${item.kind || "液压油管"}${item.dash}${item.nominalInch}${item.innerMm}${item.outerRangeMm}${item.pressureMpa}${item.jic}${item.commonUse}`, aliases))
      : scopedHoses;
    return rankedItems(
      items,
      query,
      "hose",
      (item) => `${item.kind || "液压油管"}${item.dash}${item.nominalInch}${item.innerMm}${item.outerRangeMm}${item.pressureMpa}${item.jic}${item.commonUse}`,
      compareHoseSizeAsc,
    );
  }, [hoseKind, query]);

  const displayedThreads = filteredThreads;
  const visibleTechnicalCount = visibleTab === "thread"
    ? displayedThreads.length
    : visibleTab === "pipe"
      ? filteredPipes.length
      : filteredHoses.length;
  const showGuide = !query.trim() && !hasChosenCategory;
  const showMeasurementResults = !showGuide && measurementQuery.hasMeasurement;
  const showTechnicalResults = !showGuide
    && !measurementQuery.hasMeasurement
    && (!query.trim() || visibleTechnicalCount > 0);
  const showNoResults = !showGuide
    && !measurementQuery.hasMeasurement
    && query.trim().length >= 2
    && visibleTechnicalCount === 0;
  useEffect(() => {
    const blockWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-thread-tool-block-wheel]"));
    nodes.forEach((node) => {
      node.addEventListener("wheel", blockWheel, { passive: false });
    });
    return () => {
      nodes.forEach((node) => {
        node.removeEventListener("wheel", blockWheel);
      });
    };
  }, [showGuide, showMeasurementResults, showTechnicalResults, visibleTab]);
  const fillMainSearch = (value: string) => {
    setQuery(value);
    setHasChosenCategory(false);
  };
  const clearSearch = () => {
    setQuery("");
    setHasChosenCategory(false);
  };
  const categoryKey = showGuide
    ? "thread:all"
    : visibleTab === "thread"
      ? `thread:${query.trim() ? familyFromQuery(query) : family}`
      : visibleTab === "pipe"
        ? "pipe"
        : `hose:${hoseKind}`;
  const selectedCategoryKey = CATEGORY_FILTERS.some((item) => item.key === categoryKey)
    ? categoryKey
    : visibleTab === "thread"
      ? "thread:all"
      : categoryKey;
  const selectedCategoryIndex = Math.max(0, CATEGORY_FILTERS.findIndex((item) => item.key === selectedCategoryKey));
  const categoryWheelItems = CATEGORY_WHEEL_OFFSETS.map((offset) => {
    const index = (selectedCategoryIndex + offset + CATEGORY_FILTERS.length) % CATEGORY_FILTERS.length;
    return { ...CATEGORY_FILTERS[index], offset, index };
  });
  const applyCategoryByOffset = (offset: number) => {
    const index = (selectedCategoryIndex + offset + CATEGORY_FILTERS.length) % CATEGORY_FILTERS.length;
    handleCategoryClick(CATEGORY_FILTERS[index].key);
  };
  const handleCategoryWheel = (event: WheelEvent<HTMLDivElement>) => {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    const now = event.timeStamp;
    if (now - categoryWheelLockRef.current < 180) return;
    categoryWheelLockRef.current = now;
    applyCategoryByOffset(delta > 0 ? 1 : -1);
  };
  const handleWheelPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    wheelDragRef.current = { x: event.clientX, y: event.clientY };
  };
  const handleWheelPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = wheelDragRef.current;
    wheelDragRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 28 || Math.abs(dx) < Math.abs(dy)) return;
    applyCategoryByOffset(dx < 0 ? 1 : -1);
  };
  const handleCategoryClick = (key: string) => {
    if (key === "guide") {
      setQuery("");
      setHasChosenCategory(false);
      setActiveTab("thread");
      setFamily("all");
      setHoseKind("all");
      return;
    }
    const next = CATEGORY_FILTERS.find((item) => item.key === key)?.apply();
    if (!next) return;
    if (key === selectedCategoryKey && !query.trim()) return;
    setQuery("");
    setHasChosenCategory(true);
    setActiveTab(next.tab);
    if (next.family) setFamily(next.family);
    if (next.hoseKind) setHoseKind(next.hoseKind);
  };
  const applyResultAsSearch = (value: string) => {
    setQuery(value);
    setHasChosenCategory(false);
  };

  return (
    <AdminPageShell>
      <AdminManagementPage
            title="螺纹与管路速查"
            meta={`${visibleTechnicalCount} 项`}
            description="规格、俗称、测量值直接搜索"
            actions={(
              <button
                type="button"
                onClick={() => handleCategoryClick("guide")}
                aria-pressed={showGuide}
                className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  showGuide
                    ? "bg-primary-container/10 text-primary-container"
                    : "border border-outline-variant/20 bg-surface-container-low text-on-surface-variant hover:bg-primary-container/10 hover:text-primary-container"
                }`}
              >
                指南
              </button>
            )}
            toolbar={(
              <div data-thread-tool-block-wheel className="space-y-1.5">
              <label className="relative block">
                <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHasChosenCategory(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") clearSearch();
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  placeholder="G1/2、4分、1寸、DN25、-06、外螺纹20.9"
                  className="h-10 w-full rounded-md border border-outline-variant/15 bg-surface-container-low pl-10 pr-16 text-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant/40 focus:border-primary-container focus:ring-2 focus:ring-primary-container/20"
                />
                {query && (
                  <button onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2.5 py-1.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface">
                    清空
                  </button>
                )}
              </label>

              <div className="relative overflow-hidden rounded-lg border border-outline-variant/10 bg-surface-container-low shadow-inner">
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1.5 bg-[repeating-linear-gradient(90deg,rgba(0,0,0,0.12)_0_1px,transparent_1px_9px)] opacity-25" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1.5 bg-[repeating-linear-gradient(90deg,rgba(0,0,0,0.12)_0_1px,transparent_1px_9px)] opacity-25" />
                <div className="pointer-events-none absolute inset-y-1 left-1/2 z-10 w-[22%] -translate-x-1/2 rounded-lg border border-primary-container/15 bg-surface/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45),0_4px_14px_rgba(0,0,0,0.08)]" />
                <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-14 bg-gradient-to-r from-surface-container-low via-surface-container-low/90 to-transparent" />
                <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-14 bg-gradient-to-l from-surface-container-low via-surface-container-low/90 to-transparent" />
                <div
                  onWheel={handleCategoryWheel}
                  onPointerDown={handleWheelPointerDown}
                  onPointerUp={handleWheelPointerUp}
                  onPointerCancel={() => { wheelDragRef.current = null; }}
                  className="relative z-30 h-11 select-none px-2 py-1 touch-pan-y [perspective:620px]"
                >
                {categoryWheelItems.map((item) => {
                    const active = item.offset === 0;
                    const distance = Math.abs(item.offset);
                    const side = Math.sign(item.offset);
                    const hiddenEdge = distance >= 3;
                    return (
                      <button
                        type="button"
                        aria-pressed={active}
                        key={item.key}
                        onClick={() => handleCategoryClick(item.key)}
                        style={{
                          left: `${50 + item.offset * 16.5}%`,
                          opacity: active ? 1 : hiddenEdge ? 0.16 : Math.max(0.5, 0.88 - distance * 0.15),
                          transform: `translate(-50%, calc(-50% + ${active ? -1 : distance * 1.1}px)) translateZ(${active ? 24 : -distance * 12}px) rotateY(${side * -16}deg) scale(${active ? 1.08 : 1 - distance * 0.055})`,
                        }}
                        className={`absolute top-1/2 h-8 w-[18%] min-w-0 overflow-hidden rounded-md px-1.5 text-sm font-semibold leading-8 will-change-[left,transform,opacity] transition-[left,background-color,color,box-shadow,opacity,transform] duration-300 ease-out ${
                          active
                            ? "bg-surface text-primary-container shadow-[0_5px_14px_rgba(0,0,0,0.12)] ring-1 ring-primary-container/20"
                            : hiddenEdge
                              ? "pointer-events-none text-on-surface-variant"
                              : "text-on-surface-variant hover:bg-surface/70 hover:text-on-surface"
                        }`}>
                        {item.label}
                      </button>
                    );
                })}
                </div>
              </div>

              <p className="hidden text-xs leading-relaxed text-on-surface-variant/60 md:block">
                {visibleTab === "thread" && "螺纹按外径、牙距/牙数和密封方式综合判断；管螺纹英寸号不是实际外径。"}
                {visibleTab === "pipe" && "DN 是公称通径，表中外径为常见钢管参考值。"}
                {visibleTab === "hose" && "油管和气管参数会随材料、层数、品牌和工况变化，最终按样本确认。"}
              </p>
              </div>
            )}
            contentClassName="overflow-hidden"
          >
            <AdminContentPanel scroll className="h-full flex min-h-0 flex-col overflow-hidden">

          {/* ── Results ── */}
          <div key={`${showGuide ? "guide" : visibleTab}:${showMeasurementResults ? "measurement" : showNoResults ? "empty" : "results"}`} className="admin-tab-panel min-h-0 flex-1 overflow-hidden">
            {showGuide && (
              <section className="h-full overflow-y-auto border-t border-outline-variant/10 bg-surface px-3 py-4 md:px-4 md:py-5">
                <div className="mb-3">
                  <h2 className="text-sm font-bold text-on-surface">快速开始</h2>
                  <p className="mt-1 text-xs text-on-surface-variant/65">
                    输入规格、俗称或测量值，系统会自动判断显示螺纹表、管径表、管路表或测量反推。
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {[
                    { title: "按规格", desc: "直接查标准规格", examples: ["G1/2", "M6x1.0", "NPT1/4"] },
                    { title: "按俗称", desc: "支持寸、分、DN", examples: ["4分", "1寸", "DN25"] },
                    { title: "按测量", desc: "只显示测量反推", examples: ["外螺纹20.9", "内螺纹18.6", "20.9 14牙"] },
                  ].map((group) => (
                    <div key={group.title} className="rounded-lg border border-outline-variant/10 bg-surface-container-low p-3">
                      <div className="mb-2">
                        <h3 className="text-sm font-semibold text-on-surface">{group.title}</h3>
                        <p className="mt-0.5 text-[11px] text-on-surface-variant/60">{group.desc}</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {group.examples.map((item) => (
                          <button
                            key={item}
                            onClick={() => fillMainSearch(item)}
                            className="rounded-md bg-surface px-2 py-1 text-[11px] font-medium text-on-surface-variant transition-all hover:bg-primary-container/10 hover:text-primary-container active:scale-95"
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Measurement Results ── */}
            {showMeasurementResults && (
              <section className="h-full">
                <div className={TABLE_CARD}>
                    <div data-thread-tool-block-wheel className="flex items-center justify-between gap-3 border-b border-outline-variant/10 px-3 py-2.5 md:px-4">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-sm font-bold text-on-surface">测量反推</h2>
                        <p className="line-clamp-1 text-[11px] text-on-surface-variant/60">按测量值匹配最接近的规格</p>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
                        {measurementQuery.outer && <span className="rounded bg-surface-container-low px-1.5 py-0.5 text-[10px] text-on-surface-variant">外径 {measurementQuery.outer}mm</span>}
                        {measurementQuery.inner && <span className="rounded bg-surface-container-low px-1.5 py-0.5 text-[10px] text-on-surface-variant">内径 {measurementQuery.inner}mm</span>}
                        {measurementQuery.pitchMm && <span className="rounded bg-surface-container-low px-1.5 py-0.5 text-[10px] text-on-surface-variant">{measurementQuery.pitchLabel || `${measurementQuery.pitchMm.toFixed(2)}mm`}</span>}
                      </div>
                    </div>
                    {matchedThreads.length ? (
                      <div>
                        <div className={TABLE_SCROLL}>
                          <table className={`${TABLE_BASE} min-w-[760px]`}>
                            <thead data-thread-tool-block-wheel className={TABLE_HEAD}>
                              <tr>
                                <th className={TABLE_FIRST_TH}>结果</th>
                                <th className={TABLE_TH}>规格</th>
                                <th className={TABLE_TH}>类型</th>
                                <th className={TABLE_TH}>外径差</th>
                                <th className={TABLE_TH}>内径差</th>
                                <th className={TABLE_TH}>牙距差</th>
                                <th className={TABLE_TH}>结构</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-outline-variant/10">
                              {matchedThreads.map(({ item, diameterDiff, innerDiff, pitchDiff }, index) => (
                                <tr key={item.size} onClick={() => applyResultAsSearch(item.size)} className="cursor-pointer text-on-surface transition-colors hover:bg-surface-container-high/30 active:bg-primary-container/10">
                                  <td className={TABLE_FIRST_TD}>
                                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${index === 0 ? "bg-green-500/10 text-green-600" : "bg-surface-container-high text-on-surface-variant"}`}>
                                      {index === 0 ? "最接近" : `第 ${index + 1}`}
                                    </span>
                                  </td>
                                  <td className={`${TABLE_TD} font-semibold`}>{item.size}</td>
                                  <td className={`${TABLE_TD} text-on-surface-variant`}>{item.familyLabel}</td>
                                  <td className={`${TABLE_TD} tabular-nums`}>{measurementQuery.outer ? `${diameterDiff.toFixed(2)} mm` : "-"}</td>
                                  <td className={`${TABLE_TD} tabular-nums`}>{measurementQuery.inner ? `${innerDiff.toFixed(2)} mm` : "-"}</td>
                                  <td className={`${TABLE_TD} tabular-nums`}>{measurementQuery.pitchMm ? `${pitchDiff.toFixed(2)} mm` : "-"}</td>
                                  <td className={TABLE_TD}>{threadAngleText(item)} / {threadTaperText(item)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="px-3 py-8 text-center text-xs text-on-surface-variant">
                        暂未匹配到接近规格，可补充牙距、牙数或内径再试。
                      </div>
                    )}
                </div>
              </section>
            )}

            {/* ── Thread Results ── */}
            {showTechnicalResults && visibleTab === "thread" && (
              <section className="h-full">
                <div className={TABLE_CARD}>
                  <div data-thread-tool-block-wheel className="flex items-center justify-between gap-3 border-b border-outline-variant/10 px-3 py-2.5 md:px-4">
                    <div className="min-w-0">
                      <h2 className="text-sm font-bold text-on-surface">螺纹速查表</h2>
                      <p className="line-clamp-1 text-[11px] text-on-surface-variant/60">外径、底孔/小径、牙数、牙型角和锥度结构</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="block text-xs text-on-surface-variant">{displayedThreads.length} 项</span>
                      <span className="hidden text-[10px] text-on-surface-variant/50 sm:block">点击行搜索</span>
                    </div>
                  </div>
                  <div className={TABLE_SCROLL}>
                    <table className={`${TABLE_BASE} min-w-[1080px]`}>
                      <thead data-thread-tool-block-wheel className={TABLE_HEAD}>
                        <tr>
                          <th className={`${TABLE_FIRST_TH} min-w-28`}>规格</th>
                          <th className={TABLE_TH}>类型</th>
                          <th className={TABLE_TH}>外径参考</th>
                          <th className={TABLE_TH}>底孔/小径参考</th>
                          <th className={TABLE_TH}>牙距 / 牙数</th>
                          <th className={TABLE_TH}>牙型角</th>
                          <th className={TABLE_TH}>锥度/结构</th>
                          <th className={TABLE_TH}>密封方式</th>
                          <th className={TABLE_TH}>备注</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/10">
                        {displayedThreads.map((item) => (
                          <tr key={`${item.family}-${item.size}`} onClick={() => applyResultAsSearch(item.size)} className="cursor-pointer text-on-surface transition-colors hover:bg-surface-container-high/30 active:bg-primary-container/10">
                            <td className={`${TABLE_FIRST_TD} min-w-28`}>{item.size}</td>
                            <td className={`${TABLE_TD} text-on-surface-variant`}>{item.familyLabel}</td>
                            <td className={`${TABLE_TD} tabular-nums`}>{item.majorMm.toFixed(3)} mm</td>
                            <td className={TABLE_TD}>{threadInnerReference(item)}</td>
                            <td className={TABLE_TD}>{threadPitchText(item)}</td>
                            <td className={TABLE_TD}>{threadAngleText(item)}</td>
                            <td className={TABLE_TD}>{threadTaperText(item)}</td>
                            <td className={TABLE_TD}>{item.seal}</td>
                            <td className={`${TABLE_TD} text-on-surface-variant`}>{item.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* ── Pipe Results ── */}
            {showTechnicalResults && visibleTab === "pipe" && (
              <section className="h-full">
                <div className={TABLE_CARD}>
                  <div data-thread-tool-block-wheel className="flex items-center justify-between gap-3 border-b border-outline-variant/10 px-3 py-2.5 md:px-4">
                    <div className="min-w-0">
                      <h2 className="text-sm font-bold text-on-surface">管径对照</h2>
                      <p className="line-clamp-1 text-[11px] text-on-surface-variant/60">DN、公称英寸、常见钢管外径参考</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="block text-xs text-on-surface-variant">{filteredPipes.length} 项</span>
                      <span className="hidden text-[10px] text-on-surface-variant/50 sm:block">点击行搜索</span>
                    </div>
                  </div>
                  <div className={TABLE_SCROLL}>
                    <table className={`${TABLE_BASE} min-w-[620px]`}>
                      <thead data-thread-tool-block-wheel className={TABLE_HEAD}>
                        <tr>
                          <th className={`${TABLE_FIRST_TH} min-w-20`}>DN</th>
                          <th className={TABLE_TH}>英寸</th>
                          <th className={TABLE_TH}>外径参考</th>
                          <th className={TABLE_TH}>常见用途</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/10">
                        {filteredPipes.map((item) => (
                          <tr key={item.dn} onClick={() => applyResultAsSearch(item.dn)} className="cursor-pointer text-on-surface transition-colors hover:bg-surface-container-high/30 active:bg-primary-container/10">
                            <td className={`${TABLE_FIRST_TD} min-w-20`}>{item.dn}</td>
                            <td className={TABLE_TD}>{item.inch}"</td>
                            <td className={`${TABLE_TD} tabular-nums`}>Ø {item.odMm.toFixed(1)} mm</td>
                            <td className={`${TABLE_TD} text-on-surface-variant`}>{item.commonUse}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* ── Hose Results ── */}
            {showTechnicalResults && visibleTab === "hose" && (
              <section className="h-full">
                <div className={TABLE_CARD}>
                  <div data-thread-tool-block-wheel className="flex items-center justify-between gap-3 border-b border-outline-variant/10 px-3 py-2.5 md:px-4">
                    <div className="min-w-0">
                      <h2 className="text-sm font-bold text-on-surface">管路速查</h2>
                      <p className="line-clamp-1 text-[11px] text-on-surface-variant/60">油管、气管、内外径、压力范围和常配接头</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="block text-xs text-on-surface-variant">{filteredHoses.length} 项</span>
                      <span className="hidden text-[10px] text-on-surface-variant/50 sm:block">点击行搜索</span>
                    </div>
                  </div>
                  <div className={TABLE_SCROLL}>
                    <table className={`${TABLE_BASE} min-w-[980px]`}>
                      <thead data-thread-tool-block-wheel className={TABLE_HEAD}>
                        <tr>
                          <th className={`${TABLE_FIRST_TH} min-w-24`}>规格</th>
                          <th className={TABLE_TH}>类型</th>
                          <th className={TABLE_TH}>公称/外径</th>
                          <th className={TABLE_TH}>内径</th>
                          <th className={TABLE_TH}>外径范围</th>
                          <th className={TABLE_TH}>常见压力</th>
                          <th className={TABLE_TH}>常配接头</th>
                          <th className={TABLE_TH}>应用</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/10">
                        {filteredHoses.map((item) => (
                          <tr key={item.dash} onClick={() => applyResultAsSearch(item.dash)} className="cursor-pointer text-on-surface transition-colors hover:bg-surface-container-high/30 active:bg-primary-container/10">
                            <td className={`${TABLE_FIRST_TD} min-w-24`}>
                              <span className="rounded-md bg-primary-container/10 px-2 py-1 font-semibold text-primary-container">{item.dash}</span>
                            </td>
                            <td className={TABLE_TD}>{item.kind || "液压油管"}</td>
                            <td className={TABLE_TD}>{item.kind === "气管" ? item.nominalInch : `${item.nominalInch}"`}</td>
                            <td className={`${TABLE_TD} tabular-nums`}>{item.innerMm.toFixed(1)} mm</td>
                            <td className={TABLE_TD}>Ø {item.outerRangeMm} mm</td>
                            <td className={TABLE_TD}>{item.pressureMpa} MPa</td>
                            <td className={`${TABLE_TD} font-medium`}>{item.jic}</td>
                            <td className={`${TABLE_TD} text-on-surface-variant`}>{item.commonUse}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="border-t border-outline-variant/10 px-4 py-3 text-xs leading-5 text-on-surface-variant/60">
                    油管压力会随层数、结构和品牌变化；气管压力会随 PU/PA 材质、温度和厂家规格变化，最终按具体样本确认。
                  </div>
                </div>
              </section>
            )}

            {/* ── No Results ── */}
            {showNoResults && (
              <section className="h-full overflow-y-auto px-4 py-10 text-center">
                <Icon name="search_off" size={36} className="mx-auto mb-3 text-on-surface-variant/20" />
                <h2 className="text-sm font-bold text-on-surface">没有找到匹配结果</h2>
                <p className="mt-1.5 text-xs text-on-surface-variant/70">换成规格、俗称、型号片段或测量值再试<br />例如 G1/2、4分、DN25、-06、20.9 14牙</p>
              </section>
            )}
          </div>
            </AdminContentPanel>
          </AdminManagementPage>
    </AdminPageShell>
  );
}
