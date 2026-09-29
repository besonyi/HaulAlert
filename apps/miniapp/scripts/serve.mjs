import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

const miniAppPort = readPort(process.env.MINIAPP_PORT, 3002);
const apiOrigin = process.env.MINIAPP_API_ORIGIN ?? "http://127.0.0.1:3001";
const staticRoot = resolve("dist");
const maximumRequestBodyBytes = 1_000_000;
const apiRequestTimeoutMs = readPositiveInteger(process.env.MINIAPP_API_REQUEST_TIMEOUT_MS, 15_000, "MINIAPP_API_REQUEST_TIMEOUT_MS");

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      await proxyApi(request, response, url);
      return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    response.statusCode = error instanceof RequestBodyTooLargeError ? 413 : error instanceof ApiRequestTimeoutError ? 504 : 500;
    response.end(response.statusCode === 413 ? "Request body too large" : response.statusCode === 504 ? "API request timed out" : "Internal server error");
  }
}).listen(miniAppPort, () => {
  console.info(`HaulAlert Mini App listening on http://127.0.0.1:${miniAppPort}`);
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
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(([name]) => name !== "host" && name !== "connection")
  );
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request);
  const upstream = await fetchApi(target, { method: request.method, headers, body });
  response.statusCode = upstream.status;
  for (const name of ["content-type", "cache-control", "x-request-id"]) {
    const value = upstream.headers.get(name);
    if (value !== null) response.setHeader(name, value);
  }
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maximumRequestBodyBytes) throw new RequestBodyTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

class RequestBodyTooLargeError extends Error {}
class ApiRequestTimeoutError extends Error {}

async function fetchApi(target, init) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), apiRequestTimeoutMs);
  try {
    return await fetch(target, { ...init, signal: abortController.signal });
  } catch (error) {
    if (abortController.signal.aborted) throw new ApiRequestTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MINIAPP_PORT must be 1 through 65535");
  return port;
}

function readPositiveInteger(value, fallback, name) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
