// Two devices, separate internet connections, one shared cloud folder.
//
//   node prototype/test/scenario.mjs
//
// Nothing here talks to a network, and the two devices never address each
// other. Each has its OWN local folder, exactly as it would on disk. A
// `deliver` step models what the Dropbox / Drive / OneDrive client does in the
// background: upload this device's file, download everyone else's. Being
// offline is simply not calling it.

import {
  mkdtemp,
  rm,
  readdir,
  readFile,
  writeFile,
  copyFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevice } from "../core/folder-sync.mjs";
import { nodeFolder } from "../adapters/node-folder.mjs";
import { deviceIdFrom, fileNameFor } from "../core/device.mjs";

let failures = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const fail = (name, why) => {
  failures++;
  console.log(`  FAIL ${name}\n       ${why}`);
};
const is = (name, actual, expected) =>
  actual === expected
    ? ok(name)
    : fail(
        name,
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );

const root = await mkdtemp(join(tmpdir(), "checklist-proto-"));
const CLOUD = join(root, "cloud");
const dirFor = (id) => join(root, id);

// A monotonic fake clock: `now` is a parameter everywhere in core/, so the
// scenario never depends on how fast the machine runs.
let tick = 0;
const now = () => new Date(Date.UTC(2026, 7, 12, 0, 0, ++tick)).toISOString();

// Fixed ids rather than generated ones: a device is identified by an id, never
// by its label, and pinning them keeps the assertions below readable.
const ID = { laptop: "1111aaaa", phone: "2222bbbb" };

// The pair has been syncing for a while before the scenario opens: 14 edits
// authored on the laptop, 2 on the phone, converged. Starting mid-history
// rather than from an empty folder keeps the counters from lining up, which is
// the ordinary case — a counter is only ever compared with the *same device's*
// counter in another vector, never with a different device's.
const SEED = {
  text: "Water the plants",
  sClock: { [ID.laptop]: 14, [ID.phone]: 2 },
};

async function seed(id, label) {
  await mkdir(dirFor(id), { recursive: true });
  await mkdir(CLOUD, { recursive: true });
  const body = `${JSON.stringify(
    {
      device: id,
      label,
      author: ID.laptop, // the last edit before the scenario was the laptop's
      text: SEED.text,
      sClock: SEED.sClock,
      updatedAt: now(),
    },
    null,
    2,
  )}\n`;
  await writeFile(join(dirFor(id), fileNameFor(id)), body);
  await writeFile(join(CLOUD, fileNameFor(id)), body);
}

async function device(id, label) {
  await seed(id, label);
  const d = createDevice({
    deviceId: id,
    label,
    folder: nodeFolder(dirFor(id)),
    now,
  });
  await d.load();
  return d;
}

/** The cloud client's background pass for one device. */
async function deliver(id) {
  await mkdir(CLOUD, { recursive: true });
  const mine = fileNameFor(id);
  const local = await readdir(dirFor(id));
  // up: only ever our own file — nothing else in the folder belongs to us
  if (local.includes(mine))
    await copyFile(join(dirFor(id), mine), join(CLOUD, mine));
  // down: everyone else's
  for (const name of await readdir(CLOUD)) {
    if (name !== mine)
      await copyFile(join(CLOUD, name), join(dirFor(id), name));
  }
}

const textOf = (d) => d.state?.text ?? null;
const sClockOf = (d) => JSON.stringify(d.state?.sClock);

console.log("\n1. laptop edits; phone starts up and sees it");
const laptop = await device(ID.laptop, "laptop");
const phone = await device(ID.phone, "phone");

await laptop.edit("Buy milk");
is(
  "only the laptop's own counter moved",
  sClockOf(laptop),
  '{"1111aaaa":15,"2222bbbb":2}',
);
await deliver(ID.laptop);
is("cloud still has one file per device", (await readdir(CLOUD)).length, 2);

await deliver(ID.phone);
await phone.sync();
is("phone sees the laptop's text", textOf(phone), "Buy milk");

console.log("\n2. phone edits; laptop sees it");
await phone.edit("Buy milk and eggs");
await deliver(ID.phone);
await deliver(ID.laptop);
await laptop.sync();
is("laptop sees the phone's edit", textOf(laptop), "Buy milk and eggs");
is("no conflict — the edit was causally after", laptop.conflict, null);

console.log("\n3. laptop goes offline and edits");
await laptop.edit("Buy milk, eggs and bread");
is("the edit is durable locally", textOf(laptop), "Buy milk, eggs and bread");
await deliver(ID.phone);
await phone.sync();
is(
  "the cloud is untouched — phone still on its own text",
  textOf(phone),
  "Buy milk and eggs",
);

console.log(
  "\n4. phone edits meanwhile, over the revision the laptop never saw",
);
await phone.edit("Buy oat milk");
await deliver(ID.phone);

console.log(
  "\n5. laptop reconnects — concurrent edits, conflict raised locally",
);
await deliver(ID.laptop);
const merged = await laptop.sync();
is("laptop raises a conflict", merged.conflict?.length, 2);
const sides = new Set(merged.conflict?.map((s) => s.text));
ok(`both sides present: ${[...sides].map((t) => `"${t}"`).join(" vs ")}`);
is(
  "laptop kept its own text meanwhile",
  textOf(laptop),
  "Buy milk, eggs and bread",
);
is("the laptop wrote nothing while conflicted", merged.changed, false);
is("the phone knows nothing about it", phone.conflict, null);
is("the phone kept its own text", textOf(phone), "Buy oat milk");

console.log("\n6. the user resolves, on the laptop, and it propagates");
await laptop.resolve("Buy oat milk, eggs and bread");
is("laptop conflict cleared", laptop.conflict, null);
// The join of both racing sClocks, then one bump of the resolver's own counter.
// Which text was chosen does not enter into it.
is(
  "the resolution dominates both racing versions",
  sClockOf(laptop),
  '{"1111aaaa":17,"2222bbbb":4}',
);
await deliver(ID.laptop);
await deliver(ID.phone);
await phone.sync();
is(
  "phone fast-forwards to the resolution",
  textOf(phone),
  "Buy oat milk, eggs and bread",
);
is("phone raises no conflict of its own", phone.conflict, null);
is("phone adopts the sClock too", sClockOf(phone), sClockOf(laptop));

console.log("\n7. converged, and quiet");
await laptop.sync();
is("both devices agree", textOf(laptop), textOf(phone));
const quiet = await Promise.all([laptop.sync(), phone.sync()]);
is(
  "a further sync writes nothing",
  quiet.some((r) => r.changed),
  false,
);

console.log("\n8. the single-writer rule held throughout");
let violations = 0;
for (const name of await readdir(CLOUD)) {
  const owner = deviceIdFrom(name);
  const snap = JSON.parse(await readFile(join(CLOUD, name), "utf8"));
  if (snap.device !== owner) violations++;
}
is("every file in the cloud was written only by its owner", violations, 0);
is(
  "one file per device, no conflicted copies",
  (await readdir(CLOUD)).sort().join(),
  [fileNameFor(ID.laptop), fileNameFor(ID.phone)].sort().join(),
);

// README §2.5 case B: the resolver keeps the *other* side's text. The device
// that already holds that text sees no new sentence, but its vector still moves
// — and a device that skipped the write for lack of a visible change would keep
// re-raising a conflict everybody else considers settled.
console.log("\n9. a resolution with no new text is still a change");
{
  // A folder of its own, so the pair starts from an empty one rather than from
  // the state the sections above left behind.
  const root2 = await mkdtemp(join(tmpdir(), "checklist-proto-b-"));
  const cloud2 = join(root2, "cloud");
  const dir2 = (id) => join(root2, id);
  await mkdir(cloud2, { recursive: true });

  const join2 = async (id, label) => {
    await mkdir(dir2(id), { recursive: true });
    const d = createDevice({
      deviceId: id,
      label,
      folder: nodeFolder(dir2(id)),
      now,
    });
    await d.load();
    return d;
  };
  const deliver2 = async (id) => {
    const mine = fileNameFor(id);
    if ((await readdir(dir2(id))).includes(mine))
      await copyFile(join(dir2(id), mine), join(cloud2, mine));
    for (const name of await readdir(cloud2))
      if (name !== mine)
        await copyFile(join(cloud2, name), join(dir2(id), name));
  };

  const lap = await join2("3333cccc", "laptop-b");
  const pho = await join2("4444dddd", "phone-b");

  await lap.edit("Buy milk, eggs and bread");
  await pho.edit("Buy oat milk");
  await deliver2("4444dddd");
  await deliver2("3333cccc");
  is("they raced", (await lap.sync()).conflict?.length, 2);

  // The user picks the phone's wording, on the laptop.
  await lap.resolve("Buy oat milk");
  await deliver2("3333cccc");
  await deliver2("4444dddd");
  const caught = await pho.sync();

  is("the phone's text never changed", textOf(pho), "Buy oat milk");
  is("but the sync still counted as a change", caught.changed, true);
  is("because the vector fast-forwarded", sClockOf(pho), sClockOf(lap));
  is("and no conflict survived it", pho.conflict, null);

  await rm(root2, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Property test: random edits, random delivery order, N devices. Convergence
// must not depend on who syncs when. Same bar as merge.test.ts in the real app.
console.log("\n10. randomised convergence (4 devices, 300 steps)");
{
  const ids = ["aaaa0001", "bbbb0002", "cccc0003", "dddd0004"];
  const devs = {};
  for (const id of ids) devs[id] = await device(id, `dev-${id.slice(0, 4)}`);

  // Deterministic PRNG so a failure is reproducible from the seed alone.
  let seed = Number(process.env.SEED ?? 42);
  const rand = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];

  for (let i = 0; i < 300; i++) {
    const id = pick(ids);
    const d = devs[id];
    const roll = rand();
    if (d.conflict) {
      // A real user resolves eventually; picking any side is legal.
      await d.resolve(pick(d.conflict).text);
    } else if (roll < 0.4) {
      await d.edit(`edit-${i}`);
    } else if (roll < 0.7) {
      await deliver(id);
    } else {
      await d.sync();
    }
  }

  // Settle: stop editing, let delivery finish, and let the user resolve.
  //
  // Only ONE device resolves. That is not a convenience — a resolution is
  // itself an edit, so two devices resolving a conflict independently are just
  // two more concurrent edits, and they chase each other indefinitely. One
  // person holds one device at a time, which is what makes this terminate.
  let rounds = 0;
  for (; rounds < 30; rounds++) {
    for (const id of ids) await deliver(id);
    const results = [];
    for (const id of ids) results.push(await devs[id].sync());
    const resolver = devs[ids[0]];
    if (resolver.conflict) {
      await resolver.resolve(resolver.conflict[0].text);
      continue;
    }
    // Quiescent: nobody wrote, nobody is waiting on a decision.
    if (!results.some((r) => r.changed) && !ids.some((id) => devs[id].conflict))
      break;
  }
  is("settles without needing every round", rounds < 30, true);

  const texts = new Set(ids.map((id) => textOf(devs[id])));
  const sClocks = new Set(
    ids.map((id) => JSON.stringify(devs[id].state.sClock)),
  );
  is("all 4 devices agree on the text", texts.size, 1);
  is("all 4 devices agree on the sClock", sClocks.size, 1);
  is(
    "nobody is left conflicted",
    ids.filter((id) => devs[id].conflict).length,
    0,
  );
}

await rm(root, { recursive: true, force: true });
console.log(`\n${failures ? `${failures} failure(s)` : "all checks passed"}`);
process.exit(failures ? 1 : 0);
