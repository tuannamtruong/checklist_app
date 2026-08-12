// The same sync core against a real folder, from a terminal. Useful for
// pointing at an actual Dropbox/OneDrive folder before trusting the browser
// half, and for reading what the phone wrote.
//
//   node prototype/install/cli.mjs <folder> <deviceId>                 # show
//   node prototype/install/cli.mjs <folder> <deviceId> "new text"      # edit
//   node prototype/install/cli.mjs <folder> <deviceId> --resolve 1     # pick side 1
//   node prototype/install/cli.mjs <folder> <deviceId> --watch         # poll

import { createDevice } from "../core/folder-sync.mjs";
import { nodeFolder } from "../adapters/node-folder.mjs";
import { fileNameFor } from "../core/device.mjs";

const [dir, deviceId, ...rest] = process.argv.slice(2);
if (!dir || !deviceId) {
  console.error(
    "usage: cli.mjs <folder> <deviceId> [text | --resolve <n> | --watch]",
  );
  process.exit(2);
}

const device = createDevice({ deviceId, folder: nodeFolder(dir) });
await device.load();

function report() {
  if (device.conflict) {
    console.log(
      `\nCONFLICT — ${device.conflict.length} versions raced. This is local to ${deviceId}; nothing was written.`,
    );
    device.conflict.forEach((s, i) =>
      console.log(`  [${i}] ${s.author.padEnd(10)} ${JSON.stringify(s.text)}`),
    );
    console.log(`\n  resolve with:  --resolve <n>\n`);
    return;
  }
  const s = device.state;
  console.log(
    s
      ? `${JSON.stringify(s.text)}   (by ${s.author}, clock ${JSON.stringify(s.clock)})`
      : "(nothing yet)",
  );
}

const resolveAt = rest.indexOf("--resolve");
if (resolveAt !== -1) {
  await device.sync();
  const pick = device.conflict?.[Number(rest[resolveAt + 1])];
  if (!pick) {
    console.error("no such side");
    process.exit(1);
  }
  await device.resolve(pick.text);
  console.log(
    `resolved to ${JSON.stringify(pick.text)} — wrote ${fileNameFor(deviceId)}`,
  );
} else if (rest[0] === "--watch") {
  console.log(`watching ${dir} as ${deviceId} — ctrl-c to stop`);
  let last;
  for (;;) {
    await device.sync();
    const line = JSON.stringify([
      device.state?.text,
      device.conflict?.length ?? 0,
    ]);
    if (line !== last) {
      last = line;
      report();
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
} else if (rest.length) {
  await device.sync();
  if (device.conflict) report();
  else {
    await device.edit(rest.join(" "));
    console.log(`wrote ${fileNameFor(deviceId)}`);
    report();
  }
} else {
  await device.sync();
  report();
}
