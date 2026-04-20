import { execSync } from "child_process";

interface UpdateJob {
  id: string;
  stage: "pulling" | "building" | "restarting" | "done" | "error";
  percent: number;
  message: string;
  error?: string;
}

const jobs = new Map<string, UpdateJob>();

export function getUpdateJob(id: string): UpdateJob | undefined {
  return jobs.get(id);
}

export function checkUpdateAvailable(): { current: string; remote: string; updateAvailable: boolean } {
  const projectDir = "/project";
  const defaultResult = { current: "unknown", remote: "unknown", updateAvailable: false };

  try {
    const current = execSync("git rev-parse --short HEAD", { cwd: projectDir, encoding: "utf-8" }).trim();
    let remote = "unknown";
    try {
      execSync("git fetch origin main", { cwd: projectDir, encoding: "utf-8", timeout: 30000, stdio: "pipe" });
      remote = execSync("git rev-parse --short origin/main", { cwd: projectDir, encoding: "utf-8" }).trim();
    } catch {
      // fetch failed (no network, etc.)
    }
    return { current, remote, updateAvailable: current !== remote && remote !== "unknown" };
  } catch {
    return defaultResult;
  }
}

export function startUpdateJob(): string {
  const id = `update_${Date.now()}`;
  const job: UpdateJob = { id, stage: "pulling", percent: 0, message: "正在拉取最新代码..." };
  jobs.set(id, job);

  runUpdate(job).catch((err) => {
    job.stage = "error";
    job.error = err instanceof Error ? err.message : String(err);
    console.error(`[Update #${job.id}] Error:`, job.error);
  });

  return id;
}

async function runUpdate(job: UpdateJob) {
  const projectDir = "/project";
  const composeFile = "docker-compose.prod.yml";

  // Step 1: Pull latest code (0-30%)
  job.stage = "pulling";
  job.percent = 5;
  job.message = "正在拉取最新代码...";

  try {
    execSync("git fetch origin main", { cwd: projectDir, encoding: "utf-8", timeout: 120000, stdio: "pipe" });
    job.percent = 15;
    job.message = "正在合并代码...";

    execSync("git reset --hard origin/main", { cwd: projectDir, encoding: "utf-8", timeout: 60000, stdio: "pipe" });
    job.percent = 30;
    job.message = "代码已更新";
  } catch (err: any) {
    throw new Error(`拉取代码失败: ${err.message}`);
  }

  // Step 2: Build new images (30-80%)
  job.stage = "building";
  job.percent = 35;
  job.message = "正在构建 API 服务...";

  try {
    execSync(`docker-compose -f ${composeFile} build api`, {
      cwd: projectDir, encoding: "utf-8", timeout: 600000, stdio: "pipe",
    });
    job.percent = 60;
    job.message = "正在构建前端服务...";

    execSync(`docker-compose -f ${composeFile} build web`, {
      cwd: projectDir, encoding: "utf-8", timeout: 600000, stdio: "pipe",
    });
    job.percent = 80;
    job.message = "构建完成";
  } catch (err: any) {
    throw new Error(`构建失败: ${err.message}`);
  }

  // Step 3: Restart services (80-100%)
  // NOTE: This will restart the API container itself, killing this process.
  // The client should handle the disconnect gracefully.
  job.stage = "restarting";
  job.percent = 85;
  job.message = "正在重启服务（连接即将断开）...";

  try {
    execSync(`docker-compose -f ${composeFile} up -d`, {
      cwd: projectDir, encoding: "utf-8", timeout: 120000, stdio: "pipe",
    });
    job.percent = 100;
    job.message = "更新完成";
    job.stage = "done";
  } catch (err: any) {
    // The container restart may kill this process before we can catch the error.
    // That's expected behavior.
    throw new Error(`重启失败: ${err.message}`);
  }
}
