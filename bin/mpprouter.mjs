#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsx = join(__dirname, "..", "node_modules", ".bin", "tsx");
const client = join(__dirname, "..", "src", "mcp", "client.ts");

const child = spawn(tsx, [client], { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code || 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
