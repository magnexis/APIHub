const { spawn } = require("node:child_process");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const backendUrl = "http://127.0.0.1:8787";
const frontendUrl = "http://127.0.0.1:5173";

const children = [];
let browserOpened = false;

function prefixStream(child, label) {
  child.stdout?.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
}

function spawnProcess(command, args, options, label) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(child);
  prefixStream(child, label);
  return child;
}

function openBrowser(url) {
  if (browserOpened) {
    return;
  }
  browserOpened = true;
  const openCommand =
    process.platform === "win32"
      ? { command: "cmd", args: ["/c", "start", "", url] }
      : process.platform === "darwin"
        ? { command: "open", args: [url] }
        : { command: "xdg-open", args: [url] };
  spawn(openCommand.command, openCommand.args, {
    cwd: rootDir,
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  }).unref();
}

function terminate(code = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => terminate(0));
process.on("SIGTERM", () => terminate(0));
process.on("exit", () => {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
});

const backend = spawnProcess(
  process.platform === "win32" ? "py" : "python3",
  process.platform === "win32" ? ["-3", "-u", "-m", "backend.app.main"] : ["-u", "-m", "backend.app.main"],
  {
    cwd: rootDir,
    env: {
      ...process.env,
      MAGNEXIS_ALLOWED_ORIGINS: process.env.MAGNEXIS_ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173",
    },
  },
  "dev:backend",
);

const frontend = spawnProcess(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["--prefix", "frontend", "run", "dev:ui"],
  {
    cwd: rootDir,
    env: {
      ...process.env,
      VITE_MAGNEXIS_API_URL: process.env.VITE_MAGNEXIS_API_URL || backendUrl,
    },
  },
  "dev:web",
);

const browserTimer = setTimeout(() => openBrowser(frontendUrl), 2500);

frontend.stdout?.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  if (text.includes("Local:") || text.includes("Network:")) {
    openBrowser(frontendUrl);
  }
});

backend.on("exit", (code) => {
  clearTimeout(browserTimer);
  terminate(code ?? 1);
});

frontend.on("exit", (code) => {
  clearTimeout(browserTimer);
  terminate(code ?? 1);
});
