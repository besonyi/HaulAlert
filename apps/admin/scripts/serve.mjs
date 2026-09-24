import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

const adminPort = readPort(process.env.ADMIN_PORT, 3003);
const apiOrigin = process.env.ADMIN_API_ORIGIN ?? "http://127.0.0.1:3001";
const staticRoot = resolve("dist");

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      await proxyApi(request, response, url);
      return;
    }
    await serveStatic(response, url.pathname);
  } catch {
    response.statusCode = 500;
    response.end("Internal server error");
  }
}).listen(adminPort, () => {
  console.info(`HaulAlert Admin listening on http://127.0.0.1:${adminPort}`);
});

async function serveStatic(response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = resolve(staticRoot, relativePath);
  if (!filePath.startsWith(`${staticRoot}${sep}`) && filePath !== staticRoot) {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }
  try {
    const body = await readFile(filePath);
    response.statusCode = 200;
    response.setHeader("content-type", contentType(filePath));
    response.setHeader("cache-control", filePath.endsWith("index.html") ? "no-store" : "public, max-age=300");
    response.end(body);
  } catch {
    response.statusCode = 404;
    response.end("Not found");
  }
}

async function proxyApi(request, response, url) {
  const target = new URL(`${url.pathname.slice(4)}${url.search}`, apiOrigin);
  const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => name !== "host" && name !== "connection"));
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request);
  const upstream = await fetch(target, { method: request.method, headers, body });
  response.statusCode = upstream.status;
  for (const name of ["content-type", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value !== null) response.setHeader(name, value);
  }
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function readPort(value, fallback) {
  if (value === undefined || value.trim() === "") return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("ADMIN_PORT must be 1 through 65535");
  return port;
}
