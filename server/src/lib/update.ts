import { execSync } from "child_process";
import { openSync, closeSync, writeSync, statSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { syncJob, loadJob } from "./jobStore.js";

interface UpdateJob {
  id: string;
  stage: "prechecking" | "pulling" | "building" | "restarting" | "done" | "error";
  percent: number;
  message: string;
  error?: string;
  logs: string[];
}

interface ComposeInfo {
  project: string;
  /** Absolute paths on the host */
  configFiles: string[];
}

const jobs = new Map<string, UpdateJob>();

// --- Cross-worker file lock (same pattern as backup.ts) ---
const UPDATE_LOCK_FILE = join(process.cwd(), config.uploadDir, ".update.lock");

function acquireUpdateLock(): boolean {
  try {
    const fd = openSync(UPDATE_LOCK_FILE, "wx");
    writeSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
    closeSync(fd);
    return true;
  } catch {
    try {
      const { mtime } = statSync(UPDATE_LOCK_FILE);
      if (Date.now() - mtime.getTime() > 2 * 60 * 60 * 1000) {
        rmSync(UPDATE_LOCK_FILE, { force: true });
        return acquireUpdateLock();
      }
    } catch {}
    return false;
  }
}

function releaseUpdateLock(): void {
  try { rmSync(UPDATE_LOCK_FILE, { force: true }); } catch {}
}

/**
 * Detect host project directory via Docker API.
 */
function detectHostProjectDir(): string | null {
  try {
    const containerId = readFileSync("/etc/hostname", "utf-8").trim();
    const result = execSync(
      `curl -sf --unix-socket /var/run/docker.sock "http://localhost/containers/${containerId}/json"`,
      { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    );
    const info = JSON.parse(result);
    const mounts: Array<{ Destination: string; Source: string }> = info.Mounts || [];
    const projectMount = mounts.find((m) => m.Destination === "/project");
    return projectMount?.Source || null;
  } catch {
    return null;
  }
}

/**
 * Detect compose project info from the current container's labels.
 * Returns { project, configFiles } or null if not detectable.
 */
function detectComposeInfo(): ComposeInfo | null {
  try {
    const containerId = readFileSync("/etc/hostname", "utf-8").trim();
    const result = execSync(
      `curl -sf --unix-socket /var/run/docker.sock "http://localhost/containers/${containerId}/json"`,
      { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    );
    const info = JSON.parse(result);
    const labels: Record<string, string> = info.Config?.Labels || {};
    const project = labels["com.docker.compose.project"];
    const configFilesStr = labels["com.docker.compose.project.config_files"];
    if (!project || !configFilesStr) return null;
    // config_files may be comma-separated (multiple -f files)
    const configFiles = configFilesStr.split(",").map((f: string) => f.trim());
    return { project, configFiles };
  } catch {
    return null;
  }
}

export function getUpdateJob(id: string): UpdateJob | undefined {
  return jobs.get(id) || loadJob<UpdateJob>(id);
}

function addLog(job: UpdateJob, text: string) {
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  job.logs.push(`[${time}] ${text}`);
  console.log(`[Update #${job.id}] ${text}`);
  syncJob(job);
}

/**
 * Get local version tag/hash without any network requests.
 * Safe for public endpoints.
 */
export function getLocalVersion(): string {
  // Priority 1: VERSION file (injected by Docker build)
  try {
    const version = readFileSync("/app/VERSION", "utf-8").trim();
    if (version && version !== "dev") return version;
  } catch { /* no VERSION file */ }

  // Priority 2: git tag (when deployed with source code)
  const projectDir = "/project";
  try {
    return execSync("git describe --tags --abbrev=0", { cwd: projectDir, encoding: "utf-8", timeout: 3000, stdio: "pipe" }).trim();
  } catch {
    try {
      return execSync("git rev-parse --short HEAD", { cwd: projectDir, encoding: "utf-8", timeout: 3000, stdio: "pipe" }).trim();
    } catch {
      return "unknown";
    }
  }
}

export function checkUpdateAvailable(): { current: string; remote: string; updateAvailable: boolean; warning?: string } {
  const projectDir = "/project";
  const defaultResult = { current: "unknown", remote: "unknown", updateAvailable: false, warning: undefined as string | undefined };

  try {
    execSync("git rev-parse --git-dir", { cwd: projectDir, encoding: "utf-8", timeout: 3000, stdio: "pipe" });
  } catch {
    defaultResult.warning = "当前环境不支持自动更新（缺少项目目录或 Git）";
    return defaultResult;
  }

  const composeInfo = detectComposeInfo();
  if (!composeInfo) {
    defaultResult.warning = "无法自动检测 Docker Compose 项目信息，请确保容器挂载了 Docker Socket";
  }

  try {
    // Current version
    const currentTag = getLocalVersion();
    const currentHash = execSync("git rev-parse HEAD", { cwd: projectDir, encoding: "utf-8" }).trim();

    // Fetch remote
    let remoteTag = "unknown";
    let remoteHash = "unknown";
    try {
      execSync("git fetch origin main --tags", { cwd: projectDir, encoding: "utf-8", timeout: 30000, stdio: "pipe" });
      remoteHash = execSync("git rev-parse origin/main", { cwd: projectDir, encoding: "utf-8" }).trim();
      try {
        remoteTag = execSync("git describe --tags --abbrev=0 origin/main", { cwd: projectDir, encoding: "utf-8" }).trim();
      } catch {
        remoteTag = execSync("git rev-parse --short origin/main", { cwd: projectDir, encoding: "utf-8" }).trim();
      }
    } catch {
      // fetch failed
    }

    const updateAvailable = currentHash !== remoteHash && remoteHash !== "unknown";
    return { current: currentTag, remote: remoteTag, updateAvailable, warning: defaultResult.warning };
  } catch {
    return defaultResult;
  }
}

export function startUpdateJob(): string {
  if (!acquireUpdateLock()) {
    throw new Error("已有更新任务正在进行中，请等待完成后再试");
  }
  const id = `update_${Date.now()}`;
  const job: UpdateJob = { id, stage: "prechecking", percent: 0, message: "正在预检环境...", logs: [] };
  jobs.set(id, job);
  syncJob(job);

  runUpdate(job).catch((err) => {
    job.stage = "error";
    job.error = err instanceof Error ? err.message : String(err);
    syncJob(job);
    console.error(`[Update #${job.id}] Error:`, job.error);
  }).finally(() => {
    releaseUpdateLock();
  });

  return id;
}

async function runUpdate(job: UpdateJob) {
  const projectDir = "/project";

  // --- Pre-checks ---
  job.stage = "prechecking";
  job.percent = 2;
  job.message = "正在预检更新环境...";
  syncJob(job);
  addLog(job, "开始更新预检...");

  // Check 1: working tree clean
  try {
    const dirty = execSync("git status --porcelain", { cwd: projectDir, encoding: "utf-8", timeout: 5000, stdio: "pipe" }).trim();
    if (dirty) {
      throw new Error("工作区有未提交的修改，请先提交或暂存后再更新。执行 git stash 可临时保存修改。");
    }
    addLog(job, "工作区检查通过（无未提交修改）");
  } catch (err: any) {
    if (err.message?.includes("未提交")) throw err;
    addLog(job, "工作区检查失败，跳过");
  }

  // Check 2: current branch is main
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: projectDir, encoding: "utf-8", timeout: 5000, stdio: "pipe" }).trim();
    if (branch !== "main") {
      throw new Error(`当前分支为 ${branch}，自动更新仅支持 main 分支`);
    }
    addLog(job, `分支检查通过（当前: ${branch}）`);
  } catch (err: any) {
    if (err.message?.includes("仅支持")) throw err;
    addLog(job, "分支检查失败，跳过");
  }

  // Check 3: compose info detectable
  const composeInfo = detectComposeInfo();
  if (!composeInfo) {
    throw new Error("无法检测 Docker Compose 项目信息，请确保容器挂载了 Docker Socket 和项目目录");
  }
  addLog(job, `Compose 项目: ${composeInfo.project}, 配置: ${composeInfo.configFiles.join(", ")}`);

  // Also detect host project dir for compose file path resolution
  const hostProjectDir = detectHostProjectDir();
  if (!hostProjectDir) {
    throw new Error("无法检测宿主机项目路径");
  }
  addLog(job, `宿主机路径: ${hostProjectDir}`);

  job.percent = 10;
  syncJob(job);

  // --- Step 1: Pull latest code (10-30%) ---
  job.stage = "pulling";
  job.percent = 15;
  job.message = "正在拉取最新代码...";
  syncJob(job);
  addLog(job, "开始从 GitHub 拉取最新代码...");

  try {
    addLog(job, "执行 git fetch origin main...");
    execSync("git fetch origin main --tags", { cwd: projectDir, encoding: "utf-8", timeout: 120000, stdio: "pipe" });
    job.percent = 20;
    job.message = "正在合并代码...";
    syncJob(job);
    addLog(job, "拉取成功，开始合并代码...");
    execSync("git reset --hard origin/main", { cwd: projectDir, encoding: "utf-8", timeout: 60000, stdio: "pipe" });
    const newHash = execSync("git rev-parse --short HEAD", { cwd: projectDir, encoding: "utf-8" }).trim();
    const newTag = getLocalVersion();
    job.percent = 30;
    job.message = "代码已更新";
    syncJob(job);
    addLog(job, `代码合并成功: ${newTag} (${newHash})`);
  } catch (err: any) {
    addLog(job, `拉取代码失败: ${err.message}`);
    throw new Error(`拉取代码失败: ${err.message}`);
  }

  // --- Build compose command with detected project info ---
  // Config files are absolute host paths — use them directly in the host-side compose invocation
  const configFlags = composeInfo.configFiles.map((f: string) => `-f ${f}`).join(" ");
  const composeCmd = `docker-compose ${configFlags} -p ${composeInfo.project}`;

  try {
    // --- Step 2: Build new images (30-80%) ---
    job.stage = "building";
    job.percent = 35;
    job.message = "正在构建 API 服务...";
    syncJob(job);
    addLog(job, "开始构建 API 服务镜像（可能需要几分钟）...");

    execSync(`${composeCmd} build api`, {
      cwd: projectDir, encoding: "utf-8", timeout: 600000, stdio: "pipe",
    });
    job.percent = 60;
    job.message = "正在构建前端服务...";
    syncJob(job);
    addLog(job, "API 服务构建完成，开始构建前端...");

    execSync(`${composeCmd} build web`, {
      cwd: projectDir, encoding: "utf-8", timeout: 600000, stdio: "pipe",
    });
    job.percent = 80;
    job.message = "构建完成";
    syncJob(job);
    addLog(job, "前端服务构建完成");

    // --- Step 3: Restart services (80-95%) ---
    job.stage = "restarting";
    job.percent = 85;
    job.message = "正在重启服务...";
    syncJob(job);
    addLog(job, "开始重启服务...");

    execSync(`${composeCmd} up -d`, {
      cwd: projectDir, encoding: "utf-8", timeout: 120000, stdio: "pipe",
    });
    job.percent = 90;
    job.message = "服务重启中，等待健康检查...";
    syncJob(job);
    addLog(job, "服务已重启，等待健康检查...");

    // --- Step 4: Health check (90-100%) ---
    let healthy = false;
    for (let i = 1; i <= 20; i++) {
      try {
        const health = execSync("curl -sf http://localhost:3780/api/health", {
          encoding: "utf-8", timeout: 5000, stdio: "pipe",
        });
        if (health.includes("ok")) {
          healthy = true;
          addLog(job, `健康检查通过（第 ${i} 次）`);
          break;
        }
      } catch {
        // not ready yet
      }
      if (i < 20) {
        addLog(job, `等待服务就绪... (${i}/20)`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    if (!healthy) {
      addLog(job, "警告: 健康检查超时（60 秒），服务可能未完全启动，请手动检查");
      job.percent = 100;
      job.message = "更新完成（健康检查超时）";
      job.stage = "done";
      syncJob(job);
      addLog(job, "更新流程结束（健康检查未通过）");
    } else {
      job.percent = 100;
      job.message = "更新完成";
      job.stage = "done";
      syncJob(job);
      addLog(job, "更新完成！服务已正常运行");
    }
  } catch (err: any) {
    addLog(job, `构建/重启失败: ${err.message}`);
    throw new Error(`构建/重启失败: ${err.message}`);
  }
}
