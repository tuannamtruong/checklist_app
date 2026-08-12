// Serves the app to THIS device's own browser, and optionally hands it the
// shared folder.
//
//   node install/serve.mjs                             # Chrome/Edge: pick the folder in the page
//   node install/serve.mjs --folder ~/Dropbox/checklist # any browser, incl. Firefox and Safari
//
// It binds to 127.0.0.1 on purpose: no other device can reach it, and no device
// ever syncs through it. Two devices could run different bridges, or none, and
// still sync — the only shared thing is the folder itself.
//
// Two reasons this process exists:
//   1. Browsers refuse the File System Access API on file:// — a secure context
//      means https:// or http://localhost.
//   2. Firefox and Safari have no File System Access API at all, so on those
//      the folder has to be handed over by something already trusted with it.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  basename,
  dirname,
  extname,
  join,
  normalize,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { nodeFolder } from "../adapters/node-folder.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 5175);

const argAt = process.argv.indexOf("--folder");
const FOLDER = argAt === -1 ? null : resolve(process.argv[argAt + 1] ?? "");
const folder = FOLDER ? nodeFolder(FOLDER) : null;

// The bridge exposes one folder and only the app's own files in it. A page is
// never allowed to name an arbitrary path — the folder is fixed at startup and
// the filename must match the app's own pattern.
const SAFE_NAME = /^checklist\.[\w-]{1,64}\.json$/;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": MIME[".json"],
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
};

async function handleFolder(req, res, pathname) {
  if (pathname === "/folder/info") {
    return json(
      res,
      200,
      folder
        ? { configured: true, name: basename(FOLDER), path: FOLDER }
        : { configured: false },
    );
  }
  if (!folder)
    return json(res, 409, {
      error: "no folder configured; start with --folder <dir>",
    });

  if (pathname === "/folder/files") {
    const names = (await folder.list()).filter((n) => SAFE_NAME.test(n));
    return json(res, 200, names);
  }

  const name = decodeURIComponent(pathname.slice("/folder/file/".length));
  if (!SAFE_NAME.test(name)) return json(res, 400, { error: "bad file name" });

  if (req.method === "GET") {
    const content = await folder.read(name);
    if (content === null) return json(res, 404, { error: "not found" });
    res.writeHead(200, {
      "content-type": MIME[".json"],
      "cache-control": "no-store",
    });
    return res.end(content);
  }

  if (req.method === "PUT") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString("utf8");
    JSON.parse(body); // reject anything that is not a snapshot before it hits the folder
    await folder.write(name, body);
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: "method not allowed" });
}

createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname.startsWith("/folder/"))
      return await handleFolder(req, res, pathname);

    const rel = pathname === "/" ? "/public/index.html" : pathname;
    const path = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ""));
    if (!path.startsWith(ROOT) || !existsSync(path))
      return res.writeHead(404).end("not found");

    res.writeHead(200, {
      "content-type": MIME[extname(path)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(await readFile(path));
  } catch (err) {
    json(res, 500, { error: String(err) });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(
    `app on http://localhost:${PORT}  (this device only — not reachable from the network)`,
  );
  if (folder) console.log(`serving folder ${FOLDER} — works in any browser`);
  else
    console.log(
      "no --folder given: Chrome/Edge can pick one in the page; Firefox/Safari need --folder",
    );
});
