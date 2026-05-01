#!/usr/bin/env node

import { spawn } from "node:child_process";

const timeoutMs = Number(process.env.STACK_CHECK_TIMEOUT_MS || 5000);
const requireVite = process.env.CHECK_VITE === "1";
const skipDb = process.env.SKIP_DB === "1";

const apiBaseUrl = (process.env.LOCAL_API_URL || "http://localhost:8000").replace(/\/+$/, "");
const viteBaseUrl = (process.env.LOCAL_VITE_URL || "http://localhost:5173").replace(/\/+$/, "");

const checks = [
  {
    name: "API health",
    url: `${apiBaseUrl}/api/health`,
    required: true,
    expectSuccess: true,
  },
  {
    name: "Vite proxy health",
    url: `${viteBaseUrl}/api/health`,
    required: requireVite,
    expectSuccess: true,
  },
  {
    name: "Vite proxy models",
    url: `${viteBaseUrl}/api/models?page=1&page_size=1&grouped=true&sort=created_at`,
    required: requireVite,
    expectSuccess: true,
  },
  {
    name: "Vite proxy product wall",
    url: `${viteBaseUrl}/api/product-wall`,
    required: requireVite,
    expectSuccess: true,
  },
  {
    name: "Vite proxy product wall categories",
    url: `${viteBaseUrl}/api/product-wall/categories`,
    required: requireVite,
    expectSuccess: true,
  },
];

function withTimeout(promise, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(`${label} timed out after ${timeoutMs}ms`), timeoutMs);

  return promise(controller.signal).finally(() => clearTimeout(timer));
}

async function readJsonResponse(url, signal) {
  const response = await fetch(url, { signal });
  const text = await response.text();
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    // Keep the raw text in the diagnostic below.
  }

  return { response, text, json };
}

async function checkHttpEndpoint(check) {
  try {
    const { response, text, json } = await withTimeout(
      (signal) => readJsonResponse(check.url, signal),
      check.name,
    );
    const ok = response.ok && (!check.expectSuccess || json?.success === true);

    if (!ok) {
      const preview = text.replace(/\s+/g, " ").slice(0, 180);
      return {
        ok: false,
        required: check.required,
        message: `${check.name}: HTTP ${response.status} ${response.statusText}${preview ? ` - ${preview}` : ""}`,
      };
    }

    return {
      ok: true,
      required: check.required,
      message: `${check.name}: OK (${response.status})`,
    };
  } catch (error) {
    return {
      ok: false,
      required: check.required,
      message: `${check.name}: ${error?.message || String(error)}`,
    };
  }
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ ok: false, stdout: "", stderr: error.message });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

async function checkDatabase() {
  if (skipDb) {
    return [{ ok: true, required: false, message: "Postgres diagnostics skipped (SKIP_DB=1)" }];
  }

  const sql = [
    "select 'max_connections=' || current_setting('max_connections');",
    "select 'connections=' || count(*) from pg_stat_activity;",
    "select 'waiting_locks=' || count(*) from pg_locks where not granted;",
  ].join(" ");

  const result = await runCommand("docker", [
    "exec",
    "3dparthub-postgres",
    "psql",
    "-U",
    "modeluser",
    "-d",
    "3dparthub",
    "-At",
    "-c",
    sql,
  ]);

  if (!result.ok) {
    return [{
      ok: false,
      required: false,
      message: `Postgres diagnostics unavailable: ${(result.stderr || result.stdout).trim()}`,
    }];
  }

  const values = Object.fromEntries(
    result.stdout.trim().split(/\n+/).map((line) => {
      const [key, value] = line.split("=");
      return [key, Number(value)];
    }),
  );
  const messages = [
    {
      ok: true,
      required: false,
      message: `Postgres connections: ${values.connections}/${values.max_connections}`,
    },
    {
      ok: values.waiting_locks === 0,
      required: false,
      message: `Postgres waiting locks: ${values.waiting_locks}`,
    },
  ];

  if (values.max_connections && values.connections / values.max_connections >= 0.8) {
    messages.push({
      ok: false,
      required: true,
      message: "Postgres connection usage is above 80%; check Prisma pool limits and API_WORKERS.",
    });
  }

  return messages;
}

const httpResults = await Promise.all(checks.map(checkHttpEndpoint));
const dbResults = await checkDatabase();
const results = [...httpResults, ...dbResults];

for (const result of results) {
  const icon = result.ok ? "PASS" : result.required ? "FAIL" : "WARN";
  console.log(`[${icon}] ${result.message}`);
}

const failed = results.some((result) => !result.ok && result.required);

if (failed) {
  console.error("\nLocal stack check failed.");
  console.error("Tip: daily local development uses Vite 5173 + API 8000. If 5173 is occupied, stop the old Vite process instead of using 5174/5175.");
  process.exit(1);
}

console.log("\nLocal stack check completed.");
