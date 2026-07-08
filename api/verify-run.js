// src/sim/combat.ts
var GRID = {
  Pierce: { Unarmored: 1.5, Light: 1.5, Heavy: 0.75, Fortified: 0.5, Warded: 1 },
  Siege: { Unarmored: 0.75, Light: 0.5, Heavy: 1.25, Fortified: 1.5, Warded: 1 },
  Magic: { Unarmored: 1, Light: 1, Heavy: 1.5, Fortified: 1.25, Warded: 0.5 },
  Physical: { Unarmored: 1.25, Light: 1, Heavy: 0.75, Fortified: 0.75, Warded: 1.5 }
};
var WHEEL = {
  Fire: { strong: ["Nature", "Dark"], weak: ["Water", "Light"] },
  Nature: { strong: ["Water", "Storm"], weak: ["Fire", "Dark"] },
  Water: { strong: ["Fire", "Light"], weak: ["Nature", "Storm"] },
  Light: { strong: ["Dark", "Fire"], weak: ["Storm", "Water"] },
  Dark: { strong: ["Storm", "Nature"], weak: ["Light", "Fire"] },
  Storm: { strong: ["Light", "Water"], weak: ["Dark", "Nature"] }
};
var ELEMENT_COLOR = {
  Fire: 16738876,
  Water: 4905471,
  Nature: 9305930,
  Light: 16769354,
  Dark: 12610559,
  Storm: 10146047
};
var ELEMENT_ORDER = ["Fire", "Water", "Nature", "Light", "Dark", "Storm"];
function clamp(v, lo, hi) {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
function safe(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}
function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
function distance(ax, ay, bx, by) {
  return Math.sqrt(dist2(ax, ay, bx, by));
}
function angleBetween(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}
function wheelMult(element, affinity) {
  if (!element || !affinity) return 1;
  const w3 = WHEEL[element];
  if (w3.strong.includes(affinity)) return 1.5;
  if (w3.weak.includes(affinity)) return 0.75;
  return 1;
}
function typeMultiplier(atk, def) {
  const grid = GRID[atk.dmgType][def.armor] ?? 1;
  const wheel = atk.element && def.affinity ? wheelMult(atk.element, def.affinity) : 1;
  return clamp(grid * wheel, 0.5, 2.5);
}
function computeHit(atk, def) {
  const damage = Math.max(0, safe(atk.damage));
  if (damage <= 0) return 0;
  const mult = typeMultiplier(atk, def);
  const flat = Math.max(0, safe(def.flatArmor) - Math.max(0, safe(atk.armorPen)));
  const raw = damage * mult - flat;
  const perHit = Math.max(0.05 * damage, raw);
  return safe(perHit, 0.05 * damage);
}
function classify(mult) {
  if (mult >= 1.25) return "strong";
  if (mult <= 0.75) return "weak";
  return "neutral";
}

// src/game/paths.ts
var GRID_COLS = 9;
var GRID_ROWS = 11;
var clampCol = (c) => Math.max(0, Math.min(GRID_COLS - 1, Math.round(c)));
var clampRow = (r) => Math.max(0, Math.min(GRID_ROWS - 1, Math.round(r)));
function serpentine(lanes, cols = GRID_COLS) {
  const cells = [];
  for (let i = 0; i < lanes.length; i++) {
    const row = lanes[i];
    const l2r = i % 2 === 0;
    if (l2r) {
      for (let c = 0; c < cols; c++) cells.push([c, row]);
    } else {
      for (let c = cols - 1; c >= 0; c--) cells.push([c, row]);
    }
    if (i < lanes.length - 1) {
      const endCol = l2r ? cols - 1 : 0;
      const nextRow = lanes[i + 1];
      for (let r = row + 1; r < nextRow; r++) cells.push([endCol, r]);
    }
  }
  return cells;
}
function connectAnchors(anchors) {
  const out = [];
  const push = (c, r) => {
    const cc = clampCol(c);
    const rr = clampRow(r);
    const last = out[out.length - 1];
    if (last && last[0] === cc && last[1] === rr) return;
    out.push([cc, rr]);
  };
  if (anchors.length === 0) return out;
  push(anchors[0][0], anchors[0][1]);
  for (let i = 1; i < anchors.length; i++) {
    let c = clampCol(out[out.length - 1][0]);
    const r0 = clampRow(out[out.length - 1][1]);
    let r = r0;
    const tc = clampCol(anchors[i][0]);
    const tr = clampRow(anchors[i][1]);
    while (c !== tc) {
      c += tc > c ? 1 : -1;
      push(c, r);
    }
    while (r !== tr) {
      r += tr > r ? 1 : -1;
      push(c, r);
    }
  }
  return out;
}
var SIMPLE_ARCHETYPES = ["straight", "lbend", "ushape", "corridor"];
var COMPLEX_ARCHETYPES = ["spiral", "hairpin", "coil", "switchback", "zigzag"];
function buildSerpentine(rng) {
  const rows = 3 + Math.floor(rng() * 3);
  const lanes = [];
  const step = (GRID_ROWS - 1) / rows;
  for (let i = 0; i < rows; i++) lanes.push(clampRow(0.6 + step * (i + 0.5)));
  return serpentine(lanes);
}
function buildVerticalSnake(rng) {
  const colsN = 3 + Math.floor(rng() * 3);
  const anchors = [];
  const step = (GRID_COLS - 1) / colsN;
  for (let i = 0; i < colsN; i++) {
    const col = clampCol(0.6 + step * (i + 0.5));
    const top = i % 2 === 0;
    anchors.push([col, top ? 0 : GRID_ROWS - 1]);
    anchors.push([col, top ? GRID_ROWS - 1 : 0]);
  }
  return connectAnchors(anchors);
}
function buildSpiral(rng) {
  let top = 0, bot = GRID_ROWS - 1, left = 0, right = GRID_COLS - 1;
  const anchors = [[0, rng() < 0.5 ? 0 : 1]];
  const inset = 2;
  while (right - left >= 1 && bot - top >= 1) {
    anchors.push([right, top]);
    anchors.push([right, bot]);
    anchors.push([left, bot]);
    anchors.push([left, top + 1]);
    top += inset;
    bot -= inset;
    left += inset;
    right -= inset;
    if (anchors.length > 24) break;
  }
  anchors.push([clampCol((left + right) / 2), clampRow((top + bot) / 2)]);
  return connectAnchors(anchors);
}
function buildHairpin(rng) {
  const lanes = 4 + Math.floor(rng() * 2);
  const anchors = [];
  const step = (GRID_ROWS - 1) / lanes;
  for (let i = 0; i < lanes; i++) {
    const row = clampRow(0.6 + step * (i + 0.5));
    const l2r = i % 2 === 0;
    anchors.push([l2r ? 0 : GRID_COLS - 1, row]);
    anchors.push([l2r ? GRID_COLS - 1 : 0, row]);
  }
  return connectAnchors(anchors);
}
function buildZigzag(rng) {
  const anchors = [];
  const steps = 4 + Math.floor(rng() * 3);
  let c = 0, r = 0;
  anchors.push([0, 0]);
  for (let i = 0; i < steps; i++) {
    const nc = clampCol((i + 1) / steps * (GRID_COLS - 1));
    const nr = clampRow((i + 1) / steps * (GRID_ROWS - 1));
    if (i % 2 === 0) {
      anchors.push([nc, r]);
      anchors.push([nc, nr]);
    } else {
      anchors.push([c, nr]);
      anchors.push([nc, nr]);
    }
    c = nc;
    r = nr;
  }
  return connectAnchors(anchors);
}
function buildCorridor(rng) {
  const midRow = clampRow(GRID_ROWS / 2 + (rng() < 0.5 ? -1 : 1));
  const j1 = clampRow(midRow - 3);
  const j2 = clampRow(midRow + 3);
  const q = clampCol(GRID_COLS / 3);
  const q2 = clampCol(GRID_COLS * 2 / 3);
  return connectAnchors([
    [0, midRow],
    [q, midRow],
    [q, j1],
    [q2, j1],
    [q2, j2],
    [GRID_COLS - 1, j2],
    [GRID_COLS - 1, midRow]
  ]);
}
function buildSwitchback(rng) {
  const anchors = [[clampCol(GRID_COLS / 2), 0]];
  const rungs = 4 + Math.floor(rng() * 2);
  const step = (GRID_ROWS - 1) / rungs;
  for (let i = 0; i < rungs; i++) {
    const r = clampRow(step * (i + 1));
    const side = i % 2 === 0 ? GRID_COLS - 1 : 0;
    anchors.push([side, clampRow(r - step / 2)]);
    anchors.push([side, r]);
  }
  anchors.push([clampCol(GRID_COLS / 2), GRID_ROWS - 1]);
  return connectAnchors(anchors);
}
function buildStraight(rng) {
  const row = clampRow(2 + Math.floor(rng() * (GRID_ROWS - 4)));
  const turnCol = clampCol(2 + Math.floor(rng() * (GRID_COLS - 4)));
  const endRow = clampRow(row + (rng() < 0.5 ? -3 : 3));
  return connectAnchors([[0, row], [turnCol, row], [turnCol, endRow], [GRID_COLS - 1, endRow]]);
}
function buildLbend(rng) {
  const enterCol = clampCol(1 + Math.floor(rng() * (GRID_COLS - 2)));
  const cornerRow = clampRow(GRID_ROWS - 2 - Math.floor(rng() * 2));
  const goRight = enterCol < GRID_COLS / 2;
  return connectAnchors([[enterCol, 0], [enterCol, cornerRow], [goRight ? GRID_COLS - 1 : 0, cornerRow]]);
}
function buildUshape(rng) {
  const inset = clampCol(1 + Math.floor(rng() * 2));
  const bottom = clampRow(GRID_ROWS - 1 - Math.floor(rng() * 2));
  const topRight = clampRow(1 + Math.floor(rng() * 3));
  return connectAnchors([
    [inset, 0],
    [inset, bottom],
    [clampCol(GRID_COLS - 1 - inset), bottom],
    [clampCol(GRID_COLS - 1 - inset), topRight]
  ]);
}
function buildCoil(rng) {
  const leftHalf = rng() < 0.5;
  const near = leftHalf ? 0 : GRID_COLS - 1;
  const far = clampCol(leftHalf ? GRID_COLS - 3 : 2);
  const rungs = 4 + Math.floor(rng() * 2);
  const step = (GRID_ROWS - 1) / rungs;
  const anchors = [[near, 0]];
  for (let i = 0; i < rungs; i++) {
    const r = clampRow(step * (i + 1));
    const side = i % 2 === 0 ? far : near;
    anchors.push([side, clampRow(r - step / 2)]);
    anchors.push([side, r]);
  }
  anchors.push([clampCol((near + far) / 2), GRID_ROWS - 1]);
  return connectAnchors(anchors);
}
var BUILDERS = {
  serpentine: buildSerpentine,
  verticalSnake: buildVerticalSnake,
  spiral: buildSpiral,
  hairpin: buildHairpin,
  zigzag: buildZigzag,
  corridor: buildCorridor,
  switchback: buildSwitchback,
  straight: buildStraight,
  lbend: buildLbend,
  ushape: buildUshape,
  coil: buildCoil
};
function buildPath(archetype, rng) {
  const cells = (BUILDERS[archetype] ?? buildSerpentine)(rng);
  return cells.length >= 2 ? cells : serpentine([3, 6, 9]);
}
var MULTI_TOPOLOGIES = ["dualLane", "crossing", "forkRejoin"];
function convergeTrunk(rng) {
  const bcol = clampCol(GRID_COLS / 2);
  const base = [bcol, GRID_ROWS - 1];
  const merge = [bcol, clampRow(2)];
  const lc = clampCol(1);
  const rc = clampCol(GRID_COLS - 2);
  const r1 = clampRow(3 + Math.floor(rng() * 2));
  const r2 = clampRow(6 + Math.floor(rng() * 2));
  const r3 = clampRow(GRID_ROWS - 2);
  const startRight = rng() < 0.5;
  const s1 = startRight ? rc : lc;
  const s2 = startRight ? lc : rc;
  const trunk = connectAnchors([
    merge,
    [s1, r1],
    [s2, r1],
    [s2, r2],
    [s1, r2],
    [s1, r3],
    [bcol, r3],
    base
  ]);
  return { merge, trunk };
}
function planDualLane(rng) {
  const { merge, trunk } = convergeTrunk(rng);
  const lx = clampCol(1 + Math.floor(rng() * 2));
  const rx = clampCol(GRID_COLS - 2 - Math.floor(rng() * 2));
  const a = connectAnchors([[lx, 0], [lx, merge[1]], merge, ...trunk]);
  const b = connectAnchors([[rx, 0], [rx, merge[1]], merge, ...trunk]);
  return [a, b];
}
function planCrossing(rng) {
  const { merge, trunk } = convergeTrunk(rng);
  const swap = clampRow(1);
  const a = connectAnchors([[1, 0], [1, swap], [GRID_COLS - 1, swap], [GRID_COLS - 1, merge[1]], merge, ...trunk]);
  const b = connectAnchors([[GRID_COLS - 2, 0], [GRID_COLS - 2, merge[1]], [0, merge[1]], merge, ...trunk]);
  return [a, b];
}
function planForkRejoin(rng) {
  const { merge, trunk } = convergeTrunk(rng);
  const head = [clampCol(GRID_COLS / 2), 0];
  const bow = clampRow(1);
  const lc = clampCol(1 + Math.floor(rng() * 2));
  const rc = clampCol(GRID_COLS - 2 - Math.floor(rng() * 2));
  const left = connectAnchors([head, [lc, bow], [lc, merge[1]], merge, ...trunk]);
  const right = connectAnchors([head, [rc, bow], [rc, merge[1]], merge, ...trunk]);
  return [left, right];
}
function normalizePlan(plan) {
  const routes = plan.filter((r) => r.length >= 2);
  if (routes.length === 0) return [serpentine([3, 6, 9])];
  const base = routes[0][routes[0].length - 1];
  return routes.map((r) => {
    const last = r[r.length - 1];
    if (last[0] === base[0] && last[1] === base[1]) return r;
    return connectAnchors([...r, base]);
  });
}
function buildPathPlan(topology, archetype, rng) {
  switch (topology) {
    case "dualLane":
      return normalizePlan(planDualLane(rng));
    case "crossing":
      return normalizePlan(planCrossing(rng));
    case "forkRejoin":
      return normalizePlan(planForkRejoin(rng));
    default:
      return [buildPath(archetype, rng)];
  }
}
function computeBuildCandidates(path) {
  const onPath = /* @__PURE__ */ new Set();
  for (const [c, r] of path) onPath.add(`${c},${r}`);
  const out = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (onPath.has(`${c},${r}`)) continue;
      let near = false;
      for (let dr = -1; dr <= 1 && !near; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (onPath.has(`${c + dc},${r + dr}`)) {
            near = true;
            break;
          }
        }
      }
      if (near) out.push([c, r]);
    }
  }
  return out;
}
function pathPlanFor(level) {
  if (level.paths && level.paths.length >= 1 && level.paths.every((r) => r.length >= 2)) return level.paths;
  if (level.path && level.path.length >= 2) return [level.path];
  return [serpentine(level.lanes)];
}
function terrainDmgMul(kind, element) {
  switch (kind) {
    case "lava":
      return element === "Fire" ? 1.5 : 1;
    case "highground":
      return 1.12;
    case "sacred":
      return 0.85;
    case "frozen":
      return 0.85;
    case "void":
      return 1.3;
    default:
      return 1;
  }
}
function terrainRngMul(kind) {
  switch (kind) {
    case "highground":
      return 1.28;
    case "sacred":
      return 1.25;
    case "fog":
      return 0.62;
    case "void":
      return 0.72;
    default:
      return 1;
  }
}
function terrainNoBuild(kind) {
  return kind === "fog";
}

// src/sim/rng.ts
var RNG = class {
  constructor(seed) {
    const norm = seed >>> 0 || 2654435769;
    this.seed = norm;
    this.s = norm;
  }
  // uniform in [0, 1)
  next() {
    this.s = this.s + 1831565813 | 0;
    let t = this.s;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  // uniform float in [min, max)
  range(min, max) {
    return min + (max - min) * this.next();
  }
  // integer in [min, max] inclusive
  int(min, max) {
    if (max < min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))];
  }
  // Fisher-Yates shuffle (returns a new array; deterministic).
  shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }
  // Draw k distinct items from a pool (deterministic; k clamped to pool size).
  sample(arr, k2) {
    return this.shuffle(arr).slice(0, Math.max(0, Math.min(k2, arr.length)));
  }
};

// src/game/campaign.ts
var LEVELS_PER_WORLD = 32;
var GENERATOR_MAX_PER_WORLD = 150;
var LANDMARK_EVERY = 10;
var PAL = {
  meadow: { grassA: 5490286, grassB: 4831330, build: 7657866, path: 16764764, pathEdge: 14723128 },
  frost: { grassA: 7321302, grassB: 6203080, build: 10475758, path: 15267071, pathEdge: 10141920 },
  storm: { grassA: 4164246, grassB: 3570824, build: 5941428, path: 16766282, pathEdge: 13081120 },
  lumen: { grassA: 13481064, grassB: 12691292, build: 15127699, path: 16774088, pathEdge: 14265924 },
  ember: { grassA: 12999754, grassB: 12078140, build: 14712944, path: 16757324, pathEdge: 13066272 },
  void: { grassA: 3812454, grassB: 3286104, build: 5917830, path: 16739029, pathEdge: 13052565 }
};
function w(entries, clearBonus) {
  return { entries, clearBonus };
}
function e(kind, count, spacing, hpMul = 1) {
  return { kind, count, spacing, hpMul };
}
function k(keeperId, hpMul = 1, echo = false) {
  return { kind: "keeper", count: 1, spacing: 1, hpMul, keeperId, echo };
}
var L1_TUTORIAL = {
  id: "l1",
  index: 0,
  name: "The Cold Forge",
  blurb: "Emberwaste \xB7 a gentle start",
  lanes: [3, 6, 9],
  startGold: 240,
  startLives: 20,
  baseCoins: 30,
  palette: PAL.ember,
  waves: [
    w([e("runner", 6, 0.65)], 20),
    w([e("runner", 6, 0.5), e("grunt", 4, 0.8)], 22),
    w([e("grunt", 8, 0.7, 1.05), e("runner", 5, 0.4, 1.05)], 25),
    w([e("runner", 12, 0.4, 1.1), e("grunt", 6, 0.6, 1.1)], 28),
    w([e("grunt", 10, 0.55, 1.2), e("runner", 8, 0.35, 1.2)], 34),
    w([e("runner", 16, 0.3, 1.35), e("grunt", 8, 0.5, 1.35)], 60),
    w([k("kaelen", 0.8, true), e("runner", 10, 0.55, 1.3)], 110)
    // first taste of a Keeper (echo)
  ]
};
var FINALE_WAVES = {
  l2: {
    name: "Glacier Causeway",
    blurb: "Frostreach finale \xB7 Maravelle, the Still Oracle",
    lanes: [1, 4, 7, 10],
    startGold: 300,
    startLives: 20,
    baseCoins: 90,
    palette: PAL.frost,
    waves: [
      w([e("runner", 10, 0.4, 1.2)], 24),
      w([e("grunt", 12, 0.5, 1.3), e("shielded", 3, 0.9, 1.1)], 28),
      w([e("shielded", 6, 0.8, 1.2), e("runner", 14, 0.3, 1.3)], 32),
      w([e("brute", 3, 1.2, 1.35), e("flyer", 6, 0.7, 1.25)], 38),
      w([e("shielded", 8, 0.7, 1.35), e("grunt", 12, 0.45, 1.4)], 44),
      w([e("brute", 5, 1, 1.45), e("runner", 16, 0.28, 1.5)], 96),
      w([k("maravelle"), e("grunt", 8, 0.6, 1.4)], 150)
    ]
  },
  l3: {
    name: "Thunder Steps",
    blurb: "Stormpeaks finale \xB7 Admiral Vorn, the Becalmed",
    lanes: [2, 4, 6, 8],
    startGold: 320,
    startLives: 18,
    baseCoins: 110,
    palette: PAL.storm,
    waves: [
      w([e("flyer", 6, 0.8, 1.25), e("runner", 10, 0.4, 1.3)], 26),
      w([e("grunt", 12, 0.5, 1.4), e("flyer", 5, 0.85, 1.3)], 30),
      w([e("brute", 3, 1.2, 1.4), e("flyer", 8, 0.6, 1.35)], 36),
      w([e("runner", 18, 0.26, 1.5), e("flyer", 8, 0.55, 1.4)], 42),
      w([e("flyer", 12, 0.5, 1.45), e("brute", 4, 1, 1.55), e("grunt", 12, 0.4, 1.5)], 100),
      w([k("vorn"), e("flyer", 6, 0.7, 1.4), e("grunt", 8, 0.55, 1.45)], 160)
    ]
  },
  l4: {
    name: "Rootveil Marsh",
    blurb: "Verdant finale \xB7 Wessa, the Overgrown",
    lanes: [1, 3, 5, 7, 9],
    startGold: 340,
    startLives: 18,
    baseCoins: 130,
    palette: PAL.meadow,
    waves: [
      w([e("grunt", 12, 0.45, 1.4), e("healer", 3, 1.2, 1.1)], 28),
      w([e("shielded", 6, 0.8, 1.3), e("swarm", 20, 0.16, 1.3)], 32),
      w([e("healer", 4, 1, 1.2), e("brute", 3, 1.1, 1.5)], 36),
      w([e("shielded", 8, 0.7, 1.4), e("swarm", 26, 0.13, 1.45)], 42),
      w([e("brute", 5, 1, 1.55), e("healer", 4, 1.1, 1.3), e("shielded", 6, 0.7, 1.4)], 48),
      w([e("swarm", 32, 0.12, 1.55), e("brute", 5, 1, 1.6), e("healer", 4, 1, 1.35)], 120),
      w([k("wessa"), e("shielded", 6, 0.85, 1.4), e("swarm", 16, 0.14, 1.5)], 170)
    ]
  },
  l5: {
    name: "The Gilded Aisle",
    blurb: "Lumen finale \xB7 High Cantor Aurelin",
    lanes: [0, 3, 6, 9],
    startGold: 350,
    startLives: 16,
    baseCoins: 150,
    palette: PAL.lumen,
    waves: [
      w([e("swarm", 24, 0.14, 1.4), e("healer", 2, 1.5, 1.2)], 30),
      w([e("healer", 4, 1, 1.3), e("shielded", 6, 0.8, 1.4)], 34),
      w([e("swarm", 30, 0.12, 1.5), e("brute", 3, 1.1, 1.55)], 40),
      w([e("healer", 5, 1, 1.35), e("flyer", 10, 0.5, 1.5), e("shielded", 6, 0.8, 1.45)], 46),
      w([e("brute", 5, 1, 1.65), e("healer", 5, 1, 1.4), e("swarm", 28, 0.12, 1.55)], 52),
      w([e("swarm", 36, 0.11, 1.6), e("healer", 6, 1, 1.45), e("brute", 6, 0.95, 1.7)], 140),
      w([k("aurelin"), e("healer", 3, 1.2, 1.4), e("swarm", 20, 0.13, 1.55)], 190)
    ]
  },
  l6: {
    name: "The Hollow Throne",
    blurb: "The Hollow finale \xB7 Morose's Titan",
    lanes: [0, 2, 4, 6, 8, 10],
    startGold: 360,
    startLives: 16,
    baseCoins: 200,
    palette: PAL.void,
    waves: [
      w([e("grunt", 14, 0.4, 1.6), e("flyer", 8, 0.6, 1.4)], 32),
      w([e("shielded", 8, 0.7, 1.5), e("swarm", 26, 0.13, 1.5)], 36),
      w([e("healer", 4, 1, 1.4), e("brute", 4, 1, 1.7)], 40),
      w([e("flyer", 12, 0.45, 1.6), e("shielded", 8, 0.7, 1.55)], 44),
      w([e("swarm", 32, 0.11, 1.7), e("brute", 5, 1, 1.8), e("healer", 4, 1.1, 1.45)], 48),
      w([e("shielded", 10, 0.6, 1.6), e("flyer", 12, 0.45, 1.65), e("grunt", 14, 0.35, 1.8)], 54),
      w([e("brute", 6, 0.9, 1.9), e("healer", 5, 1, 1.5), e("swarm", 30, 0.11, 1.7)], 60),
      w([k("vesper"), e("swarm", 20, 0.12, 1.7)], 90),
      w([k("kaelen", 1, true), k("maravelle", 1, true), k("vorn", 1, true), k("wessa", 1, true), k("aurelin", 1, true), e("grunt", 12, 0.4, 1.8)], 120),
      w([e("boss", 1, 1, 1.3), e("brute", 6, 0.9, 1.9), e("flyer", 12, 0.4, 1.6), e("swarm", 30, 0.1, 1.7)], 260)
    ]
  }
};
var REALM_GEN = [
  {
    id: "emberwaste",
    name: "Emberwaste",
    element: "Fire",
    emoji: "\u{1F525}",
    intro: "The forges have gone cold and grey. Wake the fire before it forgets how to burn.",
    ui: { accent: "#ff8a4c", deep: "#260c07", mid: "#5a1d0e", glow: "rgba(255,122,60,.32)", ridge: "#38130a", ridgeFar: "#552012" },
    palette: PAL.ember,
    keeperId: "kaelen",
    finaleId: "w0_finale",
    roster: ["runner", "grunt", "brute"],
    terrain: ["lava", "highground"],
    archetypes: ["serpentine", "corridor", "zigzag", "hairpin"],
    names: ["Cinder Causeway", "The Ashen Steps", "Ember-Veins Deep", "Molten Throne", "Soot-Choked Forge", "The Snuffing Galleries", "Slagfall", "Kaelen\u2019s Reach"],
    suffixes: ["Approach", "Deep", "Rise", "Descent", "Crossing", "Vault", "Furnace", "Ridge"]
  },
  {
    id: "frostreach",
    name: "Frostreach",
    element: "Frost",
    emoji: "\u2744\uFE0F",
    intro: "The Greying froze even the aurora. Bring back the blue of deep winter ice.",
    ui: { accent: "#7fe3ff", deep: "#081827", mid: "#14395c", glow: "rgba(127,227,255,.28)", ridge: "#0f2439", ridgeFar: "#1b3c5e" },
    palette: PAL.frost,
    keeperId: "maravelle",
    finaleId: "l2",
    roster: ["shielded", "brute", "flyer", "swarm"],
    terrain: ["frozen", "fog", "highground"],
    archetypes: ["switchback", "serpentine", "spiral", "verticalSnake"],
    names: ["Spire-Crown Heights", "The Frozen Throne", "Aurora Galleries", "Glacier-Heart Deep", "Still-Crystal Chasm", "The Icebound Galleries", "Rimeward Pass", "Maravelle\u2019s Vigil"],
    suffixes: ["Heights", "Chasm", "Shelf", "Causeway", "Hollow", "Vault", "Drift", "Vigil"]
  },
  {
    id: "stormpeaks",
    name: "Stormpeaks",
    element: "Storm",
    emoji: "\u26A1",
    intro: "Silent summits where thunder used to sing. Climb, and call the storm back home.",
    ui: { accent: "#ffd95c", deep: "#0a1e22", mid: "#155059", glow: "rgba(72,214,202,.26)", ridge: "#0d2c31", ridgeFar: "#175059" },
    palette: PAL.storm,
    keeperId: "vorn",
    finaleId: "l3",
    roster: ["flyer", "runner", "brute", "grunt"],
    terrain: ["highground", "fog"],
    archetypes: ["switchback", "zigzag", "verticalSnake", "hairpin"],
    names: ["Windbreak Peaks", "The Becalmed Isle", "Cloud-Breach Spire", "Sky-Rigging Yards", "Gale\u2019s Crags", "Storm-Eye Galleries", "Thunderless Reach", "Vorn\u2019s Anchorage"],
    suffixes: ["Peaks", "Spire", "Crags", "Reach", "Ascent", "Yards", "Isle", "Gale"]
  },
  {
    id: "verdant",
    name: "Verdant Wilds",
    element: "Nature",
    emoji: "\u{1F33F}",
    intro: "Every leaf hangs ashen and still. The Wilds are waiting for one drop of green.",
    ui: { accent: "#6fe08a", deep: "#0a2010", mid: "#1b4a22", glow: "rgba(110,224,138,.26)", ridge: "#113016", ridgeFar: "#1e5426" },
    palette: PAL.meadow,
    keeperId: "wessa",
    finaleId: "l4",
    roster: ["healer", "swarm", "shielded", "runner"],
    terrain: ["fog", "highground", "sacred"],
    archetypes: ["spiral", "hairpin", "serpentine", "corridor"],
    names: ["Thornwood Canopy", "The Deeproot Chasm", "Overgrown Sanctum", "Vine-Heart Galleries", "Seedbed Thicket", "Blight-Choked Wilds", "Mossway", "Wessa\u2019s Grove"],
    suffixes: ["Canopy", "Thicket", "Grove", "Hollow", "Tangle", "Sanctum", "Reach", "Deep"]
  },
  {
    id: "lumen",
    name: "Lumen Sanctum",
    element: "Light",
    emoji: "\u2728",
    intro: "The last lanterns of Aetheria gutter. Rekindle the Sanctum before its gold goes out.",
    ui: { accent: "#ffe27a", deep: "#241c06", mid: "#59460f", glow: "rgba(255,226,122,.28)", ridge: "#372c09", ridgeFar: "#5c4c14" },
    palette: PAL.lumen,
    keeperId: "aurelin",
    finaleId: "l5",
    roster: ["healer", "shielded", "swarm", "flyer"],
    terrain: ["sacred", "fog", "highground"],
    archetypes: ["serpentine", "spiral", "corridor", "zigzag"],
    names: ["Dawnspire Cathedral", "Golden Halls", "The Aureate Court", "Light-Heart Sanctum", "Blessed Galleries", "The Radiant Sanctum", "Gilded Approach", "Aurelin\u2019s Choir"],
    suffixes: ["Cathedral", "Halls", "Court", "Sanctum", "Gallery", "Aisle", "Nave", "Choir"]
  },
  {
    id: "hollow",
    name: "The Hollow",
    element: "Shadow",
    emoji: "\u{1F311}",
    intro: "Morose the Hollow King sits at the heart of the Greying. End it \u2014 and colour comes home.",
    ui: { accent: "#b06bff", deep: "#0f0722", mid: "#2a1150", glow: "rgba(176,107,255,.30)", ridge: "#190b34", ridgeFar: "#2c165a" },
    palette: PAL.void,
    keeperId: "vesper",
    finaleId: "l6",
    roster: ["swarm", "shielded", "brute", "flyer", "healer"],
    terrain: ["void", "fog", "highground"],
    archetypes: ["spiral", "switchback", "zigzag", "hairpin", "verticalSnake"],
    names: ["The Mirror Chasm", "Void-Heart Cathedral", "The Forgotten Throne", "Moth-Wing Galleries", "The Hollow\u2019s Embrace", "Shard-Breach Sanctum", "The Grey Between", "Vesper\u2019s Margin"],
    suffixes: ["Chasm", "Cathedral", "Throne", "Gallery", "Rift", "Sanctum", "Margin", "Echo"]
  }
];
var KIND_TUNE = {
  runner: { base: 8, per: 9, spacing: 0.42 },
  grunt: { base: 6, per: 7, spacing: 0.58 },
  brute: { base: 2, per: 2.6, spacing: 1 },
  flyer: { base: 4, per: 5, spacing: 0.68 },
  shielded: { base: 4, per: 4, spacing: 0.8 },
  healer: { base: 2, per: 1.8, spacing: 1.2 },
  swarm: { base: 14, per: 16, spacing: 0.14 }
};
var HP_E = 4.5;
var HP_ESAT = 0.85;
var HP_K = 2;
var HP_P = 1.15;
var CNT_PER = 0.5;
var CNT_EARLY = 4;
function difficultyHp(prog) {
  const p = Math.max(0, prog);
  return 1 + HP_E * Math.min(1, p / HP_ESAT) + HP_K * Math.pow(p, HP_P);
}
var INTRO_GATE = {
  runner: 0,
  grunt: 0,
  brute: 0.18,
  swarm: 0.35,
  flyer: 0.55,
  shielded: 0.7,
  healer: 1.15
};
function unlockedKinds(prog) {
  const out = [];
  for (const kind of ["runner", "grunt", "brute", "swarm", "flyer", "shielded", "healer"]) {
    if (prog >= (INTRO_GATE[kind] ?? 1e9)) out.push(kind);
  }
  return out;
}
function pickKind(rng, unlocked, roster) {
  const weighted = [];
  for (const kind of unlocked) {
    weighted.push(kind);
    if (roster.includes(kind)) {
      weighted.push(kind);
      weighted.push(kind);
    }
  }
  return weighted.length ? rng.pick(weighted) : "runner";
}
function entryCount(kind, prog, waveFrac) {
  const t = KIND_TUNE[kind] ?? KIND_TUNE.runner;
  const n = (t.base + prog * t.per * CNT_PER + prog * CNT_EARLY) * (0.7 + 0.55 * waveFrac);
  return Math.max(1, Math.round(n));
}
function pickArchetype(rng, prog, realmArchetypes, forceComplex) {
  const tier = forceComplex || prog >= 2.6 ? COMPLEX_ARCHETYPES : prog < 0.9 ? SIMPLE_ARCHETYPES : [...SIMPLE_ARCHETYPES, "serpentine", "verticalSnake", "zigzag", "switchback"];
  const pool = [...tier, ...realmArchetypes];
  return pool.length ? rng.pick(pool) : "serpentine";
}
function genTerrain(rng, routes, kinds, localDepth) {
  if (kinds.length === 0) return [];
  const flat = routes.flat();
  const cands = computeBuildCandidates(flat);
  if (cands.length === 0) return [];
  const onPath = new Set(flat.map(([c, r]) => `${c},${r}`));
  const rangeKinds = kinds.filter((k2) => k2 === "highground" || k2 === "sacred");
  const otherKinds = kinds.filter((k2) => k2 !== "highground" && k2 !== "sacred");
  const openness = (col, row) => {
    let open = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      if (!onPath.has(`${col + dc},${row + dr}`)) open++;
    }
    return open;
  };
  const density = 0.16 + 0.18 * localDepth;
  const target = Math.min(cands.length - 1, Math.max(1, Math.round(cands.length * density)));
  const chosen = rng.sample(cands, target);
  const out = [];
  for (const [col, row] of chosen) {
    const isOpen = openness(col, row) >= 6;
    const pool = isOpen && rangeKinds.length ? rangeKinds : !isOpen && otherKinds.length ? otherKinds : kinds;
    out.push({ col, row, kind: rng.pick(pool) });
  }
  return out;
}
function genLevel(rg, realmOrder, j, count, id, unlockTower) {
  const rng = new RNG((realmOrder * 928371 + j * 40503 + 20942 ^ 12648430) >>> 0);
  const localDepth = count <= 1 ? 0 : j / (count - 1);
  const globalDepth = (realmOrder + localDepth) / REALM_GEN.length;
  const isFinale = j === count - 1;
  const isLandmark = !isFinale && (j + 1) % LANDMARK_EVERY === 0;
  const prog = realmOrder + localDepth;
  const forceComplex = isLandmark || isFinale;
  const archetype = pickArchetype(rng, prog, rg.archetypes, forceComplex);
  const MULTI_LO = 0.25, MULTI_HI = 2;
  let multiChance = 0;
  if (!isFinale && prog >= MULTI_LO && prog <= MULTI_HI) {
    const rampUp = Math.min(1, (prog - MULTI_LO) / 0.5);
    const rampDown = Math.min(1, (MULTI_HI - prog) / 0.4);
    multiChance = 0.4 * Math.max(0, Math.min(rampUp, rampDown));
    if (isLandmark) multiChance += 0.2;
  }
  const topology = rng.chance(Math.min(0.7, multiChance)) ? rng.pick(MULTI_TOPOLOGIES) : "single";
  const plan = buildPathPlan(topology, archetype, () => rng.next());
  const path = plan[0];
  const paths = plan.length > 1 ? plan : void 0;
  const terrain = genTerrain(rng, plan, rg.terrain, localDepth);
  const baseHp = difficultyHp(prog);
  const waveCount = Math.max(5, Math.min(9, 5 + Math.round(localDepth * 4)));
  const unlocked = unlockedKinds(prog);
  const waves = [];
  const pickDistinct = (used) => {
    for (let tries = 0; tries < 6; tries++) {
      const cand = pickKind(rng, unlocked, rg.roster);
      if (!used.includes(cand)) return cand;
    }
    const rest = unlocked.filter((u) => !used.includes(u));
    return rest.length ? rng.pick(rest) : pickKind(rng, unlocked, rg.roster);
  };
  for (let wi = 0; wi < waveCount; wi++) {
    const waveFrac = waveCount <= 1 ? 1 : wi / (waveCount - 1);
    const openFloor = Math.max(0.6, Math.min(0.85, 0.85 - 0.045 * prog));
    const hpMul = +(baseHp * (openFloor + (1.35 - openFloor) * waveFrac)).toFixed(3);
    const entries = [];
    const used = [];
    const primary = pickKind(rng, unlocked, rg.roster);
    used.push(primary);
    entries.push(e(primary, entryCount(primary, prog, waveFrac), KIND_TUNE[primary]?.spacing ?? 0.5, hpMul));
    if (unlocked.length > 1 && (waveFrac >= 0.4 || waveFrac > 0.15 && rng.chance(0.6))) {
      const secondary = pickDistinct(used);
      used.push(secondary);
      entries.push(e(secondary, Math.round(entryCount(secondary, prog, waveFrac) * 0.72), KIND_TUNE[secondary]?.spacing ?? 0.5, +(hpMul * 0.98).toFixed(3)));
    }
    if (unlocked.length > 2 && prog >= 1.2 && waveFrac >= 0.7) {
      const tertiary = pickDistinct(used);
      used.push(tertiary);
      entries.push(e(tertiary, Math.max(1, Math.round(entryCount(tertiary, prog, waveFrac) * 0.55)), KIND_TUNE[tertiary]?.spacing ?? 0.5, +(hpMul * 0.96).toFixed(3)));
    }
    const clearBonus = Math.round(18 + prog * 16 + wi * 4);
    waves.push(w(entries, clearBonus));
  }
  if (isLandmark) {
    const echoHp = +(0.7 + prog * 0.28).toFixed(3);
    waves.splice(waves.length - 1, 0, w([k(rg.keeperId, echoHp, true), e("grunt", Math.round(8 + prog * 4), 0.5, baseHp)], Math.round(80 + prog * 22)));
  }
  if (isFinale) {
    waves.push(w([k(rg.keeperId), e("brute", Math.round(4 + prog * 1.5), 0.9, baseHp), e("runner", 12, 0.4, baseHp)], Math.round(140 + prog * 28)));
  }
  const nameBase = isFinale ? rg.names[rg.names.length - 1] : isLandmark ? rg.names[Math.floor(j / LANDMARK_EVERY) % (rg.names.length - 1)] : rg.names[j % (rg.names.length - 1)];
  const name = isFinale ? nameBase : `${nameBase} ${rg.suffixes[j % rg.suffixes.length]}`;
  const opener = localDepth < 0.25 ? Math.round((0.25 - localDepth) * 180) : 0;
  const multiCushion = paths ? 45 : 0;
  const startGold = Math.round(240 + prog * 45 + opener + multiCushion + (isLandmark || isFinale ? 40 : 0));
  const startLives = Math.max(12, Math.round(20 - globalDepth * 6));
  const baseCoins = Math.round(30 + globalDepth * 130 + (isLandmark ? 20 : 0) + (isFinale ? 40 : 0));
  return {
    id,
    index: 0,
    name,
    blurb: isFinale ? `${rg.name} finale \xB7 ${rg.keeperId}` : isLandmark ? `${rg.name} \xB7 landmark` : `${rg.name} \xB7 stop ${j + 1}`,
    lanes: [3, 6, 9],
    // fallback; `path`/`paths` drive the real route(s)
    path,
    paths,
    terrain,
    landmark: isFinale ? "finale" : isLandmark ? "landmark" : void 0,
    startGold,
    startLives,
    baseCoins,
    palette: rg.palette,
    unlockTower,
    waves
  };
}
function finaleLevel(id, rg, realmOrder) {
  const f = FINALE_WAVES[id];
  const prog = realmOrder + 1;
  const oldBase = 1 + prog / REALM_GEN.length * 1.3;
  const scale = +(difficultyHp(prog) / oldBase).toFixed(3);
  const waves = f.waves.map((wave) => ({
    clearBonus: wave.clearBonus,
    entries: wave.entries.map((en) => ({ ...en, hpMul: +((en.hpMul ?? 1) * scale).toFixed(3) }))
  }));
  return {
    id,
    index: 0,
    name: f.name,
    blurb: f.blurb,
    lanes: f.lanes,
    landmark: "finale",
    startGold: f.startGold,
    startLives: f.startLives,
    baseCoins: f.baseCoins,
    palette: f.palette,
    waves
  };
}
var UNLOCK_AT = {
  emberwaste: { j: 5, tower: "storm" },
  frostreach: { j: 4, tower: "arcane" }
};
function buildCampaign(perWorld = LEVELS_PER_WORLD) {
  const count = Math.max(2, Math.min(GENERATOR_MAX_PER_WORLD, Math.floor(perWorld)));
  const levels = [];
  const realms = [];
  REALM_GEN.forEach((rg, realmOrder) => {
    const ids = [];
    const realmLevels = [];
    for (let j = 0; j < count; j++) {
      const isFinale = j === count - 1;
      let lvl;
      if (j === 0 && rg.id === "emberwaste") {
        lvl = { ...L1_TUTORIAL };
      } else if (isFinale && rg.finaleId !== "w0_finale" && FINALE_WAVES[rg.finaleId]) {
        lvl = finaleLevel(rg.finaleId, rg, realmOrder);
      } else {
        const id = isFinale ? rg.finaleId : `w${realmOrder}_${j}`;
        const unlock = UNLOCK_AT[rg.id]?.j === j ? UNLOCK_AT[rg.id].tower : void 0;
        lvl = genLevel(rg, realmOrder, j, count, id, unlock);
      }
      realmLevels.push(lvl);
      ids.push(lvl.id);
    }
    realms.push({ id: rg.id, name: rg.name, element: rg.element, emoji: rg.emoji, intro: rg.intro, ui: rg.ui, levelIds: ids });
    levels.push(...realmLevels);
  });
  levels.forEach((l, i) => {
    l.index = i;
  });
  return { levels, realms, firstLevelId: "l1" };
}

// src/game/levels.ts
var CAMPAIGN = buildCampaign();
var LEVELS = CAMPAIGN.levels;
var REALMS = CAMPAIGN.realms;
var FIRST_LEVEL_ID = CAMPAIGN.firstLevelId;
var LEVEL_BY_ID = new Map(LEVELS.map((l) => [l.id, l]));
var REALM_BY_LEVEL = /* @__PURE__ */ new Map();
for (const r of REALMS) for (const id of r.levelIds) REALM_BY_LEVEL.set(id, r);
function w2(entries, clearBonus) {
  return { entries, clearBonus };
}
function e2(kind, count, spacing, hpMul = 1) {
  return { kind, count, spacing, hpMul };
}
var DEMO_LEVEL = {
  id: "demo",
  index: 1,
  name: "The Restoration of Ember Vale",
  blurb: "Ember Vale has gone grey. Paint it back.",
  lanes: [2, 5, 8],
  startGold: 260,
  startLives: 10,
  baseCoins: 40,
  palette: PAL.ember,
  unlockTower: "storm",
  waves: [
    w2([e2("runner", 8, 0.6)], 22),
    w2([e2("runner", 10, 0.4), e2("grunt", 8, 0.7, 1.1)], 26),
    w2([e2("grunt", 16, 0.55, 1.25), e2("brute", 3, 1.3, 1.15)], 36),
    w2([e2("shielded", 8, 0.85, 1.5), e2("runner", 16, 0.32, 1.6), e2("grunt", 10, 0.5, 1.7)], 44),
    w2([e2("boss", 1, 1, 12), e2("brute", 12, 0.9, 3.5), e2("runner", 12, 1.4, 60), e2("swarm", 30, 0.14, 12)], 120)
  ]
};

// src/sim/layout.ts
var COLS = GRID_COLS;
var ROWS = GRID_ROWS;
var TILE = 80;
var MAP_X = 0;
var MAP_Y = 200;
var MAP_W = COLS * TILE;
var MAP_H = ROWS * TILE;
var FIXED_DT = 1 / 60;
var MAX_STEPS_PER_FRAME = 5;
function cellCenter(col, row) {
  return { x: MAP_X + col * TILE + TILE / 2, y: MAP_Y + row * TILE + TILE / 2 };
}

// src/sim/drafts.ts
function neutralUpgrades() {
  const elementDmg = {};
  for (const e3 of ELEMENT_ORDER) elementDmg[e3] = 1;
  return {
    allDmg: 1,
    elementDmg,
    stormChainBonus: 0,
    frostSlowBonus: 0,
    burnDmgMult: 1,
    armorPenBonus: 0,
    fireRateMult: 1,
    splashBonus: 0,
    goldGainMult: 1,
    towerCostMult: 1,
    comboRamp: 1,
    reactionDmg: 1,
    reactionRadius: 1,
    amplifyPower: 0,
    amplifyDur: 0,
    conductJumps: 0,
    goldPerReaction: 0,
    lifePerBoss: 0,
    bossDmg: 1,
    curseEnemyHp: 1
  };
}
function elementCard(e3) {
  return {
    id: `elem_${e3}`,
    title: `${e3} Focus`,
    desc: `+30% ${e3} tower damage`,
    color: ELEMENT_COLOR[e3],
    rarity: "common",
    apply: (u) => {
      u.elementDmg[e3] *= 1.3;
    }
  };
}
var DRAFT_POOL = [
  elementCard("Fire"),
  elementCard("Water"),
  elementCard("Storm"),
  elementCard("Light"),
  { id: "alldmg", title: "Overpower", desc: "+18% ALL tower damage", color: 16766282, rarity: "common", apply: (u) => {
    u.allDmg *= 1.18;
  } },
  { id: "stormchain", title: "Forked Lightning", desc: "+1 Storm chain jump", color: 16769354, rarity: "rare", apply: (u) => {
    u.stormChainBonus += 1;
  } },
  { id: "burn", title: "Wildfire", desc: "+45% burn / DoT damage", color: 16738876, rarity: "common", apply: (u) => {
    u.burnDmgMult *= 1.45;
  } },
  { id: "frost", title: "Deep Chill", desc: "Frost slows 15% harder", color: 4905471, rarity: "common", apply: (u) => {
    u.frostSlowBonus += 0.15;
  } },
  { id: "cost", title: "Efficiency", desc: "-15% tower cost", color: 9305930, rarity: "common", apply: (u) => {
    u.towerCostMult *= 0.85;
  } },
  { id: "gold", title: "Prospector", desc: "+25% battle-gold", color: 16766282, rarity: "common", apply: (u) => {
    u.goldGainMult *= 1.25;
  } },
  { id: "pen", title: "Armor Breaker", desc: "+4 armor penetration (all)", color: 16751407, rarity: "rare", apply: (u) => {
    u.armorPenBonus += 4;
  } },
  { id: "firerate", title: "Overclock", desc: "+14% fire rate", color: 10146047, rarity: "rare", apply: (u) => {
    u.fireRateMult *= 0.86;
  } },
  { id: "splash", title: "Bigger Booms", desc: "+30% splash radius", color: 16738876, rarity: "rare", apply: (u) => {
    u.splashBonus += 0.3;
  } },
  { id: "heal", title: "Reinforce", desc: "Restore 4 lives now", color: 16735098, rarity: "common", livesDelta: 4, apply: () => {
  } },
  // BALANCE (harness pass 18): comboRamp trimmed 1.6→1.45. The auto-tuning harness
  // flagged Tempest+Blizzard+Chain-Reactor as degenerate — on scarce early resources
  // it snowballed ~3× deeper than a balanced build by racing the 6× combo cap. A
  // smaller step slows that race without gutting the relic. See BALANCE_REPORT.md.
  { id: "combo", title: "Chain Reactor", desc: "Combos escalate 45% faster", color: 12610559, rarity: "relic", apply: (u) => {
    u.comboRamp *= 1.45;
  } },
  { id: "glass", title: "Glass Cannon", desc: "+45% ALL damage, -2 lives", color: 16726891, rarity: "relic", livesDelta: -2, apply: (u) => {
    u.allDmg *= 1.45;
  } }
];
var C = {
  fire: 16738876,
  water: 4905471,
  nature: 9305930,
  light: 16769354,
  dark: 12610559,
  storm: 10146047,
  gold: 16766282,
  arcane: 14067455,
  blood: 16726891,
  iron: 13219583
};
function tiers(idBase, title, descFn, color, tags, steps, apply) {
  const roman = ["I", "II", "III", "IV"];
  return steps.map((s, i) => ({
    id: `${idBase}_${i + 1}`,
    title: `${title} ${roman[i] ?? i + 1}`,
    desc: descFn(s.pct),
    color,
    rarity: s.rarity,
    tags,
    apply: (u) => apply(u, 1 + s.pct / 100)
  }));
}
function addTiers(idBase, title, descFn, color, tags, steps, apply) {
  const roman = ["I", "II", "III", "IV"];
  return steps.map((s, i) => ({
    id: `${idBase}_${i + 1}`,
    title: `${title} ${roman[i] ?? i + 1}`,
    desc: descFn(s.v),
    color,
    rarity: s.rarity,
    tags,
    apply: (u) => apply(u, s.v)
  }));
}
var ELEM_TAG = { Fire: "fire", Water: "water", Nature: "nature", Light: "light", Dark: "dark", Storm: "storm" };
var elementRelics = ELEMENT_ORDER.flatMap((e3) => [
  { id: `rf_focus_${e3}`, title: `${e3} Focus`, desc: `+30% ${e3} tower damage`, color: ELEMENT_COLOR[e3], rarity: "common", tags: [ELEM_TAG[e3]], apply: (u) => {
    u.elementDmg[e3] *= 1.3;
  } },
  { id: `rf_mastery_${e3}`, title: `${e3} Mastery`, desc: `+65% ${e3} tower damage`, color: ELEMENT_COLOR[e3], rarity: "epic", tags: [ELEM_TAG[e3]], apply: (u) => {
    u.elementDmg[e3] *= 1.65;
  } }
]);
var ROGUE_DRAFT_POOL = [
  ...elementRelics,
  // --- generic power, tiered -------------------------------------------------
  ...tiers(
    "rg_all",
    "Overpower",
    (p) => `+${p}% ALL tower damage`,
    C.gold,
    ["damage"],
    [{ pct: 15, rarity: "common" }, { pct: 24, rarity: "rare" }, { pct: 36, rarity: "epic" }, { pct: 55, rarity: "relic" }],
    (u, m) => {
      u.allDmg *= m;
    }
  ),
  ...tiers(
    "rg_burn",
    "Wildfire",
    (p) => `+${p}% burn / DoT damage`,
    C.fire,
    ["fire", "burn"],
    [{ pct: 40, rarity: "common" }, { pct: 70, rarity: "rare" }, { pct: 120, rarity: "epic" }],
    (u, m) => {
      u.burnDmgMult *= m;
    }
  ),
  ...tiers(
    "rg_splash",
    "Bigger Booms",
    (p) => `+${p}% splash radius`,
    C.fire,
    ["splash"],
    [{ pct: 25, rarity: "common" }, { pct: 45, rarity: "rare" }, { pct: 75, rarity: "epic" }],
    (u, m) => {
      u.splashBonus += m - 1;
    }
  ),
  ...tiers(
    "rg_gold",
    "Prospector",
    (p) => `+${p}% battle-gold`,
    C.gold,
    ["gold"],
    [{ pct: 25, rarity: "common" }, { pct: 45, rarity: "rare" }, { pct: 80, rarity: "epic" }],
    (u, m) => {
      u.goldGainMult *= m;
    }
  ),
  // fire rate (multiplier < 1 = faster), tiered
  ...addTiers(
    "rg_rate",
    "Overclock",
    (v) => `+${Math.round((1 / v - 1) * 100)}% fire rate`,
    10146047,
    ["rate"],
    [{ v: 0.88, rarity: "common" }, { v: 0.8, rarity: "rare" }, { v: 0.7, rarity: "epic" }],
    (u, v) => {
      u.fireRateMult *= v;
    }
  ),
  // cheaper towers, tiered
  ...addTiers(
    "rg_cost",
    "Efficiency",
    (v) => `-${Math.round((1 - v) * 100)}% tower cost`,
    C.nature,
    ["economy"],
    [{ v: 0.88, rarity: "common" }, { v: 0.78, rarity: "rare" }, { v: 0.66, rarity: "epic" }],
    (u, v) => {
      u.towerCostMult *= v;
    }
  ),
  // armor pen, tiered (flat add)
  ...addTiers(
    "rg_pen",
    "Armor Breaker",
    (v) => `+${v} armor penetration (all)`,
    16751407,
    ["pierce"],
    [{ v: 3, rarity: "common" }, { v: 6, rarity: "rare" }, { v: 10, rarity: "epic" }],
    (u, v) => {
      u.armorPenBonus += v;
    }
  ),
  // storm chains, tiered
  ...addTiers(
    "rg_chain",
    "Forked Lightning",
    (v) => `+${v} Storm chain jump${v > 1 ? "s" : ""}`,
    C.storm,
    ["storm", "chain"],
    [{ v: 1, rarity: "rare" }, { v: 2, rarity: "epic" }, { v: 3, rarity: "relic" }],
    (u, v) => {
      u.stormChainBonus += v;
    }
  ),
  // frost bite, tiered
  ...addTiers(
    "rg_frost",
    "Deep Chill",
    (v) => `Frost slows ${Math.round(v * 100)}% harder`,
    C.water,
    ["water", "slow"],
    [{ v: 0.15, rarity: "common" }, { v: 0.28, rarity: "rare" }, { v: 0.4, rarity: "epic" }],
    (u, v) => {
      u.frostSlowBonus += v;
    }
  ),
  // --- REACTION relics (the crown jewels) -----------------------------------
  ...tiers(
    "rr_react",
    "Catalyst",
    (p) => `Reactions detonate +${p}% harder`,
    C.arcane,
    ["reaction"],
    [{ pct: 30, rarity: "rare" }, { pct: 55, rarity: "epic" }, { pct: 90, rarity: "relic" }],
    (u, m) => {
      u.reactionDmg *= m;
    }
  ),
  ...tiers(
    "rr_radius",
    "Wide Detonation",
    (p) => `+${p}% reaction blast radius`,
    C.arcane,
    ["reaction"],
    [{ pct: 30, rarity: "rare" }, { pct: 60, rarity: "epic" }],
    (u, m) => {
      u.reactionRadius *= m;
    }
  ),
  { id: "rr_conduct1", title: "Live Wire", desc: "CONDUCT arcs to +2 extra targets", color: C.storm, rarity: "epic", tags: ["reaction", "storm", "chain"], apply: (u) => {
    u.conductJumps += 2;
  } },
  { id: "rr_conduct2", title: "Tesla Coil", desc: "CONDUCT arcs to +4 extra targets", color: C.storm, rarity: "relic", unique: true, tags: ["reaction", "storm", "chain"], apply: (u) => {
    u.conductJumps += 4;
  } },
  { id: "rr_amp1", title: "Prism Lens", desc: "AMPLIFY-marked foes take +25% more", color: C.arcane, rarity: "epic", tags: ["reaction", "arcane"], apply: (u) => {
    u.amplifyPower += 0.25;
  } },
  { id: "rr_amp2", title: "Refraction Core", desc: "AMPLIFY: +45% damage & +2s duration", color: C.arcane, rarity: "relic", unique: true, tags: ["reaction", "arcane"], apply: (u) => {
    u.amplifyPower += 0.45;
    u.amplifyDur += 2;
  } },
  { id: "rr_ampdur", title: "Lingering Mark", desc: "AMPLIFY marks linger +3s", color: C.arcane, rarity: "rare", tags: ["reaction", "arcane"], apply: (u) => {
    u.amplifyDur += 3;
  } },
  { id: "rr_goldreact1", title: "Alchemist", desc: "Each reaction mints +3 gold", color: C.gold, rarity: "rare", tags: ["reaction", "gold"], apply: (u) => {
    u.goldPerReaction += 3;
  } },
  { id: "rr_goldreact2", title: "Transmuter", desc: "Each reaction mints +7 gold", color: C.gold, rarity: "epic", tags: ["reaction", "gold"], apply: (u) => {
    u.goldPerReaction += 7;
  } },
  { id: "rr_combo1", title: "Chain Reactor", desc: "Combos escalate 45% faster", color: C.dark, rarity: "relic", unique: true, tags: ["reaction", "combo"], apply: (u) => {
    u.comboRamp *= 1.45;
  } },
  { id: "rr_combo2", title: "Resonance Cascade", desc: "Combos escalate 30% faster", color: C.dark, rarity: "epic", tags: ["reaction", "combo"], apply: (u) => {
    u.comboRamp *= 1.3;
  } },
  // --- boss / anti-elite relics ---------------------------------------------
  { id: "rb_boss1", title: "Giant Slayer", desc: "+40% damage to bosses", color: C.blood, rarity: "rare", tags: ["boss"], apply: (u) => {
    u.bossDmg *= 1.4;
  } },
  { id: "rb_boss2", title: "Titan Ender", desc: "+80% damage to bosses", color: C.blood, rarity: "epic", tags: ["boss"], apply: (u) => {
    u.bossDmg *= 1.8;
  } },
  { id: "rb_life1", title: "Reliquary", desc: "Restore 1 life per boss slain", color: 16735098, rarity: "epic", unique: true, tags: ["boss", "sustain"], apply: (u) => {
    u.lifePerBoss += 1;
  } },
  { id: "rb_life2", title: "Phoenix Heart", desc: "Restore 2 lives per boss slain", color: 16735098, rarity: "relic", unique: true, tags: ["boss", "sustain"], apply: (u) => {
    u.lifePerBoss += 2;
  } },
  // --- immediate life / utility ---------------------------------------------
  { id: "ru_heal1", title: "Reinforce", desc: "Restore 4 lives now", color: 16735098, rarity: "common", tags: ["sustain"], livesDelta: 4, apply: () => {
  } },
  { id: "ru_heal2", title: "Bulwark Repair", desc: "Restore 8 lives now", color: 16735098, rarity: "rare", tags: ["sustain"], livesDelta: 8, apply: () => {
  } },
  { id: "ru_windfall", title: "Windfall", desc: "+40% gold & +25% burn", color: C.gold, rarity: "rare", tags: ["gold", "fire"], apply: (u) => {
    u.goldGainMult *= 1.4;
    u.burnDmgMult *= 1.25;
  } },
  { id: "ru_artillery", title: "Artillery Doctrine", desc: "+35% splash & +4 pen", color: 16751407, rarity: "epic", tags: ["splash", "pierce"], apply: (u) => {
    u.splashBonus += 0.35;
    u.armorPenBonus += 4;
  } },
  { id: "ru_tempest", title: "Tempest", desc: "+2 chains, +20% Storm", color: C.storm, rarity: "epic", tags: ["storm", "chain"], apply: (u) => {
    u.stormChainBonus += 2;
    u.elementDmg.Storm *= 1.2;
  } },
  // --- CURSES-WITH-UPSIDE (a real cost, a bigger payoff; deterministic) ------
  { id: "cz_glass1", title: "Glass Cannon", desc: "+45% ALL damage \xB7 \u22122 lives", color: C.blood, rarity: "relic", unique: true, tags: ["damage", "curse"], livesDelta: -2, apply: (u) => {
    u.allDmg *= 1.45;
  } },
  { id: "cz_glass2", title: "Diamond Edge", desc: "+80% ALL damage \xB7 \u22124 lives", color: C.blood, rarity: "relic", unique: true, tags: ["damage", "curse"], livesDelta: -4, apply: (u) => {
    u.allDmg *= 1.8;
  } },
  { id: "cz_bloodpact", title: "Blood Pact", desc: "+60% damage \xB7 foes +25% HP", color: C.blood, rarity: "epic", unique: true, tags: ["damage", "curse"], apply: (u) => {
    u.allDmg *= 1.6;
    u.curseEnemyHp *= 1.25;
  } },
  { id: "cz_pyromania", title: "Pyromania", desc: "\xD72.2 burn \xB7 foes +20% HP", color: C.fire, rarity: "epic", unique: true, tags: ["fire", "burn", "curse"], apply: (u) => {
    u.burnDmgMult *= 2.2;
    u.curseEnemyHp *= 1.2;
  } },
  { id: "cz_overload", title: "Overload", desc: "\xD72 reactions \xB7 foes +30% HP", color: C.arcane, rarity: "relic", unique: true, tags: ["reaction", "curse"], apply: (u) => {
    u.reactionDmg *= 2;
    u.curseEnemyHp *= 1.3;
  } },
  { id: "cz_greed", title: "Cursed Hoard", desc: "\xD72 gold \xB7 \u22123 lives", color: C.gold, rarity: "epic", unique: true, tags: ["gold", "curse"], livesDelta: -3, apply: (u) => {
    u.goldGainMult *= 2;
  } },
  { id: "cz_frenzy", title: "Berserker Frenzy", desc: "+30% fire rate \xB7 foes +18% HP", color: 16751407, rarity: "epic", unique: true, tags: ["rate", "curse"], apply: (u) => {
    u.fireRateMult *= 0.7;
    u.curseEnemyHp *= 1.18;
  } },
  { id: "cz_sacrifice", title: "Sacrificial Rite", desc: "\xD71.6 combo ramp \xB7 \u22123 lives", color: C.dark, rarity: "relic", unique: true, tags: ["combo", "curse"], livesDelta: -3, apply: (u) => {
    u.comboRamp *= 1.6;
  } },
  { id: "cz_hexblade", title: "Hexblade Pact", desc: "\xD71.5 reactions \xB7 \u22122 lives", color: C.arcane, rarity: "epic", unique: true, tags: ["reaction", "curse"], livesDelta: -2, apply: (u) => {
    u.reactionDmg *= 1.5;
  } },
  { id: "cz_famine", title: "Feast of Ash", desc: "+55% ALL damage \xB7 \u221230% gold", color: C.blood, rarity: "epic", unique: true, tags: ["damage", "curse"], apply: (u) => {
    u.allDmg *= 1.55;
    u.goldGainMult *= 0.7;
  } },
  { id: "cz_brittle", title: "Brittle Bones", desc: "+10 pen, +30% all \xB7 foes +40% HP", color: 16751407, rarity: "epic", unique: true, tags: ["pierce", "curse"], apply: (u) => {
    u.armorPenBonus += 10;
    u.allDmg *= 1.3;
    u.curseEnemyHp *= 1.4;
  } },
  { id: "cz_timedebt", title: "Time Debt", desc: "+30% fire rate, +2 chains \xB7 \u22122 lives", color: C.storm, rarity: "relic", unique: true, tags: ["rate", "storm", "curse"], livesDelta: -2, apply: (u) => {
    u.fireRateMult *= 0.7;
    u.stormChainBonus += 2;
  } },
  { id: "cz_martyr", title: "Martyr's Boon", desc: "+2 lives per boss \xB7 foes +25% HP", color: 16735098, rarity: "relic", unique: true, tags: ["boss", "sustain", "curse"], apply: (u) => {
    u.lifePerBoss += 2;
    u.curseEnemyHp *= 1.25;
  } },
  // --- REACTION-PAIR ADEPTS: buff the TWO elements that fuel a named reaction ---
  { id: "rp_thermal", title: "Thermal Adept", desc: "+35% Fire & Water (THERMAL SHOCK)", color: 16757084, rarity: "rare", tags: ["reaction", "fire", "water"], apply: (u) => {
    u.elementDmg.Fire *= 1.35;
    u.elementDmg.Water *= 1.35;
  } },
  { id: "rp_shatter", title: "Shatter Adept", desc: "+35% Water & Storm (SHATTER)", color: 10476799, rarity: "rare", tags: ["reaction", "water", "storm"], apply: (u) => {
    u.elementDmg.Water *= 1.35;
    u.elementDmg.Storm *= 1.35;
  } },
  { id: "rp_flashover", title: "Flashover Adept", desc: "+35% Fire & Storm (FLASHOVER)", color: 16738876, rarity: "rare", tags: ["reaction", "fire", "storm"], apply: (u) => {
    u.elementDmg.Fire *= 1.35;
    u.elementDmg.Storm *= 1.35;
  } },
  { id: "rp_wildfire", title: "Wildfire Adept", desc: "+35% Fire & Nature (WILDFIRE)", color: 16747068, rarity: "rare", tags: ["reaction", "fire", "nature"], apply: (u) => {
    u.elementDmg.Fire *= 1.35;
    u.elementDmg.Nature *= 1.35;
  } },
  { id: "rp_overgrow", title: "Overgrow Adept", desc: "+35% Water & Nature (OVERGROW)", color: 9305930, rarity: "rare", tags: ["reaction", "water", "nature"], apply: (u) => {
    u.elementDmg.Water *= 1.35;
    u.elementDmg.Nature *= 1.35;
  } },
  { id: "rp_eclipse", title: "Eclipse Adept", desc: "+35% Light & Dark (ECLIPSE)", color: 16769354, rarity: "rare", tags: ["reaction", "light", "dark"], apply: (u) => {
    u.elementDmg.Light *= 1.35;
    u.elementDmg.Dark *= 1.35;
  } },
  { id: "rp_conduct", title: "Conduct Adept", desc: "+35% Light & Storm (CONDUCT)", color: 10146047, rarity: "rare", tags: ["reaction", "light", "storm"], apply: (u) => {
    u.elementDmg.Light *= 1.35;
    u.elementDmg.Storm *= 1.35;
  } },
  { id: "rp_blight", title: "Blight Adept", desc: "+35% Nature & Dark (BLIGHT)", color: 10813290, rarity: "rare", tags: ["reaction", "nature", "dark"], apply: (u) => {
    u.elementDmg.Nature *= 1.35;
    u.elementDmg.Dark *= 1.35;
  } },
  // --- ELEMENT APEX (relic): a single element ascends -------------------------
  { id: "ea_fire", title: "Fire Apex", desc: "+110% Fire tower damage", color: 16738876, rarity: "relic", unique: true, tags: ["fire"], apply: (u) => {
    u.elementDmg.Fire *= 2.1;
  } },
  { id: "ea_water", title: "Water Apex", desc: "+110% Water tower damage", color: 4905471, rarity: "relic", unique: true, tags: ["water"], apply: (u) => {
    u.elementDmg.Water *= 2.1;
  } },
  { id: "ea_nature", title: "Nature Apex", desc: "+110% Nature tower damage", color: 9305930, rarity: "relic", unique: true, tags: ["nature"], apply: (u) => {
    u.elementDmg.Nature *= 2.1;
  } },
  { id: "ea_light", title: "Light Apex", desc: "+110% Light tower damage", color: 16769354, rarity: "relic", unique: true, tags: ["light"], apply: (u) => {
    u.elementDmg.Light *= 2.1;
  } },
  { id: "ea_dark", title: "Dark Apex", desc: "+110% Dark tower damage", color: 12610559, rarity: "relic", unique: true, tags: ["dark"], apply: (u) => {
    u.elementDmg.Dark *= 2.1;
  } },
  { id: "ea_storm", title: "Storm Apex", desc: "+110% Storm tower damage", color: 10146047, rarity: "relic", unique: true, tags: ["storm"], apply: (u) => {
    u.elementDmg.Storm *= 2.1;
  } },
  // --- more utility bundles ---------------------------------------------------
  { id: "ru_cryo", title: "Cryomancer", desc: "Frost +25% harder, +30% Water", color: 4905471, rarity: "rare", tags: ["water", "slow"], apply: (u) => {
    u.frostSlowBonus += 0.25;
    u.elementDmg.Water *= 1.3;
  } },
  { id: "ru_pyre", title: "Pyre Keeper", desc: "+60% burn, +25% Fire", color: 16738876, rarity: "rare", tags: ["fire", "burn"], apply: (u) => {
    u.burnDmgMult *= 1.6;
    u.elementDmg.Fire *= 1.25;
  } },
  { id: "ru_invest", title: "Investment", desc: "\u221220% cost, +30% gold", color: 9305930, rarity: "rare", tags: ["economy", "gold"], apply: (u) => {
    u.towerCostMult *= 0.8;
    u.goldGainMult *= 1.3;
  } },
  { id: "ru_sniper", title: "Marksman", desc: "+8 pen, +25% ALL damage", color: 16751407, rarity: "epic", tags: ["pierce", "damage"], apply: (u) => {
    u.armorPenBonus += 8;
    u.allDmg *= 1.25;
  } },
  { id: "ru_stormcaller", title: "Stormcaller", desc: "+2 chains, +30% Storm", color: 10146047, rarity: "epic", tags: ["storm", "chain"], apply: (u) => {
    u.stormChainBonus += 2;
    u.elementDmg.Storm *= 1.3;
  } },
  { id: "ru_warlord", title: "Warlord", desc: "+22% damage, +18% fire rate", color: 16766282, rarity: "epic", tags: ["damage", "rate"], apply: (u) => {
    u.allDmg *= 1.22;
    u.fireRateMult *= 0.82;
  } },
  { id: "ru_detonator", title: "Detonator", desc: "+50% reactions, +20% splash", color: 14067455, rarity: "epic", tags: ["reaction", "splash"], apply: (u) => {
    u.reactionDmg *= 1.5;
    u.splashBonus += 0.2;
  } },
  { id: "ru_bulwark", title: "Aegis Fund", desc: "Restore 6 lives, +15% gold", color: 16735098, rarity: "rare", tags: ["sustain", "gold"], livesDelta: 6, apply: (u) => {
    u.goldGainMult *= 1.15;
  } },
  { id: "rr_react4", title: "Grand Catalyst", desc: "Reactions detonate +130% harder", color: 14067455, rarity: "relic", unique: true, tags: ["reaction"], apply: (u) => {
    u.reactionDmg *= 2.3;
  } },
  { id: "rr_radius3", title: "Cataclysm", desc: "+95% reaction blast radius", color: 14067455, rarity: "relic", unique: true, tags: ["reaction"], apply: (u) => {
    u.reactionRadius *= 1.95;
  } },
  // --- CURSED rarity: the wildest all-in gambles (steep cost, run-defining) ---
  { id: "cx_lichking", title: "Lich Crown", desc: "\xD72.4 reactions, +2 lives/boss \xB7 foes +45% HP", color: 9063167, rarity: "cursed", unique: true, tags: ["reaction", "boss", "curse"], apply: (u) => {
    u.reactionDmg *= 2.4;
    u.lifePerBoss += 2;
    u.curseEnemyHp *= 1.45;
  } },
  { id: "cx_apocalypse", title: "Apocalypse Engine", desc: "\xD72 ALL damage \xB7 \u22125 lives", color: 16726891, rarity: "cursed", unique: true, tags: ["damage", "curse"], livesDelta: -5, apply: (u) => {
    u.allDmg *= 2;
  } },
  { id: "cx_inferno", title: "Living Inferno", desc: "\xD73 burn, +40% Fire \xB7 foes +30% HP", color: 16738876, rarity: "cursed", unique: true, tags: ["fire", "burn", "curse"], apply: (u) => {
    u.burnDmgMult *= 3;
    u.elementDmg.Fire *= 1.4;
    u.curseEnemyHp *= 1.3;
  } },
  { id: "cx_midas", title: "Midas Curse", desc: "\xD72.5 gold \xB7 \u22124 lives", color: 16766282, rarity: "cursed", unique: true, tags: ["gold", "curse"], livesDelta: -4, apply: (u) => {
    u.goldGainMult *= 2.5;
  } },
  { id: "cx_singularity", title: "Singularity", desc: "\xD71.8 combo ramp, \xD71.5 reactions \xB7 \u22124 lives", color: 12610559, rarity: "cursed", unique: true, tags: ["combo", "reaction", "curse"], livesDelta: -4, apply: (u) => {
    u.comboRamp *= 1.8;
    u.reactionDmg *= 1.5;
  } },
  { id: "cx_juggernaut", title: "Juggernaut Doctrine", desc: "+120% boss damage, +12 pen \xB7 foes +25% HP", color: 13219583, rarity: "cursed", unique: true, tags: ["boss", "pierce", "curse"], apply: (u) => {
    u.bossDmg *= 2.2;
    u.armorPenBonus += 12;
    u.curseEnemyHp *= 1.25;
  } }
];
var RARITY_BASE = { common: 100, rare: 46, epic: 20, relic: 8, cursed: 16 };
function rarityWeight(r, waveIdx) {
  const depth = clamp(waveIdx / 40, 0, 1);
  const skew = {
    common: 1 - 0.45 * depth,
    rare: 1,
    epic: 1 + 1.3 * depth,
    relic: 1 + 2.6 * depth,
    cursed: 1 + 0.5 * depth
  };
  return Math.max(0.01, RARITY_BASE[r] * skew[r]);
}
function rollRogueDraft(rng, takenIds, waveIdx, boostTags, count) {
  const pool = ROGUE_DRAFT_POOL.filter((c) => !(c.unique && takenIds.has(c.id)));
  const picks = [];
  const n = Math.max(1, Math.min(count, pool.length));
  for (let k2 = 0; k2 < n && pool.length > 0; k2++) {
    let total = 0;
    const w3 = new Array(pool.length);
    for (let i = 0; i < pool.length; i++) {
      let ww = rarityWeight(pool[i].rarity, waveIdx);
      if (boostTags.length && pool[i].tags && pool[i].tags.some((t) => boostTags.includes(t))) ww *= 2.5;
      w3[i] = ww;
      total += ww;
    }
    let r = rng.next() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= w3[idx];
      if (r <= 0) break;
    }
    idx = Math.min(idx, pool.length - 1);
    picks.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picks;
}

// src/sim/reactions.ts
var R = (key, name, color, color2) => ({ key, name, color, color2 });
var REACTIONS = {
  thermal: R("thermal", "THERMAL SHOCK", 16757084, 4905471),
  shatter: R("shatter", "SHATTER", 10476799, 16769354),
  flashover: R("flashover", "FLASHOVER", 16738876, 16771450),
  wildfire: R("wildfire", "WILDFIRE", 16747068, 9305930),
  overgrow: R("overgrow", "OVERGROW", 9305930, 4905471),
  eclipse: R("eclipse", "ECLIPSE", 16769354, 12610559),
  conduct: R("conduct", "CONDUCT", 10146047, 16773280),
  blight: R("blight", "BLIGHT", 10813290, 9063167),
  amplify: R("amplify", "AMPLIFY", 14067455, 16777215)
};
var PAIR = {
  "Fire|Water": "thermal",
  "Storm|Water": "shatter",
  "Fire|Storm": "flashover",
  "Fire|Nature": "wildfire",
  "Nature|Water": "overgrow",
  "Dark|Light": "eclipse",
  "Light|Storm": "conduct",
  "Dark|Nature": "blight"
};
function reactionFor(a, b) {
  if (a === b) return null;
  if (a === "Arcane" || b === "Arcane") return REACTIONS.amplify;
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  const rk = PAIR[key];
  return rk ? REACTIONS[rk] : null;
}
var FUSION_NAMES = {
  thermal: "Thermal Core",
  shatter: "Shatterspire",
  flashover: "Flashover Crown",
  wildfire: "Wildfire Bloom",
  overgrow: "Verdant Maw",
  eclipse: "Umbral Beacon",
  conduct: "Conduit Halo",
  blight: "Blight Chalice",
  amplify: "Prism Nexus"
};
var AURA_COLOR = {
  Fire: 16738876,
  Water: 4905471,
  Nature: 9305930,
  Light: 16769354,
  Dark: 12610559,
  Storm: 10146047,
  Arcane: 14067455
};

// src/sim/rogue.ts
function neutralRogueEffects() {
  return {
    playerDmg: 1,
    enemyHp: 1,
    enemySpeed: 1,
    reactionDmg: 1,
    reactionRadius: 1,
    burnEveryHit: 0,
    slowPower: 1,
    goldMult: 1,
    eliteChance: 0,
    bossHp: 1
  };
}
var MUTATORS = {
  pyroclasm: {
    id: "pyroclasm",
    name: "EVERYTHING BURNS",
    icon: "\u{1F525}",
    color: 16738876,
    blurb: "Every hit sets the target alight. Enemies are a touch hardier.",
    fx: { burnEveryHit: 7, enemyHp: 1.1 }
  },
  glacial_silence: {
    id: "glacial_silence",
    name: "GLACIAL SILENCE",
    icon: "\u{1F6AB}",
    color: 10146047,
    blurb: "Slows are muffled \u2014 frost barely bites. Your towers hit harder to compensate.",
    fx: { slowPower: 0.35, playerDmg: 1.15 }
  },
  chain_reaction: {
    id: "chain_reaction",
    name: "DOUBLE REACTIONS",
    icon: "\u269B\uFE0F",
    color: 12610559,
    blurb: "Elemental reactions detonate twice as hard, over a wider blast.",
    fx: { reactionDmg: 2, reactionRadius: 1.2 }
  },
  ironclad: {
    id: "ironclad",
    name: "IRONCLAD TIDE",
    icon: "\u{1F6E1}\uFE0F",
    color: 13219583,
    blurb: "Foes wear heavier hide (+35% HP). Bounties swell to match.",
    fx: { enemyHp: 1.35, goldMult: 1.3, playerDmg: 1.08 }
  },
  gold_fever: {
    id: "gold_fever",
    name: "GOLD FEVER",
    icon: "\u{1F4B0}",
    color: 16766282,
    blurb: "Double bounties \u2014 but the horde is hungrier and tougher.",
    fx: { goldMult: 2, enemyHp: 1.15, enemySpeed: 1.05 }
  },
  unstable_core: {
    id: "unstable_core",
    name: "UNSTABLE CORE",
    icon: "\u2622\uFE0F",
    color: 10813290,
    blurb: "Reactions run hot and wide, but so do the enemies.",
    fx: { reactionDmg: 1.6, reactionRadius: 1.35, enemyHp: 1.2 }
  },
  blitz: {
    id: "blitz",
    name: "BLITZ",
    icon: "\u26A1",
    color: 16769354,
    blurb: "The horde sprints (+30% speed) \u2014 softer, but they reach the crystal fast.",
    fx: { enemySpeed: 1.3, enemyHp: 0.85, playerDmg: 1.12 }
  },
  feral_swarm: {
    id: "feral_swarm",
    name: "FERAL SWARM",
    icon: "\u{1F41D}",
    color: 9305930,
    blurb: "Elites everywhere \u2014 far more affixed foes, richer rewards.",
    fx: { eliteChance: 0.28, goldMult: 1.2 }
  }
};
function resolveRogueEffects(ids) {
  const e3 = neutralRogueEffects();
  for (const id of ids) {
    const m = MUTATORS[id];
    if (!m) continue;
    const f = m.fx;
    if (f.playerDmg) e3.playerDmg *= f.playerDmg;
    if (f.enemyHp) e3.enemyHp *= f.enemyHp;
    if (f.enemySpeed) e3.enemySpeed *= f.enemySpeed;
    if (f.reactionDmg) e3.reactionDmg *= f.reactionDmg;
    if (f.reactionRadius) e3.reactionRadius *= f.reactionRadius;
    if (f.burnEveryHit) e3.burnEveryHit = Math.max(e3.burnEveryHit, f.burnEveryHit);
    if (f.slowPower) e3.slowPower *= f.slowPower;
    if (f.goldMult) e3.goldMult *= f.goldMult;
    if (f.eliteChance) e3.eliteChance += f.eliteChance;
    if (f.bossHp) e3.bossHp *= f.bossHp;
  }
  e3.playerDmg = clamp(e3.playerDmg, 0.5, 4);
  e3.enemyHp = clamp(e3.enemyHp, 0.5, 3);
  e3.enemySpeed = clamp(e3.enemySpeed, 0.6, 1.8);
  e3.reactionDmg = clamp(e3.reactionDmg, 0.5, 4);
  e3.reactionRadius = clamp(e3.reactionRadius, 0.5, 2.5);
  e3.burnEveryHit = clamp(e3.burnEveryHit, 0, 60);
  e3.slowPower = clamp(e3.slowPower, 0.2, 1.5);
  e3.goldMult = clamp(e3.goldMult, 0.5, 4);
  e3.eliteChance = clamp(e3.eliteChance, 0, 0.6);
  e3.bossHp = clamp(e3.bossHp, 0.5, 3);
  return e3;
}
var AFFIXES = [
  { id: "swift", name: "Swift", color: 10146047, speed: 1.35, bounty: 1.5 },
  { id: "ironhide", name: "Ironhide", color: 13219583, hp: 1.55, dr: 0.8, bounty: 1.7 },
  { id: "warded", name: "Warded", color: 9063167, shieldFrac: 0.55, dr: 0.9, bounty: 1.8 },
  { id: "vital", name: "Vital", color: 16735098, hp: 2.1, bounty: 2.1 },
  { id: "revenant", name: "Revenant", color: 10813290, regen: 0.08, hp: 1.3, bounty: 1.9 },
  { id: "gilded", name: "Gilded", color: 16766282, bounty: 3.2, hp: 1.15 }
];
var AFFIX_BY_ID = Object.fromEntries(AFFIXES.map((a) => [a.id, a]));
var NEUTRAL_AFFIX = { ids: [], name: "", color: 0, hp: 1, speed: 1, dr: 1, bounty: 1, shieldFrac: 0, regen: 0 };
function rollEliteAffixes(rng, kind, waveNum, chanceBonus) {
  if (kind === "boss" || kind === "keeper") return NEUTRAL_AFFIX;
  const swarmy = kind === "swarm" || kind === "runner";
  const base = swarmy ? 0.04 : 0.1;
  const chance = clamp(base + waveNum * 0.012 + chanceBonus, 0, swarmy ? 0.3 : 0.62);
  if (!rng.chance(chance)) return NEUTRAL_AFFIX;
  const first = rng.pick(AFFIXES);
  const chosen = [first];
  if (waveNum >= 12 && rng.chance(clamp((waveNum - 12) * 0.02 + chanceBonus, 0, 0.4))) {
    let guard = 0;
    let second = rng.pick(AFFIXES);
    while (second.id === first.id && guard++ < 4) second = rng.pick(AFFIXES);
    if (second.id !== first.id) chosen.push(second);
  }
  const out = { ids: [], name: first.name, color: first.color, hp: 1, speed: 1, dr: 1, bounty: 1, shieldFrac: 0, regen: 0 };
  for (const a of chosen) {
    out.ids.push(a.id);
    if (a.hp) out.hp *= a.hp;
    if (a.speed) out.speed *= a.speed;
    if (a.dr) out.dr *= a.dr;
    if (a.bounty) out.bounty *= a.bounty;
    if (a.shieldFrac) out.shieldFrac += a.shieldFrac;
    if (a.regen) out.regen += a.regen;
  }
  out.hp = clamp(out.hp, 1, 3.2);
  out.speed = clamp(out.speed, 1, 1.6);
  out.dr = clamp(out.dr, 0.6, 1);
  out.bounty = clamp(out.bounty, 1, 5);
  out.shieldFrac = clamp(out.shieldFrac, 0, 0.9);
  out.regen = clamp(out.regen, 0, 0.14);
  return out;
}
function rogueWave(n) {
  const hp = 1 + n * 0.16;
  const e3 = [];
  const bossRush = n % 10 === 0;
  const boss = n % 5 === 0;
  e3.push({ kind: "runner", count: 5 + Math.floor(n * 0.7), spacing: 0.3, hpMul: hp });
  e3.push({ kind: "grunt", count: 3 + Math.floor(n * 0.55), spacing: 0.45, hpMul: hp });
  if (n >= 2) e3.push({ kind: "flyer", count: 2 + Math.floor(n * 0.4), spacing: 0.55, hpMul: hp });
  if (n >= 3) e3.push({ kind: "shielded", count: 1 + Math.floor(n * 0.3), spacing: 0.7, hpMul: hp });
  if (n >= 4 && n % 2 === 0) e3.push({ kind: "healer", count: 1 + Math.floor(n * 0.12), spacing: 1.1, hpMul: hp });
  if (n >= 3) e3.push({ kind: "swarm", count: 8 + n * 2, spacing: 0.12, hpMul: hp });
  if (n >= 5) e3.push({ kind: "brute", count: 1 + Math.floor(n * 0.22), spacing: 1, hpMul: hp });
  if (bossRush) {
    e3.push({ kind: "boss", count: 2 + Math.floor(n / 10), spacing: 2.2, hpMul: 1 + n * 0.1 });
  } else if (boss) {
    e3.push({ kind: "boss", count: Math.max(1, Math.floor(n / 5)), spacing: 2.4, hpMul: 1 + n * 0.1 });
  }
  const clearBonus = 30 + n * 7 + (bossRush ? 120 : boss ? 40 : 0);
  return { entries: e3, clearBonus };
}
function isBossRush(n) {
  return n % 10 === 0;
}

// src/game/enemies.ts
function leakDamageFor(def, elite = false) {
  let dmg;
  if (def.boss) dmg = 6 + Math.floor(def.hp / 450);
  else if (def.hp >= 200) dmg = 3;
  else if (def.hp >= 100) dmg = 2;
  else dmg = 1;
  if (elite) dmg += 1;
  return Math.max(1, Math.min(40, Math.round(dmg)));
}
var ENEMIES = {
  runner: {
    kind: "runner",
    name: "Runner",
    hp: 32,
    speed: 2.35,
    radius: 15,
    color: 9305930,
    accent: 3111440,
    shape: "triangle",
    reward: 6,
    armor: "Unarmored",
    flatArmor: 0
  },
  grunt: {
    kind: "grunt",
    name: "Grunt",
    hp: 78,
    speed: 1.35,
    radius: 18,
    color: 16751407,
    accent: 9061376,
    shape: "square",
    reward: 10,
    armor: "Light",
    flatArmor: 1
  },
  brute: {
    kind: "brute",
    name: "Brute",
    hp: 240,
    speed: 0.82,
    radius: 27,
    color: 16726891,
    accent: 7997992,
    shape: "hex",
    reward: 22,
    armor: "Heavy",
    flatArmor: 3
  },
  flyer: {
    kind: "flyer",
    name: "Flyer",
    hp: 60,
    speed: 1.9,
    radius: 16,
    color: 10146047,
    accent: 2846678,
    shape: "diamond",
    reward: 12,
    flying: true,
    armor: "Light",
    flatArmor: 0,
    affinity: "Light",
    // Storm (strong vs Light) shreds it; Fire (weak) fizzles
    isAir: true
  },
  shielded: {
    kind: "shielded",
    name: "Bulwark",
    hp: 140,
    speed: 1.05,
    radius: 20,
    color: 13219583,
    accent: 5980080,
    shape: "square",
    reward: 16,
    shield: 90,
    shieldBlock: 0.6,
    armor: "Fortified",
    // Siege (Mortar) & Magic love it; Pierce (Sniper) struggles
    flatArmor: 2
  },
  healer: {
    kind: "healer",
    name: "Mender",
    hp: 110,
    speed: 1.15,
    radius: 19,
    color: 7077808,
    accent: 1416291,
    shape: "circle",
    reward: 18,
    healRadius: 2.2,
    healAmount: 14,
    healInterval: 1.4,
    armor: "Unarmored",
    flatArmor: 0,
    affinity: "Nature"
    // Fire (strong vs Nature) melts it; Storm (weak) barely dents
  },
  swarm: {
    kind: "swarm",
    name: "Sprite",
    hp: 14,
    speed: 2.75,
    radius: 10,
    color: 16769354,
    accent: 11566336,
    shape: "triangle",
    reward: 3,
    armor: "Unarmored",
    flatArmor: 0
  },
  // Fallback stat block for the 'keeper' kind — real Keeper fights override this
  // with per-Keeper defs from keepers.ts at spawn (sim looks them up by wave
  // entry). Exists so ENEMIES stays total over EnemyKind and any stray keeper
  // spawn degrades gracefully instead of crashing.
  keeper: {
    kind: "keeper",
    name: "Corrupted Keeper",
    hp: 900,
    speed: 0.5,
    radius: 34,
    color: 10130616,
    accent: 13219583,
    shape: "hex",
    reward: 90,
    boss: true,
    armor: "Light",
    flatArmor: 2
  },
  boss: {
    kind: "boss",
    name: "Titan",
    hp: 1400,
    speed: 0.6,
    radius: 38,
    color: 16731576,
    accent: 7998034,
    shape: "hex",
    reward: 120,
    shield: 400,
    shieldBlock: 0.5,
    boss: true,
    armor: "Warded",
    // resists ALL Magic (0.5×) — bring Physical/Siege cannons
    flatArmor: 5
  }
};

// src/game/towers.ts
var TOWERS = {
  cannon: {
    kind: "cannon",
    name: "Cannon",
    blurb: "Single target \xB7 heavy hit",
    cost: 90,
    color: 4881407,
    accent: 1585262,
    projectile: true,
    synergyDamage: true,
    antiAir: false,
    support: false,
    damageType: "Physical",
    armorPen: 0,
    defaultTargeting: "First",
    levels: [
      { damage: 24, range: 2.7, cooldown: 0.85, upgradeCost: 0 },
      { damage: 42, range: 3.1, cooldown: 0.72, upgradeCost: 85 },
      { damage: 70, range: 3.5, cooldown: 0.6, upgradeCost: 150 }
    ],
    branches: [
      // Sniper reforges the shot into armour-piercing rounds; Mortar into siege shells.
      { key: "sniper", name: "Sniper", blurb: "Colossal single hit \xB7 huge range", damage: 190, range: 5.2, cooldown: 1.15, upgradeCost: 320, damageType: "Pierce", armorPen: 8 },
      { key: "mortar", name: "Mortar", blurb: "Lobbed shell \xB7 splash blast", damage: 95, range: 3.9, cooldown: 0.85, upgradeCost: 320, splash: 1.5, damageType: "Siege" }
    ]
  },
  frost: {
    kind: "frost",
    name: "Frost",
    blurb: "Slows a whole area",
    cost: 70,
    color: 4905471,
    accent: 876416,
    projectile: false,
    synergyDamage: false,
    antiAir: false,
    support: false,
    damageType: "Magic",
    element: "Water",
    status: "slow",
    defaultTargeting: "Close",
    levels: [
      { damage: 5, range: 2.2, cooldown: 0.6, upgradeCost: 0, slowFactor: 0.55, slowDuration: 1.3 },
      { damage: 8, range: 2.6, cooldown: 0.55, upgradeCost: 70, slowFactor: 0.45, slowDuration: 1.5 },
      { damage: 12, range: 3, cooldown: 0.5, upgradeCost: 125, slowFactor: 0.35, slowDuration: 1.7 }
    ],
    branches: [
      // BALANCE (harness pass 18): range 4.0→3.5. Blizzard's board-wide slow kept the
      // pack clustered so Tempest chains hit everything and the combo ramped — the
      // clustering half of the flagged degenerate loop. Still the "wide chill", just
      // not the whole board. Keeps the no-immunity discipline (slow, never stop).
      { key: "blizzard", name: "Blizzard", blurb: "Wide chilling storm", damage: 18, range: 3.5, cooldown: 0.45, upgradeCost: 280, slowFactor: 0.32, slowDuration: 2 },
      { key: "glacier", name: "Glacier", blurb: "Deep freeze \xB7 hard stun", damage: 26, range: 2.8, cooldown: 0.75, upgradeCost: 280, slowFactor: 0.25, slowDuration: 2.2, stunDuration: 0.5 }
    ]
  },
  flame: {
    kind: "flame",
    name: "Flame",
    blurb: "Burn + splash \xB7 short range",
    cost: 80,
    color: 16738876,
    accent: 9053192,
    projectile: false,
    synergyDamage: true,
    antiAir: false,
    support: false,
    damageType: "Magic",
    element: "Fire",
    status: "burn",
    defaultTargeting: "Close",
    levels: [
      { damage: 9, range: 1.85, cooldown: 1, upgradeCost: 0, burnDps: 11, burnDuration: 2.2, splash: 1 },
      { damage: 15, range: 2.15, cooldown: 0.9, upgradeCost: 75, burnDps: 18, burnDuration: 2.4, splash: 1.15 },
      { damage: 24, range: 2.45, cooldown: 0.8, upgradeCost: 135, burnDps: 28, burnDuration: 2.6, splash: 1.35 }
    ],
    branches: [
      // Kingdom-Rush rule: each branch changes what the tower DOES on screen.
      // Scorch paints burning ground (area denial); Phoenix hunts one target with homing bolts.
      { key: "scorch", name: "Scorch", blurb: "Leaves burning ground \xB7 area denial", damage: 34, range: 2.7, cooldown: 1, upgradeCost: 300, burnDps: 30, burnDuration: 2.6, splash: 1.5, zoneDps: 30, zoneDuration: 3.2, zoneRadius: 1.25 },
      { key: "phoenix", name: "Phoenix", blurb: "Seeking firebolt \xB7 hunts one target", damage: 95, range: 4, cooldown: 0.8, upgradeCost: 300, burnDps: 46, burnDuration: 3, splash: 0, seeking: true }
    ]
  },
  storm: {
    kind: "storm",
    name: "Storm",
    blurb: "Lightning that chains",
    cost: 120,
    color: 16769354,
    accent: 10122240,
    projectile: false,
    synergyDamage: true,
    antiAir: true,
    support: false,
    damageType: "Magic",
    element: "Storm",
    defaultTargeting: "First",
    levels: [
      { damage: 20, range: 3, cooldown: 0.95, upgradeCost: 0, chainCount: 2, chainRange: 2.2, chainFalloff: 0.8 },
      { damage: 30, range: 3.3, cooldown: 0.85, upgradeCost: 110, chainCount: 3, chainRange: 2.4, chainFalloff: 0.82 },
      { damage: 44, range: 3.6, cooldown: 0.75, upgradeCost: 180, chainCount: 4, chainRange: 2.6, chainFalloff: 0.85 }
    ],
    branches: [
      { key: "tempest", name: "Tempest", blurb: "Arcs through the whole pack", damage: 58, range: 4, cooldown: 0.7, upgradeCost: 340, chainCount: 8, chainRange: 3, chainFalloff: 0.9 },
      { key: "overload", name: "Overload", blurb: "One devastating bolt", damage: 210, range: 4.2, cooldown: 1, upgradeCost: 340, chainCount: 0, chainRange: 2.4, chainFalloff: 0.8 }
    ]
  },
  arcane: {
    kind: "arcane",
    name: "Arcane",
    blurb: "Support \xB7 buffs neighbours",
    cost: 110,
    color: 12610559,
    accent: 5906330,
    projectile: false,
    synergyDamage: false,
    antiAir: true,
    support: true,
    damageType: "Magic",
    element: "Light",
    defaultTargeting: "Strong",
    levels: [
      { damage: 6, range: 1.6, cooldown: 1.2, upgradeCost: 0, buffDamage: 0.2, buffRange: 0.1 },
      { damage: 9, range: 1.6, cooldown: 1.1, upgradeCost: 90, buffDamage: 0.3, buffRange: 0.12 },
      { damage: 12, range: 1.6, cooldown: 1, upgradeCost: 160, buffDamage: 0.42, buffRange: 0.15 }
    ],
    branches: [
      // Amplify widens the buff NETWORK (reach 2 cells — visibly longer glow links);
      // Prism reforges the beam into armour-piercing shots while still buffing.
      { key: "amplify", name: "Amplify", blurb: "Buff aura reaches 2 tiles", damage: 14, range: 1.6, cooldown: 1, upgradeCost: 300, buffDamage: 0.55, buffRange: 0.18, buffReach: 2 },
      // BALANCE (harness pass 18): damage 52→66. Prism was the FLOOR of the tower
      // sweep (~25 waves vs ~39 for the top) — it neither buffs as widely as Amplify
      // nor out-damages a real DPS branch. A modest bump makes "buffs AND blasts"
      // worth the slot without touching its support role.
      { key: "prism", name: "Prism", blurb: "Piercing beam \xB7 buffs AND blasts", damage: 66, range: 3, cooldown: 0.6, upgradeCost: 300, buffDamage: 0.4, buffRange: 0.12, dealsDamage: true, damageType: "Pierce", armorPen: 6 }
    ]
  }
};

// src/game/spells.ts
var SPELLS = {
  meteor: {
    key: "meteor",
    name: "Meteor",
    blurb: "Tap an area \xB7 fiery AoE burst",
    color: 16742972,
    cooldown: 14,
    targeted: true,
    damage: 160,
    radius: 2.4,
    burnDps: 40,
    burnDuration: 3
  },
  freeze: {
    key: "freeze",
    name: "Freeze",
    blurb: "Stun every enemy briefly",
    color: 7067391,
    cooldown: 18,
    targeted: false,
    stunDuration: 2.2
  },
  goldrush: {
    key: "goldrush",
    name: "Gold Rush",
    blurb: "Instant battle-gold",
    color: 16766282,
    cooldown: 22,
    targeted: false,
    gold: 140
  }
};
var SPELL_ORDER = ["meteor", "freeze", "goldrush"];

// src/game/heroes.ts
var DARK = (c) => {
  const r = c >> 16 & 255, g = c >> 8 & 255, b = c & 255;
  return r * 0.32 << 16 | g * 0.32 << 8 | b * 0.32;
};
var HEROES = {
  ember: {
    id: "ember",
    name: "Ashka",
    title: "the Cinderblade",
    element: "Fire",
    role: "DPS",
    rarity: "rare",
    damageType: "Magic",
    glyph: "\u{1F525}",
    color: ELEMENT_COLOR.Fire,
    accent: DARK(ELEMENT_COLOR.Fire),
    blurb: "Foundling of the first greyed town. Fire has a second job, and it is warmth. Stay lit.",
    story: "They found her in the ashes of Kindlekeep, the first town the Greying took \u2014 the only warm thing in a cold grey street. She counts her victories out loud because the alternative is counting what she lost. Somewhere between body counts she is learning fire's second job: not to destroy the grey, but to keep the people behind her warm.",
    catchphrase: "Stay lit.",
    resonantTower: "flame",
    signature: {
      kind: "cindernova",
      name: "Stay Lit",
      glyph: "\u{1F4A5}",
      blurb: "Every 4th strike erupts in a Cindernova",
      detail: "Every 4th attack detonates around its target: 160% damage in a small area, and everything caught alight burns.",
      every: 4,
      mult: 1.6,
      radius: 1.4
    },
    baseDamage: 26,
    range: 3,
    cooldown: 0.7,
    deployCost: 110,
    unlockShards: 0,
    spell: {
      id: "fireball",
      name: "Fireball",
      blurb: "Tap an area \xB7 fiery burst + burn",
      glyph: "\u2604",
      effect: "aoeBurn",
      targeted: true,
      cooldown: 12,
      damage: 130,
      radius: 2.2,
      burnDps: 30,
      burnDuration: 3
    }
  },
  glacia: {
    id: "glacia",
    name: "Lumi",
    title: "the Glacier Oracle",
    element: "Water",
    role: "Control",
    rarity: "rare",
    damageType: "Magic",
    glyph: "\u2744",
    color: ELEMENT_COLOR.Water,
    accent: DARK(ELEMENT_COLOR.Water),
    blurb: "Youngest ever to read the Deep Ice. She has seen this battle. It goes well.",
    story: "The youngest Oracle ever to read the Deep Ice, she saw the Greying coming and nobody believed her. She is not bitter about it; bitterness is a future she chose not to read. She arrives before you call, answers the question you were about to ask, and is quietly delighted every time you improvise something the ice never showed her.",
    catchphrase: "I have seen this. It goes well.",
    resonantTower: "frost",
    signature: {
      kind: "foreseen",
      name: "Foreseen",
      glyph: "\u{1F441}",
      blurb: "Every 3rd strike lands exactly as she saw it",
      detail: "Every 3rd attack is Foreseen: it deals 220% damage and freezes the target for 0.7s \u2014 it was always going to land.",
      every: 3,
      mult: 2.2,
      stun: 0.7
    },
    baseDamage: 15,
    range: 2.8,
    cooldown: 0.85,
    slowFactor: 0.55,
    slowDuration: 1.4,
    deployCost: 100,
    unlockShards: 0,
    spell: {
      id: "frostnova",
      name: "Frost Nova",
      blurb: "Tap an area \xB7 freeze everything",
      glyph: "\u2746",
      effect: "freeze",
      targeted: true,
      cooldown: 15,
      radius: 2.6,
      stunDuration: 2,
      slowFactor: 0.4,
      slowDuration: 2.5
    }
  },
  sylvan: {
    id: "sylvan",
    name: "Thornwick",
    title: "the Grovewarden",
    element: "Nature",
    role: "Support",
    rarity: "common",
    damageType: "Physical",
    glyph: "\u{1F33F}",
    color: ELEMENT_COLOR.Nature,
    accent: DARK(ELEMENT_COLOR.Nature),
    blurb: "Ancient warden of the Wilds. Everything grey was green once \u2014 give it a minute.",
    story: "When the Greying reached the oldest tree in the Deeproot Wilds, Thornwick held the color in it with his bare hands for three days. He lost. He tells you this the way he tells you everything \u2014 slowly, warmly, relaying the moss's opinion on the matter. He knows regrowth is not restoration: what comes back comes back different. He plants anyway.",
    catchphrase: "Everything grey was green once. Give it a minute.",
    resonantTower: "cannon",
    signature: {
      kind: "deeproots",
      name: "Give It a Minute",
      glyph: "\u{1F333}",
      blurb: "His aura grows every wave he holds the ground",
      detail: "Deep roots: each wave cleared while he is fielded grows his support aura by +3% damage, up to +18%. Patience is a weapon.",
      ramp: 0.03,
      rampMax: 0.18
    },
    baseDamage: 9,
    range: 2.2,
    cooldown: 1.1,
    buffDamage: 0.24,
    deployCost: 90,
    unlockShards: 0,
    spell: {
      id: "healcircle",
      name: "Healing Circle",
      blurb: "Restore lives \xB7 ensnare foes",
      glyph: "\u271A",
      effect: "heal",
      targeted: false,
      cooldown: 20,
      radius: 2.6,
      heal: 3,
      slowFactor: 0.5,
      slowDuration: 3
    }
  },
  pyra: {
    id: "pyra",
    name: "Bramble",
    title: "Bramble & Bloom",
    element: "Fire",
    role: "Support",
    rarity: "common",
    damageType: "Magic",
    glyph: "\u{1F331}",
    color: 16751178,
    accent: DARK(16751178),
    blurb: "Twin sprouts who finish each other's sentences \u2014 and each other's sparks. Two of them. Too bad for you.",
    story: "Orphaned when the Wilds greyed, they were found coordinating squirrel ambushes against Morose's wisps \u2014 grim little Bramble laying the trap, bright little Bloom springing it. They finish each other's sentences, each other's sparks, and each other's fights. One slot on the roster. Two problems for the enemy.",
    catchphrase: "Two of us\u2014 / \u2014too bad for you!",
    resonantTower: "flame",
    signature: {
      kind: "twinspark",
      name: "Two of Us",
      glyph: "\u270C",
      blurb: "Every attack echoes \u2014 the twin strikes again",
      detail: "There are two of them: every attack is followed by the twin's echo strike for 55% damage. Both hits paint the element.",
      echo: 0.55
    },
    baseDamage: 12,
    range: 2.4,
    cooldown: 1,
    buffDamage: 0.2,
    deployCost: 95,
    unlockShards: 40,
    spell: {
      id: "cinderstorm",
      name: "Sparkseed Storm",
      blurb: "Tap an area \xB7 lingering embers",
      glyph: "\u{1F525}",
      effect: "aoeBurn",
      targeted: true,
      cooldown: 13,
      damage: 80,
      radius: 2.8,
      burnDps: 46,
      burnDuration: 3.5
    }
  },
  zephyra: {
    id: "zephyra",
    name: "Galea",
    title: "Capt. Stormwright",
    element: "Storm",
    role: "DPS",
    rarity: "epic",
    damageType: "Magic",
    glyph: "\u26A1",
    color: ELEMENT_COLOR.Storm,
    accent: DARK(ELEMENT_COLOR.Storm),
    blurb: "Sky-clipper captain who lost her crew to the dead calm. Wind's up, sails full \u2014 wager's on.",
    story: "Her sky-clipper hung in the dead calm for nineteen days while the Greying drank the wind, and when it lifted she was the only one still aboard. She is loud because the quiet is where the calm lives. She bets on everything \u2014 first kill, last leak, your next brilliant mistake \u2014 because a wager means there is a future to collect in. The roster is her crew now. She checks the knots twice.",
    catchphrase: "Wind's up, sails full \u2014 WAGER'S ON!",
    resonantTower: "storm",
    signature: {
      kind: "wager",
      name: "Wager's On",
      glyph: "\u{1F3B2}",
      blurb: "Every 6th strike pays out a free chain squall",
      detail: "She keeps count: every 6th attack pays out \u2014 a squall arcs from her target through up to 4 enemies at 70% damage.",
      every: 6,
      mult: 0.7,
      chainCount: 4,
      chainFalloff: 0.85
    },
    baseDamage: 30,
    range: 3.4,
    cooldown: 0.8,
    deployCost: 130,
    unlockShards: 120,
    spell: {
      id: "chainlightning",
      name: "Chain Squall",
      blurb: "Tap a foe \xB7 arcs through the pack",
      glyph: "\u{1F329}",
      effect: "chain",
      targeted: true,
      cooldown: 11,
      damage: 90,
      chainCount: 6,
      chainRange: 3,
      chainFalloff: 0.88
    }
  },
  volt: {
    id: "volt",
    name: "Fizz",
    title: "Arcwhistle",
    element: "Storm",
    role: "Control",
    rarity: "rare",
    damageType: "Magic",
    glyph: "\u2697",
    color: 9420799,
    accent: DARK(9420799),
    blurb: "Prism maintenance-corps gnome. Ninety-nine percent sure the stasis coils are calibrated.",
    story: 'Prism maintenance-corps, third class, decorated twice (once on purpose). Fizz once "solved" the Greying mathematically and force-recolored a whole village \u2014 technically perfect, completely soulless, and he has never fully forgiven the math. Now he builds the coils, calibrates the stasis fields, and leaves the feelings to the people who are better at them. He is ninety-nine percent sure this will work.',
    catchphrase: "Ninety-nine percent sure! The one percent is where the FUN lives!",
    resonantTower: "storm",
    signature: {
      kind: "overload",
      name: "The One Percent",
      glyph: "\u2699",
      blurb: "Overloads slowed or stunned enemies for +60%",
      detail: "Calibrated coils: his attacks on slowed or stunned enemies OVERLOAD for +60% damage and extend the slow by 0.6s. Pair him with chill.",
      mult: 1.6,
      slowExtend: 0.6
    },
    baseDamage: 18,
    range: 3,
    cooldown: 0.9,
    slowFactor: 0.6,
    slowDuration: 1.2,
    deployCost: 115,
    unlockShards: 80,
    spell: {
      id: "staticfield",
      name: "Static Field",
      blurb: "Tap an area \xB7 stun + slow",
      glyph: "\u26A1",
      effect: "freeze",
      targeted: true,
      cooldown: 14,
      radius: 2.4,
      stunDuration: 1.3,
      slowFactor: 0.5,
      slowDuration: 3
    }
  },
  aurelia: {
    id: "aurelia",
    name: "Seraphine",
    title: "Dawnhalo",
    element: "Light",
    role: "Support",
    rarity: "epic",
    damageType: "Magic",
    glyph: "\u2600",
    color: ELEMENT_COLOR.Light,
    accent: DARK(ELEMENT_COLOR.Light),
    blurb: "Youngest Lightwarden, never failed \u2014 yet. Hold the line; the dawn is already coming.",
    story: "The youngest Lightwarden ever commissioned, with a laminated certificate to prove it (currently missing; Nyx knows nothing). She has never failed. Not once. She keeps the record not out of pride but out of terror of what failing might cost someone else. She is learning \u2014 slowly, radiantly \u2014 that dawn is not the absence of night. It is what night is for.",
    catchphrase: "Hold the line \u2014 the dawn is already coming.",
    resonantTower: "arcane",
    signature: {
      kind: "intercession",
      name: "Hold the Line",
      glyph: "\u{1F6E1}",
      blurb: "Once per wave, smites an enemy at the gate",
      detail: "She has never failed: once per wave, the first enemy about to breach the gate is struck by dawn for 900% of her damage. If it survives that, it earned the leak.",
      nukeMult: 9
    },
    baseDamage: 20,
    range: 2.8,
    cooldown: 0.95,
    buffDamage: 0.3,
    deployCost: 125,
    unlockShards: 120,
    spell: {
      id: "holynova",
      name: "Aegis of Dawn",
      blurb: "Burst of light \xB7 empowers heroes",
      glyph: "\u2726",
      effect: "novaBuff",
      targeted: false,
      cooldown: 16,
      damage: 110,
      radius: 3,
      buffMult: 1.6,
      buffDuration: 6
    }
  },
  vex: {
    id: "vex",
    name: "Nyx",
    title: "the Umbral Trickster",
    element: "Dark",
    role: "DPS",
    rarity: "epic",
    damageType: "Pierce",
    glyph: "\u{1F5E1}",
    color: ELEMENT_COLOR.Dark,
    accent: DARK(ELEMENT_COLOR.Dark),
    blurb: "From the Twilight Margins. You won't see her coming \u2014 nobody ever does. Their loss.",
    story: "She grew up in the Twilight Margins, the realm everyone treated as basically grey already \u2014 so she knows better than anyone that they were wrong. She steals things and returns them improved. She lies in exactly one bark out of every few (good luck). When Morose told her she was always his, she laughed: shadow isn't the absence of color, you sad old man. Shadow is where color RESTS.",
    catchphrase: "You won't see me coming. Nobody ever does\u2026 their loss.",
    resonantTower: "arcane",
    signature: {
      kind: "tithe",
      name: "Their Loss",
      glyph: "\u{1F4B0}",
      blurb: "Pickpockets +45% bonus gold from her kills",
      detail: "Everything she finishes gets its pockets turned out: enemies killed by her attacks drop +45% bonus gold. She was going to return it. Probably.",
      goldFrac: 0.45
    },
    baseDamage: 34,
    range: 3,
    cooldown: 0.75,
    deployCost: 135,
    unlockShards: 150,
    spell: {
      id: "shadowstrike",
      name: "Umbral Pounce",
      blurb: "Tap a foe \xB7 executes the weak",
      glyph: "\u2620",
      effect: "execute",
      targeted: true,
      cooldown: 10,
      damage: 200,
      executeThreshold: 0.35,
      executeMult: 3
    }
  }
};
function heroById(id) {
  return HEROES[id] ?? null;
}

// src/game/heroProgress.ts
var MAX_HERO_LEVEL = 20;
var SIGNATURE_UNLOCK_LEVEL = 3;
function signatureAwake(level) {
  return clampLevel(level) >= SIGNATURE_UNLOCK_LEVEL;
}
var DMG_GROWTH = 0.11;
var SPELL_GROWTH = 0.1;
function clampLevel(level) {
  return Math.max(1, Math.min(MAX_HERO_LEVEL, Math.floor(Number.isFinite(level) ? level : 1)));
}
function dmgMult(level) {
  return 1 + DMG_GROWTH * (clampLevel(level) - 1);
}
function heroStats(def, level) {
  const m = dmgMult(level);
  const damage = clamp(def.baseDamage * m, 0, 1e7);
  const cooldown = clamp(def.cooldown, 0.05, 10);
  const buffDamage = def.buffDamage ? clamp(def.buffDamage * m, 0, 4) : 0;
  const range = clamp(def.range, 0.5, 12);
  const slowFactor = def.slowFactor ?? 1;
  const slowDuration = def.slowDuration ?? 0;
  return {
    damage,
    range,
    cooldown,
    buffDamage,
    slowFactor: clamp(slowFactor, 0.1, 1),
    slowDuration: clamp(slowDuration, 0, 8),
    dps: clamp(damage / cooldown, 0, 1e7)
  };
}
function spellLevelMult(level) {
  const L = clampLevel(level);
  return L <= 2 ? 1 + SPELL_GROWTH * (L - 1) : 1 + SPELL_GROWTH + 0.2 * (L - 2);
}
function heroSpellScaled(spell, level) {
  const m = spellLevelMult(level);
  const scale = (v) => v === void 0 ? void 0 : clamp(v * m, 0, 1e7);
  return {
    ...spell,
    damage: scale(spell.damage),
    burnDps: scale(spell.burnDps),
    heal: spell.heal,
    // lives are integral & shouldn't inflate with level
    chainCount: spell.chainCount
  };
}

// src/game/wyrms.ts
var TOWER_ELEMENTS = new Set(
  Object.keys(TOWERS).map((k2) => TOWERS[k2].element).filter((e3) => !!e3)
);
var DARK2 = (c) => {
  const r = c >> 16 & 255, g = c >> 8 & 255, b = c & 255;
  return r * 0.34 << 16 | g * 0.34 << 8 | b * 0.34;
};
var WYRMS = {
  pyrax: {
    id: "pyrax",
    name: "Pyrax",
    title: "the First Ember",
    element: "Fire",
    emoji: "\u{1F525}",
    glyph: "\u{1F432}",
    color: ELEMENT_COLOR.Fire,
    accent: DARK2(ELEMENT_COLOR.Fire),
    realmId: "emberwaste",
    file: "1-pyrax-fire.png",
    breathName: "Emberbreath",
    status: "burn",
    blurb: "The fire-soul of Emberwaste. Curled around Kindlekeep's last coal, waiting for someone brave enough to be warm.",
    waking: "Under the cold forges, a coal remembers how to blaze. Pyrax uncoils \u2014 and the sky over Emberwaste catches light again."
  },
  glaciaxis: {
    id: "glaciaxis",
    name: "Glaciaxis",
    title: "the Deep Frost",
    element: "Water",
    emoji: "\u2744\uFE0F",
    glyph: "\u{1F409}",
    color: ELEMENT_COLOR.Water,
    accent: DARK2(ELEMENT_COLOR.Water),
    realmId: "frostreach",
    file: "2-glaciaxis-ice.png",
    breathName: "Rimebreath",
    status: "slow",
    blurb: "The ice-soul of Frostreach. It dreamed the Greying too, and chose to sleep until the aurora could sing again.",
    waking: "The frozen aurora cracks like a held breath let go. Glaciaxis wakes, and Frostreach glitters instead of apologising."
  },
  voltaryx: {
    id: "voltaryx",
    name: "Voltaryx",
    title: "the Sky's Verdict",
    element: "Storm",
    emoji: "\u26A1",
    glyph: "\u{1F432}",
    color: ELEMENT_COLOR.Storm,
    accent: DARK2(ELEMENT_COLOR.Storm),
    realmId: "stormpeaks",
    file: "3-voltaryx-lightning.png",
    breathName: "Stormbreath",
    status: "stun",
    blurb: "The storm-soul of Stormpeaks. The dead calm nearly drank it dry; it kept one spark, and one spark is enough.",
    waking: "Thunder that forgot its own name finds it again. Voltaryx climbs the dead-calm sky and the Stormpeaks roar awake."
  },
  verdwyrm: {
    id: "verdwyrm",
    name: "Verdwyrm",
    title: "the Green Patience",
    element: "Nature",
    emoji: "\u{1F33F}",
    glyph: "\u{1F409}",
    color: ELEMENT_COLOR.Nature,
    accent: DARK2(ELEMENT_COLOR.Nature),
    realmId: "verdant",
    file: "4-verdwyrm-nature.png",
    breathName: "Bloombreath",
    status: "poison",
    blurb: "The green-soul of the Verdant Wilds. It held one seed of colour for a hundred grey years. It is very good at waiting.",
    waking: "A single seed keeps its promise. Verdwyrm unfurls from the oldest root and the Wilds exhale a hundred years of held green."
  },
  lumenwyrm: {
    id: "lumenwyrm",
    name: "Lumenwyrm",
    title: "the Kept Dawn",
    element: "Light",
    emoji: "\u2728",
    glyph: "\u{1F432}",
    color: ELEMENT_COLOR.Light,
    accent: DARK2(ELEMENT_COLOR.Light),
    realmId: "lumen",
    file: "5-lumenwyrm-light.png",
    breathName: "Dawnbreath",
    status: "tear",
    blurb: "The light-soul of Lumen Sanctum. It guttered but never went out \u2014 light that refused, gently, to give up.",
    waking: "The last lantern of Aetheria flares white. Lumenwyrm rises over Lumen Sanctum: dawn is not the absence of night, it is what night is for."
  },
  umbrawyrm: {
    id: "umbrawyrm",
    name: "Umbrawyrm",
    title: "the Rested Colour",
    element: "Dark",
    emoji: "\u{1F573}\uFE0F",
    glyph: "\u{1F409}",
    color: ELEMENT_COLOR.Dark,
    accent: DARK2(ELEMENT_COLOR.Dark),
    realmId: "hollow",
    file: "6-umbrawyrm-void.png",
    breathName: "Umbrabreath",
    status: "slow",
    blurb: "The shadow-soul of the Hollow \u2014 nearest of all to the grey, and proof shadow is not its absence. Shadow is where colour rests.",
    waking: "In the Hollow, the dark opens one patient eye. Umbrawyrm wakes \u2014 not the Greying's kin, but every colour, resting, ready to fly."
  }
};
function wyrmById(id) {
  return WYRMS[id] ?? null;
}
var WYRM_MAX_LEVEL = 12;
var RANKED_WYRM_LEVEL = 6;
function clampWyrmLevel(level) {
  return Math.max(1, Math.min(WYRM_MAX_LEVEL, Math.floor(Number.isFinite(level) ? level : 1)));
}
function wyrmStage(level) {
  const l = clampWyrmLevel(level);
  return l >= 8 ? "adult" : l >= 4 ? "juvenile" : "hatchling";
}
var STAGE_LABEL = { hatchling: "Hatchling", juvenile: "Juvenile", adult: "Adult" };
var STAGE_MULT = { hatchling: 1, juvenile: 1.5, adult: 2.2 };
var STAGE_RADIUS = { hatchling: 0, juvenile: 0.3, adult: 0.6 };
var BOND_MATRIX = {
  ember: { perfect: "pyrax", good: ["voltaryx"] },
  // Ashka 🔥
  glacia: { perfect: "glaciaxis", good: ["lumenwyrm"] },
  // Lumi ❄️
  zephyra: { perfect: "voltaryx", good: ["glaciaxis"] },
  // Galea ⚡
  sylvan: { perfect: "verdwyrm", good: ["pyrax"] },
  // Thornwick 🌿 (Pyrax = risk/reward wildfire)
  aurelia: { perfect: "lumenwyrm", good: ["umbrawyrm"] },
  // Seraphine ✨ (Umbrawyrm = eclipse foils ★)
  vex: { perfect: "umbrawyrm", good: ["voltaryx"] },
  // Nyx 🌑 (Umbrawyrm = redemption ★★)
  pyra: { perfect: "pyrax", good: ["verdwyrm"] },
  // Bramble & Bloom (Fire by data)
  volt: { prism: true }
  // Fizz ⚗ — PRISM BOND
};
function bondTier(heroId, wyrmId) {
  const m = BOND_MATRIX[heroId];
  if (!m) return "regular";
  if (m.prism) return "good";
  if (m.perfect === wyrmId) return "perfect";
  if (m.good && m.good.includes(wyrmId)) return "good";
  return "regular";
}
var TIER_LABEL = { perfect: "Attunement", good: "Harmony", regular: "Bonded" };
var TIER_BREATH = { perfect: 1.7, good: 1.3, regular: 1 };
var TIER_HEROAMP = { perfect: 1.2, good: 1.12, regular: 1.06 };
var TIER_TOWER = { perfect: 0.14, good: 0.09, regular: 0.05 };
var TIER_CD = { perfect: 3.4, good: 3.7, regular: 4.2 };
var TIER_RADIUS = { perfect: 0.3, good: 0.15, regular: 0 };
var NAMED_BONDS = {
  "ember:pyrax": { name: "Emberbond", blurb: "Ashka and the First Ember burn as one \u2014 a searing nova of living fire.", story: "Two foundlings of the fire. Neither was ever really cold; they just needed something warm to stand next to." },
  "glacia:glaciaxis": { name: "Deepfrost", blurb: "Lumi reads the Deep Ice and Glaciaxis makes it true \u2014 the whole field stills.", story: "The oracle and the dragon dreamed the same grey future. Together they choose a different one." },
  "zephyra:voltaryx": { name: "Tempest", blurb: "Galea calls the wager and Voltaryx pays it \u2014 a sky-splitting storm answers.", story: `"Wind's up, sails full \u2014 and now the sky bets WITH me." The captain finally has a crew that cannot vanish.` },
  "sylvan:verdwyrm": { name: "Wildheart", blurb: "Thornwick and Verdwyrm let the Wilds run wild \u2014 roots and rot erupt at once.", story: "Two of the oldest patient things in Aetheria. They lost the same tree once. They plant this one together." },
  "aurelia:lumenwyrm": { name: "Dawnbond", blurb: "Seraphine and Lumenwyrm break the dark \u2014 a dawn nobody can halo into inaction.", story: "The youngest Lightwarden and the kept dawn. Neither has ever failed. Neither intends to start." },
  "vex:umbrawyrm": { name: "Starless", blurb: "Nyx and the shadow-Wyrm turn out the lights \u2014 colour rests, then strikes from nowhere.", story: "Everyone treated both of them as basically grey already. The redemption pair: shadow is where colour RESTS, and it has been resting a long, patient while." },
  "pyra:pyrax": { name: "Twin Ember", blurb: "Bramble, Bloom and Pyrax \u2014 three sparks, one echo, twice the fire.", story: "The twins adopt a dragon the size of a house and treat it exactly like a very large squirrel. It adores them." },
  // GOOD, narrative foils (no full ultimate — a named minor fused effect + a beat)
  "aurelia:umbrawyrm": { name: "Eclipse", blurb: "Light and shadow foils \u2014 Seraphine's breath briefly blinds the whole pack.", story: "The bicker-ship, made cosmic. She holds the dawn; the Wyrm holds the dusk. Somebody has to." },
  "glacia:lumenwyrm": { name: "Prism-Ice", blurb: "Lumi bends Lumenwyrm's light through the Deep Ice \u2014 refracted, armor-stripping frost.", story: "The oracle likes that this one is honest: light through ice tells you exactly what it will do." }
};
function levelGrowth(level) {
  return 1 + 0.08 * (clampWyrmLevel(level) - 1);
}
function resolveBond(heroId, wyrmId, level) {
  const wyrm = wyrmById(wyrmId);
  if (!wyrm) return null;
  const tier = bondTier(heroId, wyrmId);
  const stage = wyrmStage(level);
  const named = NAMED_BONDS[`${heroId}:${wyrmId}`] ?? null;
  const breathDamage = clamp(24 * STAGE_MULT[stage] * TIER_BREATH[tier] * levelGrowth(level), 0, 1e6);
  const breathRadiusTiles = clamp(1.8 + STAGE_RADIUS[stage] + TIER_RADIUS[tier], 1, 5);
  const heroAmp = TIER_HEROAMP[tier];
  const towerBuff = TIER_TOWER[tier];
  const status = tier === "regular" ? "" : wyrm.status;
  const ult = tier === "perfect" ? {
    name: named?.name ?? `${wyrm.name} Ascendant`,
    blurb: named?.blurb ?? `${wyrm.name} and its bondmate unleash a fused ${wyrm.breathName} once per wave.`,
    damageMult: 3,
    radiusTiles: clamp(breathRadiusTiles + 1, 1, 6)
  } : null;
  return {
    heroId,
    wyrm,
    tier,
    tierLabel: TIER_LABEL[tier],
    level: clampWyrmLevel(level),
    stage,
    stageLabel: STAGE_LABEL[stage],
    breathDamage,
    breathRadiusTiles,
    breathCd: TIER_CD[tier],
    heroAmp,
    towerBuff,
    status,
    ult,
    named
  };
}

// src/game/synergy.ts
var PAIRS = [
  { a: "Fire", b: "Storm", id: "firestorm", name: "Firestorm", desc: "+18% hero damage", color: 16747068, icon: "\u{1F525}", allDmgMult: 1.18 },
  { a: "Water", b: "Storm", id: "conduction", name: "Conduction", desc: "+16% hero attack speed", color: 7329535, icon: "\u26A1", atkSpeedMult: 0.84 },
  { a: "Fire", b: "Nature", id: "wildfire", name: "Wildfire", desc: "+16% hero damage", color: 12582730, icon: "\u{1F30B}", allDmgMult: 1.16 },
  { a: "Water", b: "Nature", id: "bloom", name: "Bloom", desc: "+12% hero attack speed", color: 7274400, icon: "\u{1F30A}", atkSpeedMult: 0.88 },
  { a: "Light", b: "Dark", id: "eclipse", name: "Eclipse", desc: "+22% hero damage", color: 14067455, icon: "\u{1F313}", allDmgMult: 1.22 },
  { a: "Light", b: "Storm", id: "radiance", name: "Radiance", desc: "+14% hero damage", color: 16773280, icon: "\u2726", allDmgMult: 1.14 },
  { a: "Fire", b: "Dark", id: "brimstone", name: "Brimstone", desc: "+20% hero damage", color: 16738954, icon: "\u2604", allDmgMult: 1.2 }
];
var SAME_ELEMENT_DMG = 1.25;
var PRISM_STAT = 1.1;
function neutralSynergy() {
  const elementDmg = {};
  for (const e3 of Object.keys(ELEMENT_COLOR)) elementDmg[e3] = 1;
  return { elementDmg, allDmgMult: 1, atkSpeedMult: 1, allStatMult: 1 };
}
function computeSynergies(elements) {
  const effects = neutralSynergy();
  const bonuses = [];
  if (elements.length === 0) return { bonuses, effects };
  const counts = /* @__PURE__ */ new Map();
  for (const e3 of elements) counts.set(e3, (counts.get(e3) ?? 0) + 1);
  for (const e3 of Object.keys(ELEMENT_COLOR)) {
    const n = counts.get(e3) ?? 0;
    if (n >= 2) {
      effects.elementDmg[e3] *= SAME_ELEMENT_DMG;
      bonuses.push({
        id: `same_${e3}`,
        name: `${e3} Bond`,
        desc: `+25% ${e3} hero damage`,
        color: ELEMENT_COLOR[e3],
        icon: "\u25C6",
        members: [e3]
      });
    }
  }
  for (const p of PAIRS) {
    if (counts.has(p.a) && counts.has(p.b)) {
      if (p.allDmgMult) effects.allDmgMult *= p.allDmgMult;
      if (p.atkSpeedMult) effects.atkSpeedMult *= p.atkSpeedMult;
      bonuses.push({ id: p.id, name: p.name, desc: p.desc, color: p.color, icon: p.icon, members: [p.a, p.b] });
    }
  }
  if (counts.size >= 3) {
    effects.allStatMult *= PRISM_STAT;
    bonuses.push({
      id: "prism",
      name: "Prism Bond",
      desc: "+10% all hero stats",
      color: 16777215,
      icon: "\u2728",
      members: [...counts.keys()]
    });
  }
  return { bonuses, effects };
}

// src/game/resonance.ts
var TIER1_COUNT = 2;
var TIER2_COUNT = 4;
var TIER1_TOWER = 1.12;
var TIER1_HERO = 1.22;
var TIER2_TOWER = 1.2;
var TIER2_HERO = 1.45;
var pct = (m) => `+${Math.round((m - 1) * 100)}%`;
function computeResonances(fielded, towerCounts) {
  const byKind = /* @__PURE__ */ new Map();
  for (const f of fielded) {
    if (!f.awake) continue;
    const def = heroById(f.heroId);
    if (!def) continue;
    const list = byKind.get(def.resonantTower) ?? [];
    if (!list.includes(f.heroId)) list.push(f.heroId);
    byKind.set(def.resonantTower, list);
  }
  const out = [];
  for (const [kind, heroIds] of byKind) {
    const count = towerCounts[kind] ?? 0;
    if (count < TIER1_COUNT) continue;
    const tier = count >= TIER2_COUNT ? 2 : 1;
    const towerMult = tier === 2 ? TIER2_TOWER : TIER1_TOWER;
    const heroMult = tier === 2 ? TIER2_HERO : TIER1_HERO;
    const tdef = TOWERS[kind];
    const heroNames = heroIds.map((id) => heroById(id)?.name ?? id);
    out.push({
      id: `res_${kind}_t${tier}`,
      towerKind: kind,
      towerName: tdef.name,
      heroIds,
      heroNames,
      color: tdef.color,
      icon: "\u{1F517}",
      count,
      tier,
      towerMult,
      heroMult,
      name: `${tdef.name} Resonance${tier === 2 ? " II" : ""}`,
      desc: `${pct(towerMult)} ${tdef.name} tower dmg \xB7 ${pct(heroMult)} hero dmg`
    });
  }
  out.sort((a, b) => a.towerKind < b.towerKind ? -1 : a.towerKind > b.towerKind ? 1 : 0);
  return out;
}

// src/game/keepers.ts
var keeperEnemy = (o) => ({
  kind: "keeper",
  speed: 0.52,
  radius: 34,
  shape: "hex",
  flatArmor: 2,
  boss: true,
  ...o
});
var KEEPERS = [
  {
    id: "kaelen",
    levelId: "l1",
    name: "KAELEN, THE ASHEN COURT",
    trueName: "Kaelen, Keeper of Embervale",
    element: "Fire",
    heroId: "ember",
    ability: "ashenSnuff",
    abilityName: "ASHEN SNUFF",
    twist: "Ashka's Cindernova, inverted: his pulse SNUFFS every burn, poison and primed aura around him. Burst him down between pulses.",
    castEvery: 9,
    telegraph: 2,
    power: 2.8,
    // snuff radius in tiles
    greySeconds: 0,
    enemy: keeperEnemy({ name: "Kaelen, the Ashen Court", hp: 640, speed: 0.5, color: 10260367, accent: 16747084, reward: 90, armor: "Light", flatArmor: 1, affinity: "Fire" }),
    barks: {
      reveal: "Kindlekeep burned because I kept it lit. Ash is the only honest colour.",
      heroLine: 'Kaelen. You taught me "stay lit." Say it back. SAY IT BACK.',
      phase2: "Why does it still glow\u2026 under the ash\u2026",
      phase3: "It's warm. Stop. STOP. \u2026don't stop.",
      redeemed: "The forge\u2026 remembers me. Ashka \u2014 I'm sorry. I'm LIT.",
      morose: "One ember rekindled. How exhausting for it. The grey will wait."
    }
  },
  {
    id: "maravelle",
    levelId: "l2",
    name: "MARAVELLE, THE STILL ORACLE",
    trueName: "Maravelle, Keeper of the Glacier Courts",
    element: "Water",
    heroId: "glacia",
    ability: "stillGrace",
    abilityName: "STILL GRACE",
    twist: "Lumi's Foreseen, frozen solid: she seals your proudest tower in 'its happiest instant' \u2014 beautiful, useless. Spread your damage; don't lean on one tower.",
    castEvery: 11,
    telegraph: 2.2,
    power: 1,
    // towers frozen per cast
    greySeconds: 4.5,
    enemy: keeperEnemy({ name: "Maravelle, the Still Oracle", hp: 980, speed: 0.48, color: 12375262, accent: 8381439, reward: 105, armor: "Fortified", shield: 220, shieldBlock: 0.5, affinity: "Water" }),
    barks: {
      reveal: "Little Lumi's new friend. I froze my happiest morning and I live there now.",
      heroLine: "Mentor. You taught me to read the ice. This page is WRONG.",
      phase2: "The morning is\u2026 melting\u2026",
      phase3: "I foresaw this. I hoped I misread. I never misread.",
      redeemed: "Oh. The ice was never meant to stop the river. Lumi \u2014 read on without me. No. WITH me.",
      morose: "She chose the moving water. It will hurt her, you know. Moving always does."
    }
  },
  {
    id: "vorn",
    levelId: "l3",
    name: "ADMIRAL VORN, THE BECALMED",
    trueName: "Admiral Vorn of the Stormfleet",
    element: "Storm",
    heroId: "zephyra",
    ability: "becalm",
    abilityName: "GREY RIGGING",
    twist: "Galea's chain squall, reversed: his grey rigging arcs through his own fleet and HEALS it. Kill his escorts first, or focus him before the rigging links.",
    castEvery: 8,
    telegraph: 1.8,
    power: 0.08,
    // heal fraction of maxHp per linked ally
    greySeconds: 0,
    enemy: keeperEnemy({ name: "Admiral Vorn, the Becalmed", hp: 1280, speed: 0.55, color: 9413544, accent: 16767324, reward: 120, armor: "Light", flatArmor: 2, affinity: "Storm" }),
    barks: {
      reveal: "Stormwright's prot\xE9g\xE9. I waited nineteen years for wind. It never came. So I stopped the asking.",
      heroLine: "VORN! The wind doesn't come back for ships that furl their sails! HOIST!",
      phase2: "The rigging\u2026 hums. It has not hummed since\u2026",
      phase3: "Is that\u2026 weather? On MY deck?",
      redeemed: "WIND. Galea \u2014 you insufferable, magnificent gale \u2014 the fleet sails at dawn!",
      morose: "A sail full of wanting. It will tear, poor captain. Sails always tear."
    }
  },
  {
    id: "wessa",
    levelId: "l4",
    name: "WESSA, THE OVERGROWN",
    trueName: "Wessa, Keeper of the Deeproot Wilds",
    element: "Nature",
    heroId: "sylvan",
    ability: "thornCocoon",
    abilityName: "THORN COCOON",
    twist: "Thornwick's Deeproots, smothering: she wraps her brood in preservative thorn-shields \u2014 nothing may die, so nothing may live. Bring shield-breakers and siege.",
    castEvery: 10,
    telegraph: 2,
    power: 0.14,
    // shield fraction of each ally's maxHp per cast
    greySeconds: 0,
    enemy: keeperEnemy({ name: "Wessa, the Overgrown", hp: 1580, speed: 0.46, color: 10135695, accent: 7331978, reward: 135, armor: "Heavy", flatArmor: 3, affinity: "Nature" }),
    barks: {
      reveal: "Thornwick sent a gardener. I preserved EVERYTHING, old friend. Nothing I hold will ever die again.",
      heroLine: "Wessa. A pressed flower isn't a garden. The moss votes we let things GROW. So do I.",
      phase2: "The cocoons\u2026 they're cracking from INSIDE\u2026",
      phase3: "Growing means dying a little. I had\u2026 forgotten the price.",
      redeemed: "Then let it all bloom and be brief. Thornwick \u2014 the Wilds are BREATHING.",
      morose: "She opened her fists. Everything she holds will wilt now. I did warn her."
    }
  },
  {
    id: "aurelin",
    levelId: "l5",
    name: "HIGH CANTOR AURELIN",
    trueName: "Aurelin, First Light of the Dawnspire",
    element: "Light",
    heroId: "aurelia",
    ability: "gildedHalo",
    abilityName: "PACIFYING GRACE",
    twist: "Seraphine's blessing, gone soft: his grace haloes your two strongest towers into serene inaction. Keep backup damage wide \u2014 grace can't pacify everyone.",
    castEvery: 9.5,
    telegraph: 2.2,
    power: 2,
    // towers haloed per cast
    greySeconds: 3.6,
    enemy: keeperEnemy({ name: "High Cantor Aurelin", hp: 1950, speed: 0.5, color: 13616290, accent: 16769658, reward: 150, armor: "Warded", shield: 320, shieldBlock: 0.45, affinity: "Light" }),
    barks: {
      reveal: "Seraphine's little vigil. Child, striving is just suffering with better posture. Be at peace.",
      heroLine: "High Cantor. You pinned my first commendation. Peace that stops the WATCH is not peace. The line HOLDS.",
      phase2: "The hymn falters\u2026 who changed the KEY?",
      phase3: "Dawn is\u2026 not a reward for stillness, is it. It never was.",
      redeemed: "The dawn does not wait to be deserved. Seraphine \u2014 sing the loud verse. ALL forty.",
      morose: "Even the choir turns on me. Sing, then. The grey has excellent acoustics."
    }
  },
  {
    id: "vesper",
    levelId: "l6",
    name: "VESPER, MARGRAVE OF MOTHS",
    trueName: "Vesper of the Twilight Margins",
    element: "Dark",
    heroId: "vex",
    ability: "mothMirror",
    abilityName: "MOTH MIRROR",
    twist: "Nyx's own trick, hollowed: the Margrave BORROWS one of your fielded heroes \u2014 greyed, absent, gone for a breath. The rest of the line must hold without them.",
    castEvery: 10,
    telegraph: 2.4,
    power: 1,
    greySeconds: 5,
    enemy: keeperEnemy({ name: "Vesper, Margrave of Moths", hp: 2150, speed: 0.5, color: 9406120, accent: 11561983, reward: 170, armor: "Warded", shield: 260, shieldBlock: 0.5, affinity: "Dark" }),
    barks: {
      reveal: "Nobody remembers the Margins. So I became nobody, wearing everybody. Which of yours shall I be?",
      heroLine: "I remember you. VESPER. Somebody from the Margins remembers EVERYBODY.",
      phase2: "That name. Nobody has said that name in\u2014",
      phase3: "Stop LOOKING at me like I'm someone. \u2026like I'm me.",
      redeemed: "Vesper. I had a name. Nyx \u2014 you terrible little thief. You stole me BACK.",
      morose: "So the moths fly home. Come then, little brush. It is only me now. It was always only me."
    }
  }
];
var KEEPER_BY_ID = Object.fromEntries(KEEPERS.map((k2) => [k2.id, k2]));
var KEEPER_PHASES = 3;
var PHASE2_AT = 0.66;
var PHASE3_AT = 0.33;
var PHASE_CAST_MULT = [1, 0.78, 0.58];
var PHASE3_SPEED = 1.14;
var ECHO_CAST_MULT = 1.6;
var ECHO_HP_MULT = 0.42;
function keeperPhaseFor(hpFrac) {
  return hpFrac <= PHASE3_AT ? 3 : hpFrac <= PHASE2_AT ? 2 : 1;
}

// src/sim/sim.ts
var COMBO_WINDOW = 2.2;
var COMBO_STEP = 0.15;
var COMBO_MAX = 6;
var DRAFT_EVERY = 3;
var PROJECTILE_SPEED = 760;
var INTRUSION_WARN = 1.4;
var INTRUSION_GREY_DUR = 6;
var INTRUSION_MIN_LEVEL = 1;
var AURA_WINDOW = 4;
var REACT_LOCK = 1.1;
var AMPLIFY_TAKEN = 1.25;
var AMPLIFY_DURATION = 4;
var MAX_ZONES = 48;
var KEEPER_FIRST_CAST = 0.6;
var KEEPER_MIN_CAST_GAP = 3;
var KEEPER_COCOON_CAP = 0.6;
var FUSION_COST = 300;
var FUSION_DMG = 1.75;
var FUSION_RNG = 1.15;
var TOWER_AURA = {
  flame: "Fire",
  frost: "Water",
  storm: "Storm",
  arcane: "Arcane",
  cannon: void 0
};
var Sim = class {
  constructor(config) {
    // path / grid
    this.grid = [];
    this.terrain = [];
    // per-cell terrain flag ('' = none); read by canPlace/effDamage/effRange
    this.occupied = [];
    // MULTI-ROUTE: one waypoint chain + segment list + length per spawn route. All
    // routes converge on the SAME base cell. Single-route levels have routes.length===1
    // so every consumer (movement, targeting, view) behaves byte-identically to before.
    this.routes = [];
    this.pathLength = 0;
    // = the LONGEST route's length (the dist-range invariant upper bound)
    // pooled entities (iterate skipping .active === false; never per-frame alloc)
    this.enemies = [];
    this.towers = [];
    this.projectiles = [];
    this.heroes = [];
    this.zones = [];
    // burning-ground hazards (Scorch branch)
    // heroes: the loadout available to deploy, which ids are already fielded, and the
    // live element-synergy state (recomputed whenever the field changes).
    this.occupiedHero = [];
    this.partyDefs = [];
    this.deployedHeroIds = /* @__PURE__ */ new Set();
    this.synergyEffects = neutralSynergy();
    this.synergyBonuses = [];
    // ELEMENT RESONANCE — awakened hero + 2/4+ towers of their resonant kind.
    // Recomputed on every placement/deploy; folded into effDamage / heroDamage.
    this.resonances = [];
    this.resTowerMult = /* @__PURE__ */ new Map();
    this.resHeroMult = /* @__PURE__ */ new Map();
    this.resSeen = /* @__PURE__ */ new Set();
    // banner each resonance tier only ONCE per run
    this.gold = 0;
    this.lives = 0;
    this.startLives = 0;
    this.waveIndex = 0;
    this.state = "prep";
    this.clock = 0;
    this.prepTimer = 0;
    // combo engine
    this.comboCount = 0;
    this.comboMult = 1;
    this.comboTimer = 0;
    // Greying restoration: kills this wave / wave size, for colorProgress()
    this.waveKills = 0;
    this.waveSpawnTotal = 1;
    // run-wide draft upgrades
    this.upgrades = neutralUpgrades();
    this.draftOffer = [];
    this.draftsTaken = 0;
    this.fx = neutralRogueEffects();
    this.rogueBoost = [];
    this.rogueTakenIds = /* @__PURE__ */ new Set();
    // Morose intrusions — planned up-front from a SEPARATE rng stream (the main
    // rng's draw order is untouched, so pre-intrusion seeds replay identically).
    // greyWaves: wave indices that get a mid-wave grey-a-tower moment.
    // stealDraftOrdinal: which draft (by draftsTaken) offers 2 cards instead of 3.
    this.greyWaves = /* @__PURE__ */ new Map();
    // waveIndex -> seconds into the wave
    this.stealDraftOrdinal = -1;
    this.greyPendingAt = -1;
    // clock time the pending grey lands (-1 = none)
    this.greyWarned = false;
    // run stats — pure counters for the prove-it share card / score. They consume
    // no RNG and never feed back into gameplay, so determinism is untouched.
    this.runStats = {
      kills: 0,
      bossKills: 0,
      maxCombo: 0,
      // highest comboCount reached
      reactions: 0,
      // total elemental reactions detonated
      reactionCounts: {},
      // reaction NAME -> times fired
      fusions: 0,
      // fusion towers forged this run
      goldEarned: 0,
      // all battle-gold income (kills + clears + bonuses)
      elitesSlain: 0,
      // ROGUELIKE: affixed elite enemies destroyed
      relicsTaken: []
      // ROGUELIKE: relic/curse titles drafted, in order
    };
    // spells
    this.spellCd = { meteor: 0, freeze: 0, goldrush: 0 };
    this.spellMaxCd = { meteor: 0, freeze: 0, goldrush: 0 };
    this.spawnQueue = [];
    this.nextId = 1;
    this.accumulator = 0;
    this.events = [];
    this.config = config;
    this.seed = config.seed >>> 0;
    this.rng = new RNG(this.seed);
    this.rogue = !!(config.endless && config.rogue);
    this.rogueRng = new RNG((this.seed ^ 14531089) >>> 0);
    if (this.rogue && config.rogue) {
      this.fx = resolveRogueEffects(config.rogue.mutators ?? []);
      this.rogueBoost = config.rogue.boostTags ?? [];
    }
    this.gold = Math.max(0, Math.floor(config.startGold));
    this.startLives = Math.max(1, Math.floor(config.startLives));
    this.lives = this.startLives;
    for (const k2 of SPELL_ORDER) {
      this.spellMaxCd[k2] = Math.max(0.5, SPELLS[k2].cooldown * config.mods.spellCooldownMult);
    }
    const seenHeroes = /* @__PURE__ */ new Set();
    for (const p of config.party ?? []) {
      if (this.partyDefs.length >= 3) break;
      if (!p || seenHeroes.has(p.heroId) || !heroById(p.heroId)) continue;
      seenHeroes.add(p.heroId);
      const wyrm = p.wyrm && resolveBond(p.heroId, p.wyrm.wyrmId, p.wyrm.level) ? { wyrmId: p.wyrm.wyrmId, level: Math.max(1, Math.floor(p.wyrm.level || 1)) } : void 0;
      this.partyDefs.push({ heroId: p.heroId, level: Math.max(1, Math.floor(p.level || 1)), wyrm });
    }
    this.planIntrusions();
    this.buildGrid();
    this.enterPrep();
  }
  // Decide, deterministically, where Morose intrudes on this run. Balanced:
  // never the tutorial, never more than two grey moments, the steal always
  // leaves the player a real choice (2 cards).
  planIntrusions() {
    if (this.config.endless) return;
    const idx = this.config.level.index;
    if (idx < INTRUSION_MIN_LEVEL) return;
    const waves = this.config.level.waves.length;
    if (waves < 3) return;
    const irng = new RNG((this.seed ^ 1374535902) >>> 0);
    const mid = Math.min(waves - 1, 1 + Math.floor(waves / 2) + irng.int(-1, 0));
    this.greyWaves.set(mid, irng.range(4, 9));
    if (idx >= 3) this.greyWaves.set(waves - 1, irng.range(5, 10));
    if (idx >= 2) this.stealDraftOrdinal = irng.int(0, 1);
  }
  // ---- events -------------------------------------------------------------
  emit(e3) {
    if (this.events.length < 4e3) this.events.push(e3);
  }
  drainEvents() {
    if (this.events.length === 0) return EMPTY_EVENTS;
    const out = this.events;
    this.events = [];
    return out;
  }
  // A hero's signature just fired — emit the presentational marker (view flourish
  // + hero-quest attribution). Pure cosmetics: no damage, no RNG, no state change.
  sigFx(h) {
    this.emit({ t: "heroSig", kind: h.def.signature.kind, heroId: h.heroId, slotId: h.id, x: h.x, y: h.y, color: h.def.color });
  }
  // ---- path / grid --------------------------------------------------------
  buildGrid() {
    const plan = pathPlanFor(this.config.level);
    this.grid = [];
    this.terrain = [];
    this.occupied = [];
    this.occupiedHero = [];
    for (let r = 0; r < ROWS; r++) {
      const gr = [];
      const trow = [];
      const orow = [];
      const hrow = [];
      for (let c = 0; c < COLS; c++) {
        gr.push("blocked");
        trow.push("");
        orow.push(null);
        hrow.push(null);
      }
      this.grid.push(gr);
      this.terrain.push(trow);
      this.occupied.push(orow);
      this.occupiedHero.push(hrow);
    }
    for (const tc of this.config.level.terrain ?? []) {
      if (tc.row >= 0 && tc.row < ROWS && tc.col >= 0 && tc.col < COLS) this.terrain[tc.row][tc.col] = tc.kind;
    }
    const onPath = /* @__PURE__ */ new Set();
    for (const route of plan) {
      for (const [c, r] of route) {
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
          this.grid[r][c] = "path";
          onPath.add(`${c},${r}`);
        }
      }
    }
    const openBuild = !!this.config.level.openBuild;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c] === "path") continue;
        let near = openBuild;
        for (let dr = -1; dr <= 1 && !near; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (onPath.has(`${c + dc},${r + dr}`)) {
              near = true;
              break;
            }
          }
        }
        this.grid[r][c] = near ? "build" : "blocked";
      }
    }
    this.routes = [];
    this.pathLength = 0;
    for (const route of plan) {
      const wps = [];
      const first = route[0];
      wps.push(cellCenter(first[0] - 1.2, first[1]));
      for (const [c, r] of route) wps.push(cellCenter(c, r));
      const segs = [];
      let length = 0;
      for (let i = 0; i < wps.length - 1; i++) {
        const a = wps[i];
        const b = wps[i + 1];
        const len = distance(a.x, a.y, b.x, b.y);
        segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, len });
        length += len;
      }
      this.routes.push({ waypoints: wps, segments: segs, length });
      this.pathLength = Math.max(this.pathLength, length);
    }
  }
  positionAt(dist, pathId = 0) {
    const route = this.routes[pathId] ?? this.routes[0];
    const wp = route.waypoints;
    const last = wp[wp.length - 1];
    if (dist >= route.length) return { x: last.x, y: last.y, done: true };
    let d = Math.max(0, dist);
    for (const s of route.segments) {
      if (d <= s.len) {
        const t = s.len === 0 ? 0 : d / s.len;
        return { x: s.ax + (s.bx - s.ax) * t, y: s.ay + (s.by - s.ay) * t, done: false };
      }
      d -= s.len;
    }
    return { x: last.x, y: last.y, done: true };
  }
  // Progress fraction toward the base ∈ [0, ~1] — the ROUTE-COMMENSURATE proxy for
  // "how far along" an enemy is. Raw `dist` isn't comparable across routes of
  // different lengths, so all cross-enemy leader/First/Last scoring uses this. For a
  // single-route level it's a monotonic scaling of dist ⇒ identical selection.
  progressOf(e3) {
    const route = this.routes[e3.pathId] ?? this.routes[0];
    return route && route.length > 0 ? e3.dist / route.length : e3.dist;
  }
  waypointFor(which) {
    const r0 = this.routes[0];
    return which === "portal" ? r0.waypoints[1] : r0.waypoints[r0.waypoints.length - 1];
  }
  // Every route's spawn portal (waypoint[1]) — the view draws one portal each.
  portals() {
    return this.routes.map((r) => r.waypoints[1]);
  }
  // Route 0's waypoint chain (primary), for single-route consumers/back-compat.
  pathWaypoints() {
    return this.routes[0].waypoints;
  }
  // Every route's full waypoint chain, for the view to draw all roads/dashes.
  routeWaypoints() {
    return this.routes.map((r) => r.waypoints);
  }
  buildCells() {
    const out = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (this.grid[r][c] === "build") out.push({ col: c, row: r });
    return out;
  }
  canPlace(col, row) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return false;
    if (terrainNoBuild(this.terrain[row]?.[col] ?? "")) return false;
    return this.grid[row][col] === "build" && this.occupied[row][col] === null && this.occupiedHero[row][col] === null;
  }
  terrainAt(col, row) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return "";
    return this.terrain[row]?.[col] ?? "";
  }
  // Count of active towers on the field (for the tower-cap challenge).
  activeTowerCount() {
    let n = 0;
    for (const t of this.towers) if (t.active) n++;
    return n;
  }
  towerAt(col, row) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
    return this.occupied[row][col];
  }
  heroAt(col, row) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
    return this.occupiedHero[row][col];
  }
  // ---- fixed-timestep driver ---------------------------------------------
  // View passes already-scaled dt (realDt * gameSpeed, or 0 when paused). We
  // accumulate and step in fixed increments so behaviour is frame-rate independent.
  // beforeStep (optional) runs before EVERY fixed step — scripted input (the
  // attract/demo reel) injects commands there so they land on exact tick
  // boundaries and replay identically at any frame rate or game speed.
  advance(dt, beforeStep) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.accumulator += Math.min(dt, 0.25);
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      beforeStep?.();
      this.step();
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;
  }
  // One deterministic tick.
  step() {
    if (this.state === "won" || this.state === "lost" || this.state === "draft") return;
    const dt = FIXED_DT;
    this.clock += dt;
    if (this.state === "prep") {
      this.prepTimer -= dt;
      if (this.prepTimer <= 0) this.startWave();
    }
    this.updateCombo(dt);
    this.updateIntrusion();
    this.updateEnemies(dt);
    this.updateZones(dt);
    this.updateTowers(dt);
    this.updateHeroes(dt);
    this.updateProjectiles(dt);
    this.updateSpellCooldowns(dt);
  }
  // ---- Morose intrusion driver (telegraph → grey the proudest tower) -------
  updateIntrusion() {
    if (this.greyPendingAt < 0 || this.state !== "active") return;
    if (!this.greyWarned) {
      if (this.clock >= this.greyPendingAt - INTRUSION_WARN) {
        this.greyWarned = true;
        this.emit({ t: "morose", kind: "warn", towerId: -1, x: 360, y: 400, duration: INTRUSION_WARN });
      }
      return;
    }
    if (this.clock < this.greyPendingAt) return;
    this.greyPendingAt = -1;
    this.greyWarned = false;
    let best = null;
    let bestDps = -1;
    for (const t of this.towers) {
      if (!t.active || t.greyUntil > this.clock) continue;
      const dps = this.effDps(t);
      if (dps > bestDps) {
        bestDps = dps;
        best = t;
      }
    }
    if (!best) return;
    best.greyUntil = this.clock + INTRUSION_GREY_DUR;
    this.emit({ t: "morose", kind: "greyTower", towerId: best.id, x: best.x, y: best.y, duration: INTRUSION_GREY_DUR });
  }
  /** view helper: is this tower currently greyed by a Morose intrusion? */
  towerGreyed(t) {
    return t.greyUntil > this.clock;
  }
  // How much of the level's colour the player has painted back (0 = fully Greyed,
  // 1 = restored). Monotonic across a run: waves cleared + kills within the wave.
  // ROGUELIKE slow-strength knob (the "glacial silence" mutator muffles frost, or a
  // mutator could sharpen it). Identity when !rogue. Clamped so slowFactor stays in
  // (0,1] — the simcheck range invariant — for every caller.
  slowTarget(factor) {
    if (!this.rogue || this.fx.slowPower === 1) return factor;
    return clamp(1 - (1 - factor) * this.fx.slowPower, 0.05, 1);
  }
  colorProgress() {
    if (this.state === "won") return 1;
    if (this.config.endless) return clamp(this.waveIndex / 12, 0, 1);
    const total = Math.max(1, this.config.level.waves.length);
    const frac = this.state === "active" ? clamp(this.waveKills / this.waveSpawnTotal, 0, 1) : 0;
    return clamp((this.waveIndex + frac) / total, 0, 1);
  }
  // ---- combo engine -------------------------------------------------------
  updateCombo(dt) {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboTimer = 0;
        this.comboCount = 0;
        this.comboMult = 1;
      }
    }
  }
  bumpCombo(x, y) {
    this.comboCount = Math.min(this.comboCount + 1, 9999);
    if (this.comboCount > this.runStats.maxCombo) this.runStats.maxCombo = this.comboCount;
    this.comboTimer = COMBO_WINDOW;
    const stepAmt = COMBO_STEP * this.upgrades.comboRamp;
    this.comboMult = clamp(1 + this.comboCount * stepAmt, 1, COMBO_MAX);
    if (this.comboCount >= 2) {
      this.emit({ t: "combo", count: this.comboCount, mult: this.comboMult, x, y, milestone: this.comboCount % 5 === 0 });
    }
    return this.comboMult;
  }
  // ---- waves --------------------------------------------------------------
  enterPrep() {
    this.state = "prep";
    this.prepTimer = this.waveIndex === 0 ? 6 : 7;
  }
  currentWave() {
    if (this.rogue) return rogueWave(this.waveIndex + 1);
    if (this.config.endless) return this.endlessWave(this.waveIndex + 1);
    const t = this.config.level.waves;
    return t[Math.min(this.waveIndex, t.length - 1)];
  }
  totalWaves() {
    return this.config.endless ? Infinity : this.config.level.waves.length;
  }
  endlessWave(n) {
    const hp = 1 + n * 0.22 + n * n * 6e-3;
    const entries = [];
    entries.push({ kind: "runner", count: 6 + Math.floor(n * 0.9), spacing: 0.3, hpMul: hp });
    entries.push({ kind: "grunt", count: 4 + Math.floor(n * 0.65), spacing: 0.5, hpMul: hp });
    if (n >= 3) entries.push({ kind: "flyer", count: 3 + Math.floor(n * 0.45), spacing: 0.6, hpMul: hp });
    if (n >= 4) entries.push({ kind: "shielded", count: 2 + Math.floor(n * 0.32), spacing: 0.7, hpMul: hp });
    if (n >= 5 && n % 2 === 0) entries.push({ kind: "healer", count: 1 + Math.floor(n * 0.16), spacing: 1.1, hpMul: hp });
    if (n >= 4) entries.push({ kind: "swarm", count: 10 + n * 2, spacing: 0.12, hpMul: hp });
    if (n >= 6) entries.push({ kind: "brute", count: 1 + Math.floor(n * 0.28), spacing: 1, hpMul: hp });
    if (n % 5 === 0) entries.push({ kind: "boss", count: Math.floor(n / 5), spacing: 2, hpMul: hp * 1.25 });
    return { entries, clearBonus: 30 + n * 6 };
  }
  // Player (or sim auto-timer) starts the current wave. Returns early-bonus gold.
  startWave() {
    if (this.state !== "prep") return 0;
    const bonus = Math.max(0, Math.ceil(this.prepTimer)) * 2;
    if (bonus > 0) {
      this.addGold(bonus);
      this.emit({ t: "gold", x: 360, y: 250, amount: bonus });
      this.emit({ t: "text", x: 360, y: 250, msg: `+${bonus} EARLY`, color: 16766282, size: 24 });
    }
    this.state = "active";
    for (const h of this.heroes) if (h.active) {
      h.sigGuardUsed = false;
      h.wyrmUltUsed = false;
    }
    this.buildSpawnQueue();
    const greyAt = this.greyWaves.get(this.waveIndex);
    if (greyAt !== void 0) {
      this.greyWaves.delete(this.waveIndex);
      this.greyPendingAt = this.clock + greyAt;
      this.greyWarned = false;
    }
    return bonus;
  }
  buildSpawnQueue() {
    this.spawnQueue = [];
    const wave = this.currentWave();
    const routeCount = Math.max(1, this.routes.length);
    let t = this.clock + 0.4;
    let rr = 0;
    for (const entry of wave.entries) {
      for (let i = 0; i < entry.count; i++) {
        const solo = entry.kind === "keeper" || (ENEMIES[entry.kind]?.boss ?? false);
        const pathId = solo ? 0 : rr++ % routeCount;
        this.spawnQueue.push({ kind: entry.kind, hpMul: entry.hpMul, at: t, keeperId: entry.keeperId, echo: entry.echo, pathId });
        t += Math.max(0.02, entry.spacing);
      }
      t += 0.5;
    }
    this.waveKills = 0;
    this.waveSpawnTotal = Math.max(1, this.spawnQueue.length);
  }
  waveCleared() {
    const bonus = this.currentWave().clearBonus;
    this.addGold(bonus);
    this.emit({ t: "banner", msg: `WAVE CLEAR  +${bonus}`, color: 3143619 });
    this.emit({ t: "gold", x: 360, y: 250, amount: bonus });
    for (const h of this.heroes) {
      if (!h.active || !h.sigAwake || h.def.signature.kind !== "deeproots") continue;
      const sig = h.def.signature;
      const prev = h.sigRamp;
      h.sigRamp = Math.min(sig.rampMax ?? 0.18, h.sigRamp + (sig.ramp ?? 0.03));
      if (h.sigRamp > prev) {
        this.recomputeBuffs();
        this.emit({ t: "text", x: h.x, y: h.y - 40, msg: `\u{1F333} ROOTS DEEPEN +${Math.round(h.sigRamp * 100)}%`, color: h.def.color, size: 15 });
        this.sigFx(h);
      }
    }
    if (!this.config.endless && this.waveIndex >= this.config.level.waves.length - 1) {
      this.state = "won";
      return;
    }
    this.waveIndex++;
    if (this.waveIndex % DRAFT_EVERY === 0) this.enterDraft();
    else this.enterPrep();
  }
  // ---- drafts -------------------------------------------------------------
  enterDraft() {
    this.state = "draft";
    if (this.rogue) {
      const count = this.waveIndex >= 15 ? 4 : 3;
      this.draftOffer = rollRogueDraft(this.rogueRng, this.rogueTakenIds, this.waveIndex, this.rogueBoost, count);
      this.emit({ t: "banner", msg: "CHOOSE A RELIC", color: 12610559 });
      return;
    }
    this.draftOffer = this.rng.sample(DRAFT_POOL, 3);
    if (!this.config.endless && this.draftsTaken === this.stealDraftOrdinal && this.draftOffer.length === 3) {
      this.stealDraftOrdinal = -2;
      this.draftOffer = this.draftOffer.slice(0, 2);
      this.emit({ t: "morose", kind: "stealDraft", towerId: -1, x: 360, y: 400, duration: 0 });
    }
    this.emit({ t: "banner", msg: "CHOOSE A POWER", color: 12610559 });
  }
  // View calls this with the chosen offer index (0..2).
  chooseDraft(index) {
    if (this.state !== "draft") return false;
    const card = this.draftOffer[index];
    if (!card) return false;
    card.apply(this.upgrades);
    if (this.rogue) {
      this.runStats.relicsTaken.push(card.title);
      this.rogueTakenIds.add(card.id);
    }
    if (card.livesDelta) {
      this.lives = clamp(this.lives + card.livesDelta, 0, 9999);
      if (this.lives <= 0) {
        this.state = "lost";
        return true;
      }
    }
    this.draftsTaken++;
    this.draftOffer = [];
    this.emit({ t: "text", x: 360, y: 640, msg: card.title.toUpperCase() + "!", color: card.color, size: 40 });
    this.enterPrep();
    return true;
  }
  // ---- enemies ------------------------------------------------------------
  spawnEnemy(kind, hpMul, keeperId, echo, pathId = 0) {
    const keeper = kind === "keeper" && keeperId ? KEEPER_BY_ID[keeperId] : void 0;
    const def = keeper ? keeper.enemy : ENEMIES[kind];
    if (echo) hpMul *= ECHO_HP_MULT;
    const affix = this.rogue ? rollEliteAffixes(this.rogueRng, kind, this.waveIndex + 1, this.fx.eliteChance) : null;
    if (this.rogue) {
      hpMul *= this.fx.enemyHp * this.upgrades.curseEnemyHp;
      if (def.boss) hpMul *= this.fx.bossHp;
      if (affix) hpMul *= affix.hp;
    }
    const maxHp = Math.max(1, Math.round(def.hp * Math.max(0.1, hpMul)));
    let shieldMax = def.shield ? Math.max(0, Math.round(def.shield * Math.max(0.1, hpMul))) : 0;
    if (affix && affix.shieldFrac > 0) shieldMax += Math.round(maxHp * affix.shieldFrac);
    const routeId = pathId >= 0 && pathId < this.routes.length ? pathId : 0;
    const start = this.positionAt(0, routeId);
    const e3 = this.freeEnemy();
    e3.active = true;
    e3.def = def;
    e3.kind = kind;
    e3.maxHp = maxHp;
    e3.hp = maxHp;
    e3.shield = shieldMax;
    e3.shieldMax = shieldMax;
    e3.dist = 0;
    e3.pathId = routeId;
    e3.x = start.x;
    e3.y = start.y;
    e3.slowUntil = 0;
    e3.slowFactor = 1;
    e3.stunUntil = 0;
    e3.burnUntil = 0;
    e3.burnDps = 0;
    e3.burnTick = 0;
    e3.poisonUntil = 0;
    e3.poisonDps = 0;
    e3.tearUntil = 0;
    e3.tearAmount = 0;
    e3.healTick = 0;
    e3.auraElem = "";
    e3.auraUntil = 0;
    e3.reactLockUntil = 0;
    e3.amplifyUntil = 0;
    e3.keeperId = keeper ? keeper.id : "";
    e3.keeperEcho = !!echo;
    e3.phase = 1;
    e3.castAt = 0;
    e3.castWarned = false;
    e3.speedMult = this.rogue ? this.fx.enemySpeed : 1;
    e3.elite = false;
    e3.affix = "";
    e3.affixColor = 0;
    e3.dmgTakenMult = 1;
    e3.bounty = 1;
    e3.regen = 0;
    if (affix && affix.ids.length > 0) {
      e3.elite = true;
      e3.affix = affix.name;
      e3.affixColor = affix.color;
      e3.dmgTakenMult = affix.dr;
      e3.bounty = affix.bounty;
      e3.regen = affix.regen;
      e3.speedMult *= affix.speed;
    }
    e3.leakDmg = leakDamageFor(def, e3.elite);
    e3.hitFlash = 0;
    if (keeper) {
      e3.castAt = this.clock + Math.max(KEEPER_MIN_CAST_GAP, keeper.castEvery * KEEPER_FIRST_CAST * (echo ? ECHO_CAST_MULT : 1));
      this.emitKeeper("reveal", e3, keeper, 0);
    }
  }
  freeEnemy() {
    for (const e4 of this.enemies) if (!e4.active) {
      e4.id = this.nextId++;
      return e4;
    }
    const e3 = {
      id: 0,
      active: false,
      def: ENEMIES.runner,
      kind: "runner",
      maxHp: 1,
      hp: 1,
      shield: 0,
      shieldMax: 0,
      dist: 0,
      pathId: 0,
      x: 0,
      y: 0,
      slowUntil: 0,
      slowFactor: 1,
      stunUntil: 0,
      burnUntil: 0,
      burnDps: 0,
      burnTick: 0,
      poisonUntil: 0,
      poisonDps: 0,
      tearUntil: 0,
      tearAmount: 0,
      healTick: 0,
      auraElem: "",
      auraUntil: 0,
      reactLockUntil: 0,
      amplifyUntil: 0,
      keeperId: "",
      keeperEcho: false,
      phase: 1,
      castAt: 0,
      castWarned: false,
      speedMult: 1,
      elite: false,
      affix: "",
      affixColor: 0,
      dmgTakenMult: 1,
      bounty: 1,
      regen: 0,
      leakDmg: 1,
      hitFlash: 0
    };
    this.enemies.push(e3);
    e3.id = this.nextId++;
    return e3;
  }
  updateEnemies(dt) {
    if (this.state === "active") {
      while (this.spawnQueue.length && this.spawnQueue[0].at <= this.clock) {
        const item = this.spawnQueue.shift();
        this.spawnEnemy(item.kind, item.hpMul, item.keeperId, item.echo, item.pathId);
      }
    }
    let liveCount = 0;
    for (const e3 of this.enemies) {
      if (!e3.active) continue;
      if (e3.hitFlash > 0) e3.hitFlash = Math.max(0, e3.hitFlash - dt);
      if (e3.burnUntil > this.clock && e3.burnDps > 0) {
        e3.burnTick += dt;
        this.applyRaw(e3, e3.burnDps * dt, false);
        if (e3.burnTick >= 0.4 && e3.active) {
          this.emit({ t: "damage", x: e3.x + 12, y: e3.y - e3.def.radius, amount: e3.burnDps * 0.4, eff: "neutral", combo: 0 });
          e3.burnTick = 0;
        }
        if (!e3.active) continue;
      }
      if (e3.poisonUntil > this.clock && e3.poisonDps > 0) {
        this.applyRaw(e3, e3.poisonDps * dt, false);
        if (!e3.active) continue;
      }
      if (e3.regen > 0 && e3.hp > 0 && e3.hp < e3.maxHp) {
        e3.hp = Math.min(e3.maxHp, e3.hp + e3.regen * e3.maxHp * dt);
      }
      if (e3.def.healInterval && e3.def.healRadius && e3.def.healAmount) {
        e3.healTick += dt;
        if (e3.healTick >= e3.def.healInterval) {
          e3.healTick = 0;
          this.doHeal(e3);
        }
      }
      if (e3.keeperId !== "") this.updateKeeper(e3);
      const stunned = e3.stunUntil > this.clock;
      const slowed = e3.slowUntil > this.clock;
      if (!slowed) e3.slowFactor = 1;
      let speed = e3.def.speed * TILE * e3.speedMult;
      if (stunned) speed = 0;
      else if (slowed) speed *= clamp(e3.slowFactor, 0.05, 1);
      const routeLen = (this.routes[e3.pathId] ?? this.routes[0]).length;
      e3.dist = clamp(e3.dist + speed * dt, 0, routeLen + 1);
      const pos = this.positionAt(e3.dist, e3.pathId);
      e3.x = pos.x;
      e3.y = pos.y;
      if (pos.done) {
        this.enemyReachedBase(e3);
        continue;
      }
      liveCount++;
    }
    if (this.state === "active" && this.spawnQueue.length === 0 && liveCount === 0) {
      this.waveCleared();
    }
  }
  doHeal(healer) {
    const radius = (healer.def.healRadius ?? 2) * TILE;
    const amount = Math.max(0, healer.def.healAmount ?? 10);
    const r2 = radius * radius;
    let any = false;
    for (const a of this.enemies) {
      if (!a.active || a === healer || a.hp >= a.maxHp) continue;
      if (dist2(healer.x, healer.y, a.x, a.y) > r2) continue;
      a.hp = clamp(a.hp + amount, 0, a.maxHp);
      this.emit({ t: "heal", x: a.x, y: a.y - a.def.radius - 8, amount, radius: 0 });
      any = true;
    }
    if (any) this.emit({ t: "heal", x: healer.x, y: healer.y, amount: 0, radius });
  }
  // ======================================================================
  //  CORRUPTED KEEPERS — boss driver. Fully deterministic: no RNG anywhere.
  //  Phases flip on HP thresholds, casts land on a fixed clock after a visible
  //  telegraph, and every target choice is a pure "strongest/nearest" scan.
  // ======================================================================
  emitKeeper(kind, e3, k2, radius) {
    this.emit({
      t: "keeper",
      kind,
      keeperId: k2.id,
      name: e3.keeperEcho ? `ECHO OF ${k2.trueName.split(",")[0].toUpperCase()}` : k2.name,
      ability: k2.ability,
      abilityName: k2.abilityName,
      x: e3.x,
      y: e3.y,
      radius,
      color: k2.enemy.color,
      accent: k2.enemy.accent,
      phase: e3.phase,
      echo: e3.keeperEcho
    });
  }
  updateKeeper(e3) {
    const k2 = KEEPER_BY_ID[e3.keeperId];
    if (!k2) return;
    if (!e3.keeperEcho) {
      const p = keeperPhaseFor(e3.hp / Math.max(1, e3.maxHp));
      if (p > e3.phase) {
        e3.phase = Math.min(p, KEEPER_PHASES);
        if (e3.phase >= 3) e3.speedMult = PHASE3_SPEED;
        e3.castAt = Math.min(e3.castAt, this.clock + k2.telegraph + 0.6);
        this.emitKeeper("phase", e3, k2, 0);
      }
    }
    if (!e3.castWarned && this.clock >= e3.castAt - k2.telegraph) {
      e3.castWarned = true;
      this.emitKeeper("telegraph", e3, k2, this.keeperCastRadius(k2));
    }
    if (this.clock >= e3.castAt) {
      e3.castWarned = false;
      const mult = e3.keeperEcho ? ECHO_CAST_MULT : PHASE_CAST_MULT[e3.phase - 1];
      e3.castAt = this.clock + Math.max(KEEPER_MIN_CAST_GAP, k2.castEvery * mult);
      this.keeperCast(e3, k2);
    }
  }
  keeperCastRadius(k2) {
    if (k2.ability === "ashenSnuff") return k2.power * TILE;
    if (k2.ability === "thornCocoon") return 3.2 * TILE;
    if (k2.ability === "becalm") return 2.8 * TILE;
    return 0;
  }
  keeperCast(e3, k2) {
    switch (k2.ability) {
      case "ashenSnuff": {
        const r2 = (k2.power * TILE) ** 2;
        let snuffed = 0;
        for (const o of this.enemies) {
          if (!o.active) continue;
          if (dist2(e3.x, e3.y, o.x, o.y) > r2) continue;
          if (o.burnUntil > this.clock || o.poisonUntil > this.clock || o.auraElem !== "" || o.amplifyUntil > this.clock) snuffed++;
          o.burnUntil = 0;
          o.burnDps = 0;
          o.poisonUntil = 0;
          o.poisonDps = 0;
          o.auraElem = "";
          o.auraUntil = 0;
          o.amplifyUntil = 0;
        }
        if (snuffed > 0) this.emit({ t: "text", x: e3.x, y: e3.y - e3.def.radius - 30, msg: `\u{1F32B} ${snuffed} FLAME${snuffed > 1 ? "S" : ""} SNUFFED`, color: 12103888, size: 16 });
        break;
      }
      case "stillGrace":
      case "gildedHalo": {
        const count = Math.max(1, Math.round(k2.power));
        for (let i = 0; i < count; i++) {
          let best = null;
          let bestDps = -1;
          for (const t of this.towers) {
            if (!t.active || t.greyUntil > this.clock) continue;
            const dps = this.effDps(t);
            if (dps > bestDps) {
              bestDps = dps;
              best = t;
            }
          }
          if (!best) break;
          best.greyUntil = this.clock + k2.greySeconds;
          this.emit({ t: "aoe", x: best.x, y: best.y, radius: TILE * 0.9, color: k2.enemy.accent, alpha: 0.55 });
          this.emit({ t: "text", x: best.x, y: best.y - 34, msg: k2.ability === "stillGrace" ? "\u2744 STILLED" : "\u{1F607} PACIFIED", color: k2.enemy.accent, size: 16 });
        }
        break;
      }
      case "becalm": {
        const hopR2 = (2.8 * TILE) ** 2;
        const chain = [];
        const used = /* @__PURE__ */ new Set([e3.id]);
        let cx = e3.x;
        let cy = e3.y;
        while (chain.length < 4) {
          let best = null;
          let bd = Infinity;
          for (const o of this.enemies) {
            if (!o.active || o.hp <= 0 || used.has(o.id) || o.keeperId !== "") continue;
            const d2 = dist2(cx, cy, o.x, o.y);
            if (d2 <= hopR2 && d2 < bd) {
              bd = d2;
              best = o;
            }
          }
          if (!best) break;
          chain.push(best);
          used.add(best.id);
          cx = best.x;
          cy = best.y;
        }
        if (chain.length) {
          const points = [[e3.x, e3.y]];
          for (const o of chain) {
            const heal = Math.max(0, o.maxHp * k2.power);
            o.hp = clamp(o.hp + heal, 0, o.maxHp);
            points.push([o.x, o.y]);
            this.emit({ t: "heal", x: o.x, y: o.y - o.def.radius - 8, amount: Math.round(heal), radius: 0 });
          }
          this.emit({ t: "chain", points, color: 10130616, count: chain.length, supercharged: false });
        }
        break;
      }
      case "thornCocoon": {
        const r2 = (3.2 * TILE) ** 2;
        let wrapped = 0;
        for (const o of this.enemies) {
          if (!o.active || o === e3 || o.keeperId !== "") continue;
          if (dist2(e3.x, e3.y, o.x, o.y) > r2) continue;
          const cap = o.maxHp * KEEPER_COCOON_CAP;
          const next = Math.min(cap, o.shield + o.maxHp * k2.power);
          if (next > o.shield) {
            o.shield = next;
            o.shieldMax = Math.max(o.shieldMax, o.shield);
            wrapped++;
          }
        }
        if (wrapped > 0) this.emit({ t: "text", x: e3.x, y: e3.y - e3.def.radius - 30, msg: `\u{1F33F} ${wrapped} COCOONED`, color: k2.enemy.accent, size: 16 });
        break;
      }
      case "mothMirror": {
        let mark = null;
        for (const h of this.heroes) {
          if (!h.active || h.greyUntil > this.clock) continue;
          if (!mark || h.id < mark.id) mark = h;
        }
        if (mark) {
          mark.greyUntil = this.clock + k2.greySeconds;
          this.emit({ t: "aoe", x: mark.x, y: mark.y, radius: TILE * 1, color: k2.enemy.accent, alpha: 0.6 });
          this.emit({ t: "text", x: mark.x, y: mark.y - 40, msg: `\u{1F98B} ${mark.def.name.toUpperCase()} IS BORROWED`, color: k2.enemy.accent, size: 17 });
        } else {
          let best = null;
          let bestDps = -1;
          for (const t of this.towers) {
            if (!t.active || t.greyUntil > this.clock) continue;
            const dps = this.effDps(t);
            if (dps > bestDps) {
              bestDps = dps;
              best = t;
            }
          }
          if (best) {
            best.greyUntil = this.clock + k2.greySeconds;
            this.emit({ t: "text", x: best.x, y: best.y - 34, msg: "\u{1F98B} BORROWED", color: k2.enemy.accent, size: 16 });
          }
        }
        break;
      }
    }
    this.emitKeeper("cast", e3, k2, this.keeperCastRadius(k2));
  }
  /** view helper: is this hero currently borrowed by the Moth Mirror? */
  heroGreyed(h) {
    return h.greyUntil > this.clock;
  }
  // Boss-bar snapshot for the HUD: the live Keeper (full fights outrank echoes,
  // then the biggest). Null when no Keeper walks the field.
  bossStatus() {
    let best = null;
    for (const e3 of this.enemies) {
      if (!e3.active || e3.keeperId === "") continue;
      if (!best) {
        best = e3;
        continue;
      }
      if (best.keeperEcho !== e3.keeperEcho) {
        if (best.keeperEcho) best = e3;
        continue;
      }
      if (e3.maxHp > best.maxHp) best = e3;
    }
    if (!best) return null;
    const k2 = KEEPER_BY_ID[best.keeperId];
    if (!k2) return null;
    return {
      keeperId: k2.id,
      name: best.keeperEcho ? `ECHO OF ${k2.trueName.split(",")[0].toUpperCase()}` : k2.name,
      ability: k2.ability,
      abilityName: k2.abilityName,
      twist: k2.twist,
      hp: best.hp,
      maxHp: best.maxHp,
      shield: best.shield,
      shieldMax: best.shieldMax,
      phase: best.phase,
      phases: KEEPER_PHASES,
      color: k2.enemy.color,
      accent: k2.enemy.accent,
      echo: best.keeperEcho,
      castIn: Math.max(0, best.castAt - this.clock),
      castEvery: Math.max(KEEPER_MIN_CAST_GAP, k2.castEvery * (best.keeperEcho ? ECHO_CAST_MULT : PHASE_CAST_MULT[best.phase - 1])),
      telegraphing: best.castWarned,
      leakDmg: best.leakDmg
    };
  }
  enemyReachedBase(e3) {
    for (const h of this.heroes) {
      if (!h.active || !h.sigAwake || h.def.signature.kind !== "intercession" || h.sigGuardUsed) continue;
      if (h.greyUntil > this.clock) continue;
      h.sigGuardUsed = true;
      const nuke = clamp(h.baseDamage * (h.def.signature.nukeMult ?? 8), 0, 1e7);
      this.emit({ t: "heroFire", x: h.x, y: h.y - 6, tx: e3.x, ty: e3.y, color: h.def.color });
      this.emit({ t: "aoe", x: e3.x, y: e3.y, radius: TILE * 1.1, color: h.def.color, alpha: 0.7 });
      this.emit({ t: "text", x: e3.x, y: e3.y - e3.def.radius - 26, msg: "\u{1F6E1} THE DAWN HOLDS!", color: h.def.color, size: 18 });
      this.sigFx(h);
      this.applyDirect(e3, nuke);
      if (!e3.active) return;
      break;
    }
    e3.active = false;
    const base = this.waypointFor("base");
    const dmg = e3.leakDmg;
    this.loseLife(dmg);
    this.emit({ t: "leak", x: base.x, y: base.y, kind: e3.def.kind, boss: !!e3.def.boss, dmg });
  }
  // ---- towers -------------------------------------------------------------
  placeTower(kind, col, row) {
    if (!this.canPlace(col, row)) return null;
    if (this.config.towerCap !== void 0 && this.activeTowerCount() >= this.config.towerCap) return null;
    const cost = this.placeCost(kind);
    if (this.gold < cost) return null;
    this.spendGold(cost);
    const def = TOWERS[kind];
    const cc = cellCenter(col, row);
    let t = null;
    for (const cand of this.towers) if (!cand.active) {
      t = cand;
      t.id = this.nextId++;
      break;
    }
    if (!t) {
      t = {
        id: this.nextId++,
        active: false,
        def,
        kind,
        level: 0,
        branch: -1,
        col,
        row,
        x: cc.x,
        y: cc.y,
        cd: 0,
        buffDmg: 1,
        buffRng: 1,
        aimAngle: 0,
        targeting: def.defaultTargeting,
        fireFlash: 0,
        greyUntil: 0,
        fusedElem: "",
        fusionKey: "",
        fusionName: "",
        fusedColor: 0,
        auraFlip: false
      };
      this.towers.push(t);
    }
    t.active = true;
    t.def = def;
    t.kind = kind;
    t.level = 0;
    t.branch = -1;
    t.col = col;
    t.row = row;
    t.x = cc.x;
    t.y = cc.y;
    t.cd = 0;
    t.buffDmg = 1;
    t.buffRng = 1;
    t.aimAngle = 0;
    t.targeting = def.defaultTargeting;
    t.fireFlash = 0;
    t.greyUntil = 0;
    t.fusedElem = "";
    t.fusionKey = "";
    t.fusionName = "";
    t.fusedColor = 0;
    t.auraFlip = false;
    this.occupied[row][col] = t;
    this.recomputeBuffs();
    this.recomputeResonances();
    this.emit({ t: "place", x: cc.x, y: cc.y, color: def.color, radius: this.effRange(t) });
    return t;
  }
  placeCost(kind) {
    return Math.max(1, Math.round(TOWERS[kind].cost * this.config.mods.towerCostMult * this.upgrades.towerCostMult));
  }
  upgradeCostFor(t) {
    if (t.level >= 2) return null;
    const next = t.def.levels[t.level + 1];
    return Math.max(1, Math.round(next.upgradeCost * this.config.mods.towerCostMult * this.upgrades.towerCostMult));
  }
  branchCostFor(t, idx) {
    if (t.level !== 2) return null;
    const br = t.def.branches[idx];
    if (!br) return null;
    return Math.max(1, Math.round(br.upgradeCost * this.config.mods.towerCostMult * this.upgrades.towerCostMult));
  }
  upgradeTower(id) {
    const t = this.towerById(id);
    if (!t || t.level >= 2) return false;
    const cost = this.upgradeCostFor(t);
    if (cost === null || this.gold < cost) return false;
    this.spendGold(cost);
    t.level++;
    this.recomputeBuffs();
    this.emit({ t: "upgrade", x: t.x, y: t.y, color: t.def.color, radius: this.effRange(t), label: `LV ${t.level + 1}!` });
    return true;
  }
  chooseBranch(id, idx) {
    const t = this.towerById(id);
    if (!t || t.level !== 2 || idx !== 0 && idx !== 1) return false;
    const cost = this.branchCostFor(t, idx);
    if (cost === null || this.gold < cost) return false;
    this.spendGold(cost);
    t.level = 3;
    t.branch = idx;
    this.recomputeBuffs();
    this.emit({ t: "upgrade", x: t.x, y: t.y, color: t.def.color, radius: this.effRange(t), label: `${t.def.branches[idx].name.toUpperCase()}!` });
    return true;
  }
  setTargeting(id, mode) {
    const t = this.towerById(id);
    if (t) t.targeting = mode;
  }
  // ---- FUSION TOWERS -------------------------------------------------------
  // A host can fuse with an ADJACENT max-tier tower whose aura forms a reaction
  // pair with its own (Arcane is the wildcard). Both must be unfused and awake.
  fusionCost() {
    return Math.max(1, Math.round(FUSION_COST * this.config.mods.towerCostMult * this.upgrades.towerCostMult));
  }
  fusionOptions(t) {
    const out = [];
    const ownAura = TOWER_AURA[t.kind];
    if (!t.active || !ownAura || !this.isMax(t) || t.fusedElem !== "") return out;
    for (const p of this.towers) {
      if (!p.active || p === t || p.fusedElem !== "") continue;
      if (!adjacentCell(t, p)) continue;
      if (!this.isMax(p)) continue;
      const pAura = TOWER_AURA[p.kind];
      if (!pAura) continue;
      const def = reactionFor(ownAura, pAura);
      if (!def) continue;
      out.push({ partner: p, key: def.key, name: FUSION_NAMES[def.key], cost: this.fusionCost(), color: def.color, color2: def.color2 });
    }
    return out;
  }
  // Fuse host + partner: partner's tile is freed, host becomes the fusion tower.
  fuseTowers(hostId, partnerId) {
    const t = this.towerById(hostId);
    if (!t) return false;
    const opt = this.fusionOptions(t).find((o) => o.partner.id === partnerId);
    if (!opt) return false;
    const cost = this.fusionCost();
    if (this.gold < cost) return false;
    this.spendGold(cost);
    const p = opt.partner;
    const pAura = TOWER_AURA[p.kind];
    p.active = false;
    this.occupied[p.row][p.col] = null;
    t.fusedElem = pAura;
    t.fusionKey = opt.key;
    t.fusionName = opt.name;
    t.fusedColor = AURA_COLOR[pAura];
    t.auraFlip = false;
    this.runStats.fusions++;
    this.recomputeBuffs();
    this.recomputeResonances();
    this.emit({ t: "fuse", towerId: t.id, name: opt.name, x: t.x, y: t.y, px: p.x, py: p.y, color: opt.color, color2: opt.color2 });
    this.emit({ t: "banner", msg: `\u269B ${opt.name.toUpperCase()} FORGED!`, color: opt.color });
    this.emit({ t: "upgrade", x: t.x, y: t.y, color: opt.color, radius: this.effRange(t), label: `\u269B ${opt.name.toUpperCase()}` });
    return true;
  }
  // The reaction a fused tower detonates (for the UI); null when unfused.
  fusionReaction(t) {
    return t.fusionKey !== "" ? REACTIONS[t.fusionKey] : null;
  }
  towerById(id) {
    for (const t of this.towers) if (t.active && t.id === id) return t;
    return null;
  }
  stats(t) {
    if (t.level >= 3 && t.branch >= 0) return t.def.branches[t.branch];
    return t.def.levels[Math.min(t.level, 2)];
  }
  isMax(t) {
    return t.level >= 3;
  }
  effRange(t) {
    const fus = t.fusedElem !== "" ? FUSION_RNG : 1;
    const terr = terrainRngMul(this.terrain[t.row]?.[t.col] ?? "");
    return clamp(this.stats(t).range * TILE * t.buffRng * fus * this.config.mods.rangeMult * terr, TILE * 0.5, TILE * 12);
  }
  effCooldown(t) {
    return clamp(this.stats(t).cooldown * this.config.mods.cooldownMult * this.upgrades.fireRateMult, 0.05, 10);
  }
  effDamage(t) {
    const s = this.stats(t);
    const elem = t.def.element ? this.upgrades.elementDmg[t.def.element] : 1;
    const res = this.resTowerMult.get(t.kind) ?? 1;
    const fus = t.fusedElem !== "" ? FUSION_DMG : 1;
    const terr = terrainDmgMul(this.terrain[t.row]?.[t.col] ?? "", t.def.element);
    const dmg = s.damage * t.buffDmg * this.config.mods.towerDamageMult * this.upgrades.allDmg * elem * res * fus * terr;
    return clamp(dmg, 0, 1e7);
  }
  // DPS shown in the UI (splash/chain not counted, single-target baseline).
  effDps(t) {
    return clamp(this.effDamage(t) / Math.max(0.05, this.effCooldown(t)), 0, 1e7);
  }
  // The aura this tower's NEXT volley paints. Fused towers alternate between
  // their own element and the absorbed one (auraFlip toggles per volley).
  towerAura(t) {
    const own = TOWER_AURA[t.kind];
    if (t.fusedElem === "" || !own) return own;
    return t.auraFlip ? t.fusedElem : own;
  }
  towerAttack(t, damageOverride) {
    const s = this.stats(t);
    const dmgType = s.damageType ?? t.def.damageType;
    const armorPen = (s.armorPen ?? t.def.armorPen ?? 0) + this.upgrades.armorPenBonus;
    return {
      damage: damageOverride ?? this.effDamage(t),
      dmgType,
      element: t.def.element,
      armorPen,
      aura: this.towerAura(t)
    };
  }
  recomputeBuffs() {
    for (const t of this.towers) {
      if (!t.active) continue;
      t.buffDmg = 1;
      t.buffRng = 1;
    }
    for (const h of this.heroes) {
      if (!h.active) continue;
      h.adjBuff = 1;
    }
    for (const a of this.towers) {
      if (!a.active || !a.def.support) continue;
      const s = this.stats(a);
      const bd = s.buffDamage ?? 0;
      const br = s.buffRange ?? 0;
      const reach = Math.max(1, Math.round(s.buffReach ?? 1));
      for (const n of this.towers) {
        if (!n.active || n === a) continue;
        if (adjacentCell(a, n, reach)) {
          n.buffDmg += bd;
          n.buffRng += br;
        }
      }
      for (const n of this.heroes) {
        if (!n.active) continue;
        if (adjacentCell(a, n, reach)) n.adjBuff += bd;
      }
    }
    for (const a of this.heroes) {
      if (!a.active) continue;
      const aura = a.buffDamage + a.sigRamp;
      if (aura <= 0) continue;
      for (const n of this.towers) {
        if (!n.active) continue;
        if (adjacentCell(a, n)) n.buffDmg += aura;
      }
      for (const n of this.heroes) {
        if (!n.active || n === a) continue;
        if (adjacentCell(a, n)) n.adjBuff += aura;
      }
    }
    const WYRM_AURA_R2 = 3 * TILE * (3 * TILE);
    for (const a of this.heroes) {
      if (!a.active || !a.wyrm || a.wyrm.towerBuff <= 0) continue;
      const elem = a.wyrm.wyrm.element;
      for (const n of this.towers) {
        if (!n.active || n.def.element !== elem) continue;
        if (dist2(a.x, a.y, n.x, n.y) <= WYRM_AURA_R2) n.buffDmg += a.wyrm.towerBuff;
      }
    }
  }
  // Support-buff adjacency, for the view to draw glow links.
  buffLinks() {
    const out = [];
    for (const a of this.towers) {
      if (!a.active || !a.def.support) continue;
      const reach = Math.max(1, Math.round(this.stats(a).buffReach ?? 1));
      for (const n of this.towers) {
        if (!n.active || n === a) continue;
        if (adjacentCell(a, n, reach)) {
          out.push({ ax: a.x, ay: a.y, bx: n.x, by: n.y, color: a.def.color });
        }
      }
    }
    for (const a of this.heroes) {
      if (!a.active || a.buffDamage <= 0) continue;
      for (const n of this.towers) {
        if (!n.active) continue;
        if (adjacentCell(a, n)) out.push({ ax: a.x, ay: a.y, bx: n.x, by: n.y, color: a.def.color });
      }
      for (const n of this.heroes) {
        if (!n.active || n === a) continue;
        if (adjacentCell(a, n)) out.push({ ax: a.x, ay: a.y, bx: n.x, by: n.y, color: a.def.color });
      }
    }
    return out;
  }
  // Glow links between deployed heroes that share an active synergy (for the view).
  synergyLinks() {
    const out = [];
    const active = this.deployedHeroes();
    if (active.length < 2) return out;
    for (const b of this.synergyBonuses) {
      const members = active.filter((h) => b.members.includes(h.def.element));
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          out.push({ ax: members[i].x, ay: members[i].y, bx: members[j].x, by: members[j].y, color: b.color });
        }
      }
    }
    return out;
  }
  updateTowers(dt) {
    for (const t of this.towers) {
      if (!t.active) continue;
      if (t.fireFlash > 0) t.fireFlash = Math.max(0, t.fireFlash - dt);
      if (t.greyUntil > this.clock) continue;
      const range = this.effRange(t);
      t.cd -= dt;
      if (t.kind === "frost") {
        const r2 = range * range;
        const s = this.stats(t);
        const slowF = this.slowTarget(clamp((s.slowFactor ?? 0.5) - this.upgrades.frostSlowBonus, 0.1, 1));
        for (const e3 of this.enemies) {
          if (!this.canTarget(t, e3)) continue;
          if (dist2(t.x, t.y, e3.x, e3.y) <= r2) {
            e3.slowUntil = this.clock + (s.slowDuration ?? 1);
            e3.slowFactor = Math.min(e3.slowFactor, slowF);
            if (s.stunDuration) e3.stunUntil = Math.max(e3.stunUntil, this.clock + s.stunDuration);
          }
        }
      }
      if (t.cd > 0) continue;
      const target = this.acquire(t, range);
      if (!target) continue;
      t.cd = this.effCooldown(t);
      t.aimAngle = angleBetween(t.x, t.y, target.x, target.y);
      t.fireFlash = 0.12;
      if (t.kind === "cannon") this.fireProjectile(t, target);
      else if (t.kind === "frost") this.frostZap(t, range);
      else if (t.kind === "flame") {
        if (this.stats(t).seeking) this.fireProjectile(t, target);
        else this.flameBurst(t, target);
      } else if (t.kind === "storm") this.stormBolt(t, target);
      else this.arcaneZap(t, target);
      if (t.fusedElem !== "") t.auraFlip = !t.auraFlip;
    }
  }
  canTarget(t, e3) {
    if (!e3.active || e3.hp <= 0) return false;
    if (e3.def.isAir && !t.def.antiAir) return false;
    return true;
  }
  acquire(t, range) {
    const r2 = range * range;
    let best = null;
    let bestScore = -Infinity;
    for (const e3 of this.enemies) {
      if (!this.canTarget(t, e3)) continue;
      const d2 = dist2(t.x, t.y, e3.x, e3.y);
      if (d2 > r2) continue;
      const prog = this.progressOf(e3);
      let score;
      switch (t.targeting) {
        case "First":
          score = prog;
          break;
        case "Last":
          score = -prog;
          break;
        case "Close":
          score = -d2;
          break;
        case "Strong":
          score = e3.hp;
          break;
        case "Weak":
          score = -e3.hp;
          break;
        case "Primed":
          score = (this.wouldDetonate(t, e3) ? 1e7 : 0) + prog;
          break;
        default:
          score = prog;
      }
      if (score > bestScore) {
        bestScore = score;
        best = e3;
      }
    }
    return best;
  }
  // Primed targeting: would this tower's next hit detonate a reaction on e?
  // Elementless towers (cannon) instead hunt AMPLIFY-marked enemies (they take
  // bonus damage) — every tower gets something real out of the mode.
  wouldDetonate(t, e3) {
    const aura = this.towerAura(t);
    if (!aura) return e3.amplifyUntil > this.clock;
    if (this.clock < e3.reactLockUntil) return false;
    if (e3.auraElem === "" || e3.auraUntil <= this.clock || e3.auraElem === aura) return false;
    return reactionFor(e3.auraElem, aura) !== null;
  }
  fireProjectile(t, target) {
    const s = this.stats(t);
    const splash = (s.splash ?? 0) * TILE * (1 + this.upgrades.splashBonus);
    let p = null;
    for (const cand of this.projectiles) if (!cand.active) {
      p = cand;
      p.id = this.nextId++;
      break;
    }
    if (!p) {
      p = {
        id: this.nextId++,
        active: false,
        x: 0,
        y: 0,
        tx: 0,
        ty: 0,
        targetId: -1,
        speed: PROJECTILE_SPEED,
        splash: 0,
        atk: { damage: 0, dmgType: "Physical", armorPen: 0 },
        synergy: false,
        sourceKind: "cannon",
        color: 16777215,
        burnDps: 0,
        burnDur: 0
      };
      this.projectiles.push(p);
    }
    p.active = true;
    p.x = t.x;
    p.y = t.y - 6;
    p.tx = target.x;
    p.ty = target.y;
    p.targetId = target.id;
    p.speed = PROJECTILE_SPEED;
    p.splash = splash;
    p.atk = this.towerAttack(t);
    p.synergy = t.def.synergyDamage;
    p.sourceKind = t.kind;
    p.color = t.def.color;
    p.burnDps = (s.burnDps ?? 0) * this.upgrades.burnDmgMult;
    p.burnDur = s.burnDuration ?? 0;
    this.emit({ t: "towerFire", x: t.x, y: t.y, tx: target.x, ty: target.y, color: t.def.color, kind: t.kind });
  }
  frostZap(t, range) {
    this.emit({ t: "aoe", x: t.x, y: t.y, radius: range, color: t.def.color, alpha: 0.5 });
    const r2 = range * range;
    const atk = this.towerAttack(t);
    for (const e3 of this.enemies) {
      if (!this.canTarget(t, e3)) continue;
      if (dist2(t.x, t.y, e3.x, e3.y) <= r2) this.dealDamage(e3, atk, t);
    }
  }
  flameBurst(t, target) {
    const s = this.stats(t);
    const splash = (s.splash ?? 1) * TILE * (1 + this.upgrades.splashBonus);
    this.emit({ t: "aoe", x: target.x, y: target.y, radius: splash, color: 16747068, alpha: 0.6 });
    const r2 = splash * splash;
    const atk = this.towerAttack(t);
    const burnDps = (s.burnDps ?? 8) * this.upgrades.burnDmgMult;
    const burnDur = s.burnDuration ?? 2;
    for (const e3 of this.enemies) {
      if (!this.canTarget(t, e3)) continue;
      if (dist2(target.x, target.y, e3.x, e3.y) > r2) continue;
      this.dealDamage(e3, atk, t);
      if (e3.active) {
        e3.burnUntil = this.clock + burnDur;
        e3.burnDps = Math.max(e3.burnDps, burnDps);
      }
    }
    const zoneDps = s.zoneDps ?? 0;
    if (zoneDps > 0) {
      this.spawnZone(target.x, target.y, (s.zoneRadius ?? 1.2) * TILE, zoneDps * this.upgrades.burnDmgMult, s.zoneDuration ?? 3, 16742960);
    }
  }
  // ---- burning ground (Scorch) ---------------------------------------------
  // Zones near an existing one MERGE into it (refresh + grow) so a fast-firing
  // Scorch tower reads as one persistent burning patch, not confetti.
  spawnZone(x, y, radius, dps, duration, color) {
    const mergeR2 = TILE * 0.6 * (TILE * 0.6);
    for (const z2 of this.zones) {
      if (!z2.active) continue;
      if (dist2(z2.x, z2.y, x, y) <= mergeR2) {
        z2.until = Math.max(z2.until, this.clock + duration);
        z2.dps = Math.max(z2.dps, dps);
        z2.radius = Math.max(z2.radius, radius);
        return;
      }
    }
    let z = null;
    for (const cand of this.zones) if (!cand.active) {
      z = cand;
      break;
    }
    if (!z && this.zones.length >= MAX_ZONES) {
      z = this.zones[0];
      for (const cand of this.zones) if (cand.until < z.until) z = cand;
    }
    if (!z) {
      z = { id: 0, active: false, x: 0, y: 0, radius: 1, dps: 0, until: 0, color };
      this.zones.push(z);
    }
    z.id = this.nextId++;
    z.active = true;
    z.x = x;
    z.y = y;
    z.radius = Math.max(8, radius);
    z.dps = Math.max(0, dps);
    z.until = this.clock + Math.max(0.1, duration);
    z.color = color;
    this.emit({ t: "aoe", x, y, radius: z.radius, color, alpha: 0.5 });
  }
  updateZones(dt) {
    for (const z of this.zones) {
      if (!z.active) continue;
      if (this.clock >= z.until) {
        z.active = false;
        continue;
      }
      const r2 = z.radius * z.radius;
      for (const e3 of this.enemies) {
        if (!e3.active || e3.def.isAir) continue;
        if (dist2(z.x, z.y, e3.x, e3.y) > r2) continue;
        e3.burnUntil = Math.max(e3.burnUntil, this.clock + 0.2);
        this.applyRaw(e3, z.dps * dt, false);
      }
    }
  }
  // Storm: bounce a bolt across nearby enemies. Build the FULL chain first, then
  // apply damage — never touch an enemy a kill may pool-free mid-loop.
  stormBolt(t, first) {
    const s = this.stats(t);
    let chainCount = (s.chainCount ?? 0) + this.upgrades.stormChainBonus;
    const chainRange = (s.chainRange ?? 2) * TILE;
    const falloff = clamp(s.chainFalloff ?? 0.85, 0.1, 1);
    const supercharged = first.slowUntil > this.clock && chainCount > 0;
    if (supercharged) {
      chainCount += 2;
      this.emit({ t: "text", x: first.x, y: first.y - first.def.radius - 34, msg: "SUPERCHARGED!", color: 16769354, size: 24 });
    }
    const chain = [first];
    const used = /* @__PURE__ */ new Set([first.id]);
    let cursor = first;
    const r2 = chainRange * chainRange;
    while (chain.length <= chainCount) {
      let bestNode = null;
      let bestD = Infinity;
      for (const e3 of this.enemies) {
        if (!e3.active || e3.hp <= 0 || used.has(e3.id)) continue;
        if (e3.def.isAir && !t.def.antiAir) continue;
        const d2 = dist2(cursor.x, cursor.y, e3.x, e3.y);
        if (d2 <= r2 && d2 < bestD) {
          bestD = d2;
          bestNode = e3;
        }
      }
      if (!bestNode) break;
      chain.push(bestNode);
      used.add(bestNode.id);
      cursor = bestNode;
    }
    const points = [[t.x, t.y]];
    for (const e3 of chain) points.push([e3.x, e3.y]);
    this.emit({ t: "chain", points, color: t.def.color, count: chain.length, supercharged });
    let dmg = this.effDamage(t);
    for (const e3 of chain) {
      if (!e3.active) continue;
      this.dealDamage(e3, this.towerAttack(t, dmg), t);
      dmg *= falloff;
    }
  }
  arcaneZap(t, target) {
    this.emit({ t: "towerFire", x: t.x, y: t.y, tx: target.x, ty: target.y, color: t.def.color, kind: t.kind });
    this.emit({ t: "hit", x: target.x, y: target.y, color: t.def.color });
    this.dealDamage(target, this.towerAttack(t), t);
  }
  // ---- projectiles --------------------------------------------------------
  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (!p.active) continue;
      const target = p.targetId >= 0 ? this.enemyById(p.targetId) : null;
      if (target && target.active) {
        p.tx = target.x;
        p.ty = target.y;
      }
      const step = p.speed * dt;
      const d = distance(p.x, p.y, p.tx, p.ty);
      if (d <= step + 6) {
        this.emit({ t: "hit", x: p.tx, y: p.ty, color: p.color });
        if (p.splash > 0) {
          this.emit({ t: "aoe", x: p.tx, y: p.ty, radius: p.splash, color: p.color, alpha: 0.6 });
          const r2 = p.splash * p.splash;
          for (const e3 of this.enemies) {
            if (!e3.active || e3.hp <= 0) continue;
            if (e3.def.isAir && !TOWERS[p.sourceKind].antiAir) continue;
            if (dist2(p.tx, p.ty, e3.x, e3.y) <= r2) this.dealDamageProjectile(e3, p);
          }
        } else if (target && target.active) {
          this.dealDamageProjectile(target, p);
        }
        p.active = false;
      } else {
        const ang = Math.atan2(p.ty - p.y, p.tx - p.x);
        p.x += Math.cos(ang) * step;
        p.y += Math.sin(ang) * step;
      }
    }
  }
  enemyById(id) {
    for (const e3 of this.enemies) if (e3.active && e3.id === id) return e3;
    return null;
  }
  dealDamageProjectile(e3, p) {
    this.dealDamageWith(e3, p.atk, p.synergy, p.x, p.y);
    if (p.burnDps > 0 && e3.active) {
      e3.burnUntil = this.clock + Math.max(0.1, p.burnDur);
      e3.burnDps = Math.max(e3.burnDps, p.burnDps);
    }
  }
  // ---- damage pipeline (grid × wheel × combo × shield) --------------------
  dealDamage(e3, atk, source) {
    this.dealDamageWith(e3, atk, source.def.synergyDamage, e3.x, e3.y);
  }
  dealDamageWith(e3, atk, synergyTower, _sx, _sy) {
    if (!e3.active || e3.hp <= 0) return;
    const def = e3.def;
    const effArmorPen = atk.armorPen;
    const tear = e3.tearUntil > this.clock ? e3.tearAmount : 0;
    const defStats = { armor: def.armor, flatArmor: Math.max(0, def.flatArmor - tear), affinity: def.affinity };
    const mult = typeMultiplier(atk, defStats);
    let dmg = computeHit(atk, defStats);
    const afflicted = e3.slowUntil > this.clock || e3.burnUntil > this.clock || e3.stunUntil > this.clock || e3.poisonUntil > this.clock;
    let comboN = 0;
    if (synergyTower && afflicted) {
      const m = this.bumpCombo(e3.x, e3.y - e3.def.radius - 10);
      dmg *= m;
      comboN = this.comboCount;
    }
    if (this.rogue) {
      dmg *= this.fx.playerDmg;
      if (def.boss) dmg *= this.upgrades.bossDmg;
      dmg *= e3.dmgTakenMult;
    }
    if (e3.amplifyUntil > this.clock) dmg *= AMPLIFY_TAKEN + (this.rogue ? this.upgrades.amplifyPower : 0);
    if (e3.shield > 0) {
      const block = def.shieldBlock ?? 0.6;
      const absorbed = Math.min(e3.shield, dmg * block);
      e3.shield = Math.max(0, e3.shield - absorbed);
      dmg = Math.max(0, dmg - absorbed);
      if (e3.shield <= 0) {
        this.emit({ t: "shieldBreak", x: e3.x, y: e3.y - e3.def.radius - 30, radius: e3.def.radius + 10 });
      }
    }
    const eff = classify(mult);
    this.emit({ t: "damage", x: e3.x, y: e3.y - e3.def.radius - 6, amount: dmg, eff, combo: comboN });
    e3.hitFlash = 0.09;
    this.applyRaw(e3, dmg, true);
    if (e3.active && atk.aura) this.applyAura(e3, atk.aura, dmg);
    if (this.rogue && this.fx.burnEveryHit > 0 && e3.active) {
      e3.burnUntil = Math.max(e3.burnUntil, this.clock + 2);
      e3.burnDps = Math.max(e3.burnDps, this.fx.burnEveryHit * this.upgrades.burnDmgMult);
    }
  }
  // ======================================================================
  //  ELEMENTAL REACTIONS — two different elements on one enemy inside the
  //  window detonate a named reaction. Deterministic: no RNG anywhere here.
  // ======================================================================
  applyAura(e3, aura, triggerDmg) {
    if (this.clock < e3.reactLockUntil) return;
    const hasAura = e3.auraElem !== "" && e3.auraUntil > this.clock;
    if (hasAura && e3.auraElem !== aura) {
      const def = reactionFor(e3.auraElem, aura);
      if (def) {
        e3.auraElem = "";
        e3.auraUntil = 0;
        e3.reactLockUntil = this.clock + REACT_LOCK;
        this.triggerReaction(e3, def, clamp(triggerDmg, 0, 1e6));
        return;
      }
    }
    e3.auraElem = aura;
    e3.auraUntil = this.clock + AURA_WINDOW;
  }
  // burst damage from a reaction: ignores armor (it's a detonation, not an attack)
  reactionBurst(e3, amount) {
    if (!e3.active) return;
    const dmg = clamp(amount, 0, 1e7);
    if (dmg <= 0) return;
    this.emit({ t: "damage", x: e3.x, y: e3.y - e3.def.radius - 6, amount: dmg, eff: "strong", combo: 0 });
    e3.hitFlash = 0.09;
    this.applyRaw(e3, dmg, false);
  }
  triggerReaction(e3, def, trigger) {
    this.runStats.reactions++;
    this.runStats.reactionCounts[def.name] = (this.runStats.reactionCounts[def.name] ?? 0) + 1;
    if (this.rogue) {
      trigger *= this.fx.reactionDmg * this.upgrades.reactionDmg;
      if (this.upgrades.goldPerReaction > 0) this.addGold(this.upgrades.goldPerReaction);
    }
    const rMul = this.rogue ? this.fx.reactionRadius * this.upgrades.reactionRadius : 1;
    const cx = e3.x;
    const cy = e3.y;
    let radius = 0;
    if (def.key === "thermal") {
      e3.tearUntil = Math.max(e3.tearUntil, this.clock + 5);
      e3.tearAmount = Math.max(e3.tearAmount, 8);
      this.reactionBurst(e3, trigger * 0.8);
    } else if (def.key === "shatter") {
      const armored = e3.def.flatArmor > 0 || e3.def.armor === "Heavy" || e3.def.armor === "Fortified";
      this.reactionBurst(e3, trigger * 1.3 * (armored ? 2 : 1));
    } else if (def.key === "flashover") {
      radius = TILE * 1.6 * rMul;
      const r2 = radius * radius;
      for (const o of this.enemies) {
        if (!o.active || o.hp <= 0) continue;
        if (dist2(cx, cy, o.x, o.y) > r2) continue;
        this.reactionBurst(o, trigger * 0.9);
      }
    } else if (def.key === "wildfire") {
      radius = TILE * 2 * rMul;
      const r2 = radius * radius;
      const dps = clamp(12 + trigger * 0.35, 0, 400);
      for (const o of this.enemies) {
        if (!o.active || o.hp <= 0) continue;
        if (dist2(cx, cy, o.x, o.y) > r2) continue;
        o.burnUntil = Math.max(o.burnUntil, this.clock + 3);
        o.burnDps = Math.max(o.burnDps, dps);
      }
    } else if (def.key === "overgrow") {
      radius = TILE * 1.8 * rMul;
      const r2 = radius * radius;
      for (const o of this.enemies) {
        if (!o.active || o.hp <= 0) continue;
        if (dist2(cx, cy, o.x, o.y) > r2) continue;
        o.slowUntil = Math.max(o.slowUntil, this.clock + 2.5);
        o.slowFactor = Math.min(o.slowFactor, this.slowTarget(0.3));
      }
    } else if (def.key === "eclipse") {
      radius = TILE * 1.5 * rMul;
      const r2 = radius * radius;
      for (const o of this.enemies) {
        if (!o.active || o.hp <= 0) continue;
        if (dist2(cx, cy, o.x, o.y) > r2) continue;
        o.stunUntil = Math.max(o.stunUntil, this.clock + 0.85);
      }
    } else if (def.key === "conduct") {
      radius = TILE * 2.5 * rMul;
      const r2 = radius * radius;
      const chain = [];
      let cursor = e3;
      const used = /* @__PURE__ */ new Set([e3.id]);
      while (chain.length < 4 + (this.rogue ? this.upgrades.conductJumps : 0)) {
        let best = null;
        let bd = Infinity;
        for (const o of this.enemies) {
          if (!o.active || o.hp <= 0 || used.has(o.id)) continue;
          const d2 = dist2(cursor.x, cursor.y, o.x, o.y);
          if (d2 <= r2 && d2 < bd) {
            bd = d2;
            best = o;
          }
        }
        if (!best) break;
        chain.push(best);
        used.add(best.id);
        cursor = best;
      }
      if (chain.length) {
        const points = [[e3.x, e3.y]];
        for (const o of chain) points.push([o.x, o.y]);
        this.emit({ t: "chain", points, color: def.color, count: chain.length, supercharged: false });
        let dmg = trigger * 0.75;
        for (const o of chain) {
          this.reactionBurst(o, dmg);
          dmg *= 0.85;
        }
      }
    } else if (def.key === "blight") {
      radius = TILE * 1.6 * rMul;
      const r2 = radius * radius;
      const dps = clamp(10 + trigger * 0.3, 0, 300);
      for (const o of this.enemies) {
        if (!o.active || o.hp <= 0) continue;
        if (dist2(cx, cy, o.x, o.y) > r2) continue;
        o.poisonUntil = Math.max(o.poisonUntil, this.clock + 4);
        o.poisonDps = Math.max(o.poisonDps, dps);
      }
    } else {
      e3.amplifyUntil = this.clock + AMPLIFY_DURATION + (this.rogue ? this.upgrades.amplifyDur : 0);
      this.reactionBurst(e3, trigger * 0.4);
    }
    this.emit({ t: "reaction", key: def.key, name: def.name, x: cx, y: cy, radius, color: def.color, color2: def.color2 });
  }
  applyRaw(e3, dmg, _tag) {
    if (!e3.active) return;
    const d = Math.max(0, Number.isFinite(dmg) ? dmg : 0);
    e3.hp = e3.hp - d;
    if (e3.hp <= 0) {
      e3.hp = 0;
      this.killEnemy(e3);
    }
  }
  killEnemy(e3) {
    if (!e3.active) return;
    e3.active = false;
    this.waveKills++;
    this.runStats.kills++;
    if (e3.def.boss) this.runStats.bossKills++;
    let rewardRaw = e3.def.reward * this.config.mods.goldGainMult * this.upgrades.goldGainMult;
    if (this.rogue) {
      rewardRaw *= this.fx.goldMult * e3.bounty;
      if (e3.elite) this.runStats.elitesSlain++;
      if (e3.def.boss && this.upgrades.lifePerBoss > 0) {
        this.lives = clamp(this.lives + this.upgrades.lifePerBoss, 0, 9999);
        this.emit({ t: "text", x: e3.x, y: e3.y - 40, msg: `+${this.upgrades.lifePerBoss} \u2764`, color: 16735098, size: 22 });
      }
    }
    const reward = Math.max(0, Math.round(rewardRaw));
    this.addGold(reward);
    this.emit({ t: "gold", x: e3.x, y: e3.y, amount: reward });
    this.emit({ t: "death", x: e3.x, y: e3.y, kind: e3.kind, color: e3.def.color, boss: !!e3.def.boss, elite: e3.elite });
    if (e3.keeperId !== "") {
      const k2 = KEEPER_BY_ID[e3.keeperId];
      if (k2) this.emitKeeper("redeemed", e3, k2, TILE * 3);
    }
  }
  // ======================================================================
  //  HEROES — deployable characters. Deploy on a build tile (costs gold, once per
  //  party hero), auto-attack through the element wheel, and cast one spell.
  // ======================================================================
  heroDeployCost(heroId) {
    const def = heroById(heroId);
    if (!def) return 0;
    return Math.max(1, Math.round(def.deployCost * this.config.mods.towerCostMult * this.upgrades.towerCostMult));
  }
  canDeployHero(heroId) {
    if (this.state === "won" || this.state === "lost" || this.state === "draft") return false;
    if (this.deployedHeroIds.has(heroId)) return false;
    return this.partyDefs.some((p) => p.heroId === heroId);
  }
  deployHero(heroId, col, row) {
    if (!this.canDeployHero(heroId)) return null;
    if (!this.canPlace(col, row)) return null;
    const pd = this.partyDefs.find((p) => p.heroId === heroId);
    const def = heroById(heroId);
    if (!pd || !def) return null;
    const cost = this.heroDeployCost(heroId);
    if (this.gold < cost) return null;
    this.spendGold(cost);
    const cc = cellCenter(col, row);
    const stats = heroStats(def, pd.level);
    const spell = heroSpellScaled(def.spell, pd.level);
    const bond = pd.wyrm ? resolveBond(heroId, pd.wyrm.wyrmId, pd.wyrm.level) : null;
    let h = null;
    for (const cand of this.heroes) if (!cand.active) {
      h = cand;
      h.id = this.nextId++;
      break;
    }
    if (!h) {
      h = {
        id: this.nextId++,
        active: false,
        heroId,
        def,
        role: def.role,
        level: pd.level,
        col,
        row,
        x: cc.x,
        y: cc.y,
        cd: 0,
        aimAngle: 0,
        fireFlash: 0,
        targeting: "First",
        focusId: 0,
        moveFlash: 0,
        baseDamage: 0,
        baseRange: 0,
        attackCd: 1,
        buffDamage: 0,
        slowFactor: 1,
        slowDuration: 0,
        adjBuff: 1,
        buffMult: 1,
        buffUntil: 0,
        spell,
        spellCd: 0,
        spellMaxCd: 1,
        greyUntil: 0,
        sigAwake: false,
        sigCounter: 0,
        sigRamp: 0,
        sigGuardUsed: false,
        wyrm: null,
        wyrmBreathCd: 0,
        wyrmUltUsed: false
      };
      this.heroes.push(h);
    }
    h.active = true;
    h.heroId = heroId;
    h.def = def;
    h.role = def.role;
    h.level = pd.level;
    h.col = col;
    h.row = row;
    h.x = cc.x;
    h.y = cc.y;
    h.cd = 0;
    h.aimAngle = 0;
    h.fireFlash = 0;
    h.targeting = "First";
    h.focusId = 0;
    h.moveFlash = 0;
    h.baseDamage = stats.damage;
    h.baseRange = stats.range;
    h.attackCd = stats.cooldown;
    h.buffDamage = stats.buffDamage;
    h.slowFactor = stats.slowFactor;
    h.slowDuration = stats.slowDuration;
    h.adjBuff = 1;
    h.buffMult = 1;
    h.buffUntil = 0;
    h.spell = spell;
    h.spellCd = 0;
    h.spellMaxCd = clamp(spell.cooldown * this.config.mods.spellCooldownMult, 0.5, 60);
    h.greyUntil = 0;
    h.sigAwake = signatureAwake(pd.level);
    h.sigCounter = 0;
    h.sigRamp = 0;
    h.sigGuardUsed = false;
    h.wyrm = bond;
    h.wyrmBreathCd = bond ? bond.breathCd * 0.5 : 0;
    h.wyrmUltUsed = false;
    this.occupiedHero[row][col] = h;
    this.deployedHeroIds.add(heroId);
    this.recomputeSynergies();
    this.recomputeBuffs();
    this.recomputeResonances();
    this.emit({ t: "heroDeploy", x: cc.x, y: cc.y, color: def.color, radius: this.heroRange(h) });
    this.emit({ t: "text", x: cc.x, y: cc.y - 44, msg: def.name.toUpperCase() + "!", color: def.color, size: 26 });
    if (h.sigAwake) this.emit({ t: "text", x: cc.x, y: cc.y - 70, msg: `\u2726 ${def.signature.name}`, color: def.color, size: 15 });
    if (bond) {
      this.emit({ t: "text", x: cc.x, y: cc.y - 96, msg: `${bond.wyrm.emoji} ${bond.wyrm.name} \xB7 ${bond.tierLabel}`, color: bond.wyrm.color, size: 15 });
      this.emit({ t: "banner", msg: `${bond.wyrm.emoji} ${bond.wyrm.name.toUpperCase()} TAKES FLIGHT \u2014 ${bond.tier.toUpperCase()} BOND`, color: bond.wyrm.color });
    }
    return h;
  }
  // ---- ELEMENT RESONANCE (hero + 2/4+ same-kind towers) --------------------
  // Deterministic: pure function of live towers + fielded awakened heroes.
  recomputeResonances() {
    const counts = {};
    for (const t of this.towers) if (t.active) counts[t.kind] = (counts[t.kind] ?? 0) + 1;
    const fielded = [];
    for (const h of this.heroes) if (h.active) fielded.push({ heroId: h.heroId, awake: h.sigAwake });
    this.resonances = computeResonances(fielded, counts);
    this.resTowerMult.clear();
    this.resHeroMult.clear();
    for (const r of this.resonances) {
      this.resTowerMult.set(r.towerKind, Math.max(this.resTowerMult.get(r.towerKind) ?? 1, r.towerMult));
      for (const id of r.heroIds) this.resHeroMult.set(id, Math.max(this.resHeroMult.get(id) ?? 1, r.heroMult));
    }
    for (const r of this.resonances) {
      if (this.resSeen.has(r.id)) continue;
      this.resSeen.add(r.id);
      this.emit({ t: "banner", msg: `\u{1F517} ${r.name.toUpperCase()}!`, color: r.color });
      for (const h of this.heroes) {
        if (h.active && r.heroIds.includes(h.heroId)) {
          this.emit({ t: "text", x: h.x, y: h.y - 46, msg: "RESONANCE!", color: r.color, size: 22 });
        }
      }
    }
  }
  activeResonances() {
    return this.resonances;
  }
  // Live element-synergy recompute from the currently-fielded heroes.
  recomputeSynergies() {
    const elements = [];
    for (const h of this.heroes) if (h.active) elements.push(h.def.element);
    const { bonuses, effects } = computeSynergies(elements);
    this.synergyBonuses = bonuses;
    this.synergyEffects = effects;
  }
  activeSynergies() {
    return this.synergyBonuses;
  }
  // effective hero stats (base × adjacency × synergy × temp buff × run mods)
  heroDamage(h) {
    const syn = this.synergyEffects;
    const elem = syn.elementDmg[h.def.element] ?? 1;
    const buff = h.buffUntil > this.clock ? h.buffMult : 1;
    const res = this.resHeroMult.get(h.heroId) ?? 1;
    const wyrmAmp = h.wyrm ? h.wyrm.heroAmp : 1;
    const dmg = h.baseDamage * h.adjBuff * elem * syn.allDmgMult * syn.allStatMult * buff * res * wyrmAmp * this.config.mods.towerDamageMult;
    return clamp(dmg, 0, 1e7);
  }
  heroRange(h) {
    return clamp(h.baseRange * TILE * this.synergyEffects.allStatMult * this.config.mods.rangeMult, TILE * 0.5, TILE * 12);
  }
  // Read-only range PREVIEWS for the placement range ring (WYSIWYG before commit).
  // These mirror effRange/heroRange for a FRESH unit — level-1 tower (buffRng=1,
  // unfused) or a party hero at its progression level — using the exact same
  // clamp bounds so the previewed ring equals the range the moment you place.
  previewTowerRange(kind, col, row) {
    const base = TOWERS[kind].levels[0].range;
    const terr = terrainRngMul(this.terrain[row]?.[col] ?? "");
    return clamp(base * TILE * this.config.mods.rangeMult * terr, TILE * 0.5, TILE * 12);
  }
  previewHeroRange(heroId) {
    const def = heroById(heroId);
    const pd = this.partyDefs.find((p) => p.heroId === heroId);
    if (!def || !pd) return 0;
    const base = heroStats(def, pd.level).range;
    return clamp(base * TILE * this.synergyEffects.allStatMult * this.config.mods.rangeMult, TILE * 0.5, TILE * 12);
  }
  heroCooldown(h) {
    const syn = this.synergyEffects;
    return clamp(h.attackCd * syn.atkSpeedMult / Math.max(0.5, syn.allStatMult), 0.05, 10);
  }
  heroDps(h) {
    return clamp(this.heroDamage(h) / Math.max(0.05, this.heroCooldown(h)), 0, 1e7);
  }
  // loadout view for the HUD (party order, deploy state + cost)
  partyLoadout() {
    const out = [];
    for (const p of this.partyDefs) {
      const def = heroById(p.heroId);
      if (!def) continue;
      const wyrm = p.wyrm ? resolveBond(p.heroId, p.wyrm.wyrmId, p.wyrm.level) : null;
      out.push({ heroId: p.heroId, def, level: p.level, deployed: this.deployedHeroIds.has(p.heroId), cost: this.heroDeployCost(p.heroId), wyrm });
    }
    return out;
  }
  deployedHeroes() {
    const out = [];
    for (const h of this.heroes) if (h.active) out.push(h);
    return out;
  }
  heroBySlot(id) {
    for (const h of this.heroes) if (h.active && h.id === id) return h;
    return null;
  }
  // ---- PLAYER CONTROL: reposition + focus (the skill levers) ---------------
  // RELOCATE a fielded hero to an empty build tile — placement is a LIVE decision,
  // not a one-time plop. Free (encourage active play) but a short attack settle so
  // it isn't a zero-cost teleport-spam. Deterministic; adjacency buffs recompute.
  canMoveHeroTo(slotId, col, row) {
    const h = this.heroBySlot(slotId);
    if (!h) return false;
    if (col === h.col && row === h.row) return false;
    return this.canPlace(col, row);
  }
  moveHero(slotId, col, row) {
    if (this.state === "won" || this.state === "lost" || this.state === "draft") return false;
    const h = this.heroBySlot(slotId);
    if (!h || !this.canMoveHeroTo(slotId, col, row)) return false;
    const fromX = h.x;
    const fromY = h.y;
    this.occupiedHero[h.row][h.col] = null;
    const cc = cellCenter(col, row);
    h.col = col;
    h.row = row;
    h.x = cc.x;
    h.y = cc.y;
    h.cd = Math.max(h.cd, this.heroCooldown(h));
    h.moveFlash = 0.4;
    this.occupiedHero[row][col] = h;
    this.recomputeBuffs();
    this.emit({ t: "heroMove", slotId: h.id, fromX, fromY, x: cc.x, y: cc.y, color: h.def.color, radius: this.heroRange(h) });
    return true;
  }
  // Cycle/set a hero's auto-attack priority (First/Last/Close/Strong/Weak/Primed).
  // 'Strong' makes a DPS hero lock the boss; 'Primed' hunts reaction detonations.
  setHeroTargeting(slotId, mode) {
    const h = this.heroBySlot(slotId);
    if (h) {
      h.targeting = mode;
      h.focusId = 0;
    }
  }
  // Sticky FOCUS: hammer one specific enemy until it dies or leaves range. The
  // scene resolves a tap → the enemy id; passing 0 clears the lock.
  focusHero(slotId, enemyId) {
    const h = this.heroBySlot(slotId);
    if (h) h.focusId = Math.max(0, Math.floor(enemyId));
  }
  // Nearest live enemy to a point within a pick radius — the scene maps a tap on
  // the board to a focus target. Pure read; deterministic.
  enemyNear(x, y, maxTiles = 1.6) {
    const r2 = maxTiles * TILE * (maxTiles * TILE);
    let best = null;
    let bd = r2;
    for (const e3 of this.enemies) {
      if (!e3.active || e3.hp <= 0) continue;
      const d = dist2(x, y, e3.x, e3.y);
      if (d <= bd) {
        bd = d;
        best = e3;
      }
    }
    return best;
  }
  updateHeroes(dt) {
    for (const h of this.heroes) {
      if (!h.active) continue;
      if (h.fireFlash > 0) h.fireFlash = Math.max(0, h.fireFlash - dt);
      if (h.moveFlash > 0) h.moveFlash = Math.max(0, h.moveFlash - dt);
      if (h.spellCd > 0) h.spellCd = Math.max(0, h.spellCd - dt);
      if (h.greyUntil > this.clock) continue;
      if (h.wyrm) this.updateWyrm(h, dt);
      h.cd -= dt;
      if (h.cd > 0) continue;
      const range = this.heroRange(h);
      const target = this.acquireForHero(h, range);
      if (!target) continue;
      h.cd = this.heroCooldown(h);
      h.aimAngle = angleBetween(h.x, h.y, target.x, target.y);
      h.fireFlash = 0.12;
      this.heroAttack(h, target);
    }
  }
  // Heroes CAN hit air (they are mages) and honour the player's targeting mode +
  // sticky focus. Default 'First' with no focus = the classic highest-progress pick,
  // so an un-retargeted hero is byte-identical to the old behaviour.
  acquireForHero(h, range) {
    const r2 = range * range;
    if (h.focusId !== 0) {
      for (const e3 of this.enemies) {
        if (e3.active && e3.hp > 0 && e3.id === h.focusId && dist2(h.x, h.y, e3.x, e3.y) <= r2) return e3;
      }
      h.focusId = 0;
    }
    let best = null;
    let bestScore = -Infinity;
    for (const e3 of this.enemies) {
      if (!e3.active || e3.hp <= 0) continue;
      const d2 = dist2(h.x, h.y, e3.x, e3.y);
      if (d2 > r2) continue;
      const prog = this.progressOf(e3);
      let score;
      switch (h.targeting) {
        case "Last":
          score = -prog;
          break;
        case "Close":
          score = -d2;
          break;
        case "Strong":
          score = e3.hp;
          break;
        case "Weak":
          score = -e3.hp;
          break;
        case "Primed":
          score = (this.heroWouldDetonate(h, e3) ? 1e7 : 0) + prog;
          break;
        default:
          score = prog;
      }
      if (score > bestScore) {
        bestScore = score;
        best = e3;
      }
    }
    return best;
  }
  // Would this hero's next hit detonate a reaction on e? (Primed targeting for heroes.)
  heroWouldDetonate(h, e3) {
    if (this.clock < e3.reactLockUntil) return false;
    const aura = h.def.element;
    if (e3.auraElem === "" || e3.auraUntil <= this.clock || e3.auraElem === aura) return false;
    return reactionFor(e3.auraElem, aura) !== null;
  }
  heroAttack(h, target) {
    this.emit({ t: "heroFire", x: h.x, y: h.y - 6, tx: target.x, ty: target.y, color: h.def.color });
    this.emit({ t: "hit", x: target.x, y: target.y, color: h.def.color });
    const sig = h.def.signature;
    let dmg = this.heroDamage(h);
    const tx = target.x;
    const ty = target.y;
    let foreseen = false;
    let nova = false;
    let wager = false;
    if (h.sigAwake) {
      if (sig.kind === "cindernova" || sig.kind === "foreseen" || sig.kind === "wager") {
        h.sigCounter++;
        if (h.sigCounter >= (sig.every ?? 4)) {
          h.sigCounter = 0;
          if (sig.kind === "cindernova") nova = true;
          else if (sig.kind === "foreseen") foreseen = true;
          else wager = true;
        }
      } else if (sig.kind === "overload") {
        if (target.slowUntil > this.clock || target.stunUntil > this.clock) {
          dmg *= sig.mult ?? 1.5;
          if (target.slowUntil > this.clock) target.slowUntil += sig.slowExtend ?? 0.5;
          this.emit({ t: "text", x: tx, y: ty - target.def.radius - 26, msg: "OVERLOAD!", color: h.def.color, size: 15 });
        }
      }
    }
    if (foreseen) {
      dmg *= sig.mult ?? 2;
      this.emit({ t: "text", x: tx, y: ty - target.def.radius - 28, msg: "\u{1F441} FORESEEN", color: h.def.color, size: 16 });
      this.sigFx(h);
    }
    const atk = { damage: dmg, dmgType: h.def.damageType, element: h.def.element, armorPen: this.upgrades.armorPenBonus, aura: h.def.element };
    this.dealDamageWith(target, atk, true, tx, ty);
    if (foreseen && target.active) {
      target.stunUntil = Math.max(target.stunUntil, this.clock + (sig.stun ?? 0.7));
    }
    if (nova) {
      this.heroNova(h, tx, ty, dmg);
      this.sigFx(h);
    }
    if (wager) {
      this.heroSquall(h, tx, ty, dmg);
      this.sigFx(h);
    }
    if (h.sigAwake && sig.kind === "twinspark" && target.active) {
      const echo = { ...atk, damage: dmg * (sig.echo ?? 0.5) };
      this.emit({ t: "heroFire", x: h.x, y: h.y - 12, tx: target.x, ty: target.y, color: h.def.accent });
      this.dealDamageWith(target, echo, true, tx, ty);
    }
    if (h.sigAwake && sig.kind === "tithe" && !target.active) {
      const bonus = Math.max(1, Math.round(target.def.reward * (sig.goldFrac ?? 0.4) * this.config.mods.goldGainMult * this.upgrades.goldGainMult));
      this.addGold(bonus);
      this.emit({ t: "gold", x: tx, y: ty - 14, amount: bonus });
      h.sigCounter++;
      if (h.sigCounter % 4 === 1) {
        this.emit({ t: "text", x: tx, y: ty - 34, msg: `PILFERED +${bonus}`, color: h.def.color, size: 15 });
        this.sigFx(h);
      }
    }
    if (h.role === "Control" && target.active && h.slowFactor < 1) {
      target.slowUntil = Math.max(target.slowUntil, this.clock + h.slowDuration);
      target.slowFactor = Math.min(target.slowFactor, this.slowTarget(h.slowFactor));
    }
  }
  // Stay Lit: the 4th strike detonates — the target already took the full foreseen
  // hit via dealDamageWith; the nova splashes everything AROUND it (burn included).
  heroNova(h, cx, cy, baseDmg) {
    const sig = h.def.signature;
    const radius = (sig.radius ?? 1.4) * TILE;
    const burst = baseDmg * (sig.mult ?? 1.5);
    const burnDps = clamp(baseDmg * 0.5, 0, 1e6);
    const r2 = radius * radius;
    this.emit({ t: "aoe", x: cx, y: cy, radius, color: h.def.color, alpha: 0.6 });
    this.emit({ t: "text", x: cx, y: cy - 30, msg: "\u{1F4A5} CINDERNOVA", color: h.def.color, size: 16 });
    for (const e3 of this.enemies) {
      if (!e3.active || e3.hp <= 0) continue;
      if (dist2(cx, cy, e3.x, e3.y) > r2) continue;
      this.applyDirect(e3, burst);
      if (e3.active) {
        e3.burnUntil = Math.max(e3.burnUntil, this.clock + 2.5);
        e3.burnDps = Math.max(e3.burnDps, burnDps);
      }
    }
  }
  // Wager's On: the 6th strike pays out — a squall arcs from the target through
  // the pack. Builds the FULL chain first (never touch pool-freed enemies mid-loop).
  heroSquall(h, cx, cy, baseDmg) {
    const sig = h.def.signature;
    const maxArcs = sig.chainCount ?? 4;
    const falloff = clamp(sig.chainFalloff ?? 0.85, 0.1, 1);
    const arcRange = 2.6 * TILE;
    const r2 = arcRange * arcRange;
    const chain = [];
    const used = /* @__PURE__ */ new Set();
    let curX = cx;
    let curY = cy;
    while (chain.length < maxArcs) {
      let best = null;
      let bd = Infinity;
      for (const e3 of this.enemies) {
        if (!e3.active || e3.hp <= 0 || used.has(e3.id)) continue;
        const d2 = dist2(curX, curY, e3.x, e3.y);
        if (d2 <= r2 && d2 < bd) {
          bd = d2;
          best = e3;
        }
      }
      if (!best) break;
      chain.push(best);
      used.add(best.id);
      curX = best.x;
      curY = best.y;
    }
    if (chain.length === 0) return;
    const points = [[h.x, h.y]];
    for (const e3 of chain) points.push([e3.x, e3.y]);
    this.emit({ t: "chain", points, color: h.def.color, count: chain.length, supercharged: false });
    this.emit({ t: "text", x: cx, y: cy - 32, msg: "\u{1F3B2} WAGER PAYS!", color: h.def.color, size: 16 });
    let dmg = baseDmg * (sig.mult ?? 0.7);
    for (const e3 of chain) {
      if (!e3.active) continue;
      this.applyDirect(e3, dmg);
      dmg *= falloff;
    }
  }
  // ---- CHROMATIC WYRM companion ------------------------------------------
  // The bonded Wyrm breathes its element in a burst around the hero on a fixed
  // cadence. Deterministic (clock-paced, no RNG). CRITICAL: each hit routes
  // through dealDamageWith so the breath PAINTS the element aura and detonates
  // reactions — fire breath shatters frozen/primed enemies, etc. (req 1a).
  updateWyrm(h, dt) {
    const b = h.wyrm;
    if (!b) return;
    if (h.wyrmBreathCd > 0) {
      h.wyrmBreathCd = Math.max(0, h.wyrmBreathCd - dt);
      return;
    }
    const isUlt = b.ult != null && !h.wyrmUltUsed;
    const radius = (isUlt && b.ult ? b.ult.radiusTiles : b.breathRadiusTiles) * TILE;
    const r2 = radius * radius;
    let any = false;
    for (const e3 of this.enemies) {
      if (e3.active && e3.hp > 0 && dist2(h.x, h.y, e3.x, e3.y) <= r2) {
        any = true;
        break;
      }
    }
    if (!any) {
      h.wyrmBreathCd = 0.25;
      return;
    }
    this.wyrmBreath(h, b, isUlt, radius, r2);
    if (isUlt) h.wyrmUltUsed = true;
    h.wyrmBreathCd = b.breathCd;
  }
  wyrmBreath(h, b, isUlt, radius, r2) {
    const cx = h.x;
    const cy = h.y;
    const element = b.wyrm.element;
    const dmg = clamp(b.breathDamage * (isUlt && b.ult ? b.ult.damageMult : 1) * this.config.mods.towerDamageMult, 0, 1e7);
    const name = isUlt && b.ult ? b.ult.name : b.wyrm.breathName;
    this.emit({ t: "wyrmBreath", wyrmId: b.wyrm.id, element, x: cx, y: cy, radius, color: b.wyrm.color, ult: isUlt, name });
    if (isUlt) this.emit({ t: "banner", msg: `\u2605 ${name.toUpperCase()}!`, color: b.wyrm.color });
    else this.emit({ t: "text", x: cx, y: cy - 30, msg: `${b.wyrm.emoji} ${name}`, color: b.wyrm.color, size: 14 });
    for (const e3 of this.enemies) {
      if (!e3.active || e3.hp <= 0) continue;
      if (dist2(cx, cy, e3.x, e3.y) > r2) continue;
      const atk = { damage: dmg, dmgType: "Magic", element, armorPen: this.upgrades.armorPenBonus, aura: element };
      this.dealDamageWith(e3, atk, true, cx, cy);
      if (e3.active && b.status) this.applyBreathStatus(e3, b, dmg, isUlt);
    }
  }
  // The element "bite" a GOOD/PERFECT breath adds (regular = pure damage+aura).
  applyBreathStatus(e3, b, dmg, isUlt) {
    const dur = isUlt ? 3.5 : 2;
    switch (b.status) {
      case "burn":
        e3.burnUntil = Math.max(e3.burnUntil, this.clock + dur);
        e3.burnDps = Math.max(e3.burnDps, clamp(dmg * 0.4, 0, 1e6));
        break;
      case "slow":
        e3.slowUntil = Math.max(e3.slowUntil, this.clock + dur);
        e3.slowFactor = Math.min(e3.slowFactor, this.slowTarget(isUlt ? 0.4 : 0.55));
        break;
      case "poison":
        e3.poisonUntil = Math.max(e3.poisonUntil, this.clock + dur + 1);
        e3.poisonDps = Math.max(e3.poisonDps, clamp(dmg * 0.3, 0, 1e6));
        break;
      case "stun":
        e3.stunUntil = Math.max(e3.stunUntil, this.clock + (isUlt ? 0.7 : 0.4));
        break;
      case "tear":
        e3.tearUntil = Math.max(e3.tearUntil, this.clock + 4);
        e3.tearAmount = Math.max(e3.tearAmount, isUlt ? 14 : 8);
        break;
    }
  }
  nearestEnemyTo(x, y) {
    let best = null;
    let bd = Infinity;
    for (const e3 of this.enemies) {
      if (!e3.active || e3.hp <= 0) continue;
      const d = dist2(x, y, e3.x, e3.y);
      if (d < bd) {
        bd = d;
        best = e3;
      }
    }
    return best;
  }
  // Cast a deployed hero's signature spell. slotId is the SimHero.id.
  castHeroSpell(slotId, x, y) {
    if (this.state === "won" || this.state === "lost" || this.state === "draft") return false;
    const h = this.heroBySlot(slotId);
    if (!h || h.spellCd > 0) return false;
    if (h.greyUntil > this.clock) return false;
    const sp = h.spell;
    const power = this.config.mods.spellPowerMult;
    const color = h.def.color;
    h.spellCd = h.spellMaxCd;
    const cx = sp.targeted ? x : h.x;
    const cy = sp.targeted ? y : h.y;
    const invest = clamp((this.resHeroMult.get(h.heroId) ?? 1) * (h.wyrm ? h.wyrm.heroAmp : 1), 1, 8);
    const spDmg = (base) => clamp(base * power * invest, 0, 1e7);
    if (sp.effect === "aoeBurn") {
      const radius = (sp.radius ?? 2) * TILE;
      const dmg = spDmg(sp.damage ?? 100);
      const r2 = radius * radius;
      for (const e3 of this.enemies) {
        if (!e3.active || e3.hp <= 0) continue;
        if (dist2(cx, cy, e3.x, e3.y) > r2) continue;
        this.applyDirect(e3, dmg);
        if (e3.active) {
          e3.burnUntil = this.clock + (sp.burnDuration ?? 2);
          e3.burnDps = Math.max(e3.burnDps, spDmg(sp.burnDps ?? 20));
        }
      }
      this.emit({ t: "heroSpell", effect: "aoeBurn", name: sp.name, glyph: sp.glyph, x: cx, y: cy, radius, color, count: 0 });
    } else if (sp.effect === "freeze") {
      const radius = (sp.radius ?? 2) * TILE;
      const r2 = radius * radius;
      const dur = sp.stunDuration ?? 1.5;
      let n = 0;
      for (const e3 of this.enemies) {
        if (!e3.active || e3.hp <= 0) continue;
        if (dist2(cx, cy, e3.x, e3.y) > r2) continue;
        e3.stunUntil = Math.max(e3.stunUntil, this.clock + dur);
        if (sp.slowFactor) {
          e3.slowUntil = Math.max(e3.slowUntil, this.clock + (sp.slowDuration ?? dur));
          e3.slowFactor = Math.min(e3.slowFactor, this.slowTarget(clamp(sp.slowFactor, 0.1, 1)));
        }
        n++;
      }
      this.emit({ t: "heroSpell", effect: "freeze", name: sp.name, glyph: sp.glyph, x: cx, y: cy, radius, color, count: n });
    } else if (sp.effect === "chain") {
      const first = this.nearestEnemyTo(cx, cy);
      if (first) this.castHeroChain(h, first);
      else this.emit({ t: "heroSpell", effect: "chain", name: sp.name, glyph: sp.glyph, x: cx, y: cy, radius: 0, color, count: 0 });
    } else if (sp.effect === "heal") {
      const heal = Math.max(0, Math.round(sp.heal ?? 0));
      if (heal > 0) this.lives = clamp(this.lives + heal, 0, this.startLives);
      const radius = (sp.radius ?? 2) * TILE;
      const r2 = radius * radius;
      for (const e3 of this.enemies) {
        if (!e3.active || e3.hp <= 0) continue;
        if (dist2(cx, cy, e3.x, e3.y) > r2) continue;
        if (sp.slowFactor) {
          e3.slowUntil = Math.max(e3.slowUntil, this.clock + (sp.slowDuration ?? 2));
          e3.slowFactor = Math.min(e3.slowFactor, this.slowTarget(clamp(sp.slowFactor, 0.1, 1)));
        }
      }
      this.emit({ t: "heroSpell", effect: "heal", name: sp.name, glyph: sp.glyph, x: cx, y: cy, radius, color, count: heal });
      if (heal > 0) this.emit({ t: "heal", x: cx, y: cy, amount: heal, radius });
    } else if (sp.effect === "novaBuff") {
      const radius = (sp.radius ?? 2) * TILE;
      const dmg = spDmg(sp.damage ?? 80);
      const r2 = radius * radius;
      for (const e3 of this.enemies) {
        if (!e3.active || e3.hp <= 0) continue;
        if (dist2(cx, cy, e3.x, e3.y) > r2) continue;
        this.applyDirect(e3, dmg);
      }
      const dur = sp.buffDuration ?? 5;
      const mult = sp.buffMult ?? 1.4;
      for (const o of this.heroes) {
        if (!o.active) continue;
        o.buffMult = Math.max(o.buffMult, mult);
        o.buffUntil = this.clock + dur;
      }
      this.emit({ t: "heroSpell", effect: "novaBuff", name: sp.name, glyph: sp.glyph, x: cx, y: cy, radius, color, count: 0 });
    } else {
      const target = this.nearestEnemyTo(cx, cy);
      if (target) {
        let dmg = spDmg(sp.damage ?? 150);
        const thr = sp.executeThreshold ?? 0.3;
        if (target.maxHp > 0 && target.hp / target.maxHp <= thr) dmg = clamp(dmg * (sp.executeMult ?? 2), 0, 1e7);
        this.applyDirect(target, dmg);
        this.emit({ t: "heroSpell", effect: "execute", name: sp.name, glyph: sp.glyph, x: target.x, y: target.y, radius: 0, color, count: 0 });
      } else {
        this.emit({ t: "heroSpell", effect: "execute", name: sp.name, glyph: sp.glyph, x: cx, y: cy, radius: 0, color, count: 0 });
      }
    }
    return true;
  }
  castHeroChain(h, first) {
    const sp = h.spell;
    const chainCount = sp.chainCount ?? 5;
    const chainRange = (sp.chainRange ?? 2.5) * TILE;
    const falloff = clamp(sp.chainFalloff ?? 0.85, 0.1, 1);
    const chain = [first];
    const used = /* @__PURE__ */ new Set([first.id]);
    let cursor = first;
    const r2 = chainRange * chainRange;
    while (chain.length <= chainCount) {
      let bestNode = null;
      let bestD = Infinity;
      for (const e3 of this.enemies) {
        if (!e3.active || e3.hp <= 0 || used.has(e3.id)) continue;
        const d2 = dist2(cursor.x, cursor.y, e3.x, e3.y);
        if (d2 <= r2 && d2 < bestD) {
          bestD = d2;
          bestNode = e3;
        }
      }
      if (!bestNode) break;
      chain.push(bestNode);
      used.add(bestNode.id);
      cursor = bestNode;
    }
    const points = [[h.x, h.y]];
    for (const e3 of chain) points.push([e3.x, e3.y]);
    this.emit({ t: "chain", points, color: h.def.color, count: chain.length, supercharged: false });
    const invest = clamp((this.resHeroMult.get(h.heroId) ?? 1) * (h.wyrm ? h.wyrm.heroAmp : 1), 1, 8);
    let dmg = clamp((sp.damage ?? 90) * this.config.mods.spellPowerMult * invest, 0, 1e7);
    for (const e3 of chain) {
      if (!e3.active) continue;
      this.applyDirect(e3, dmg);
      dmg *= falloff;
    }
    this.emit({ t: "heroSpell", effect: "chain", name: sp.name, glyph: sp.glyph, x: first.x, y: first.y, radius: 0, color: h.def.color, count: chain.length });
  }
  // ---- spells -------------------------------------------------------------
  castSpell(key, x, y) {
    if (this.state === "won" || this.state === "lost") return false;
    if (this.spellCd[key] > 0) return false;
    const def = SPELLS[key];
    const power = this.config.mods.spellPowerMult;
    this.spellCd[key] = this.spellMaxCd[key];
    if (key === "meteor") {
      const radius = (def.radius ?? 2) * TILE;
      const dmg = (def.damage ?? 120) * power;
      const r2 = radius * radius;
      for (const e3 of this.enemies) {
        if (!e3.active || e3.hp <= 0) continue;
        if (dist2(x, y, e3.x, e3.y) > r2) continue;
        this.applyDirect(e3, dmg);
        if (e3.active) {
          e3.burnUntil = this.clock + (def.burnDuration ?? 2);
          e3.burnDps = Math.max(e3.burnDps, (def.burnDps ?? 20) * power);
        }
      }
      this.emit({ t: "spell", key, x, y, radius, color: def.color, count: 0 });
    } else if (key === "freeze") {
      const dur = def.stunDuration ?? 2;
      let froze = 0;
      for (const e3 of this.enemies) {
        if (!e3.active || e3.hp <= 0) continue;
        e3.stunUntil = Math.max(e3.stunUntil, this.clock + dur);
        froze++;
      }
      this.emit({ t: "spell", key, x, y, radius: 0, color: def.color, count: froze });
    } else {
      const amt = Math.max(0, Math.round((def.gold ?? 100) * power));
      this.addGold(amt);
      this.emit({ t: "gold", x, y, amount: amt });
      this.emit({ t: "spell", key, x, y, radius: 0, color: def.color, count: amt });
    }
    return true;
  }
  // direct spell damage: respects shield, ignores combo
  applyDirect(e3, amount) {
    if (!e3.active) return;
    let dmg = Math.max(0, Number.isFinite(amount) ? amount : 0);
    if (e3.shield > 0) {
      const block = e3.def.shieldBlock ?? 0.6;
      const absorbed = Math.min(e3.shield, dmg * block);
      e3.shield = Math.max(0, e3.shield - absorbed);
      dmg = Math.max(0, dmg - absorbed);
    }
    this.emit({ t: "damage", x: e3.x, y: e3.y - e3.def.radius - 6, amount: dmg, eff: "neutral", combo: 0 });
    e3.hitFlash = 0.09;
    this.applyRaw(e3, dmg, true);
  }
  updateSpellCooldowns(dt) {
    for (const k2 of SPELL_ORDER) {
      if (this.spellCd[k2] > 0) this.spellCd[k2] = Math.max(0, this.spellCd[k2] - dt);
    }
  }
  // ---- economy / lives ----------------------------------------------------
  addGold(n) {
    if (n <= 0) return;
    this.gold = clamp(this.gold + Math.round(n), 0, 1e9);
    this.runStats.goldEarned += Math.round(n);
  }
  // The prove-it score shown on share cards. Pure function of run stats so a
  // future replay-verifier recomputes the identical number from the same run.
  score() {
    const wavesCleared = this.state === "won" && !this.config.endless ? this.config.level.waves.length : this.waveIndex;
    const s = this.runStats.kills * 20 + this.runStats.reactions * 45 + this.runStats.maxCombo * 30 + this.runStats.bossKills * 400 + this.runStats.fusions * 300 + wavesCleared * 250 + Math.max(0, this.lives) * 60 + this.runStats.elitesSlain * 25;
    return clamp(Math.round(s), 0, 1e9);
  }
  // Is the UPCOMING wave a BOSS RUSH? (view telegraph / banner; rogue-only.)
  rogueBossRush() {
    return this.rogue && isBossRush(this.waveIndex + 1);
  }
  // End-of-run recap payload (ROGUELIKE): the build you took, your biggest reaction,
  // how deep you got, and the seed to share. Pure function of run stats + config, so
  // it's stable and shareable. Mutator ids are returned raw; the view names them.
  runSummary() {
    let bestName = "";
    let bestN = 0;
    for (const [name, n] of Object.entries(this.runStats.reactionCounts)) {
      if (n > bestN) {
        bestN = n;
        bestName = name;
      }
    }
    return {
      wave: this.waveIndex + 1,
      seed: this.seed,
      score: this.score(),
      kills: this.runStats.kills,
      reactions: this.runStats.reactions,
      elitesSlain: this.runStats.elitesSlain,
      maxCombo: this.runStats.maxCombo,
      relics: this.runStats.relicsTaken.slice(),
      biggestReaction: bestName ? { name: bestName, count: bestN } : null,
      mutators: this.config.rogue?.mutators?.slice() ?? [],
      eventId: this.config.rogue?.eventId ?? null
    };
  }
  spendGold(n) {
    this.gold = clamp(this.gold - Math.round(n), 0, 1e9);
  }
  loseLife(n) {
    this.lives = clamp(this.lives - n, 0, this.startLives);
    if (this.lives <= 0 && this.state !== "lost" && this.state !== "won") {
      this.state = "lost";
    }
  }
  // ---- effectiveness preview (approachability UI) -------------------------
  // Best type-multiplier this tower would get vs the given enemy kind.
  effectivenessVs(t, kind) {
    const def = ENEMIES[kind];
    const atk = this.towerAttack(t);
    const mult = typeMultiplier(atk, { armor: def.armor, flatArmor: def.flatArmor, affinity: def.affinity });
    return { mult, eff: classify(mult) };
  }
  // 1..5 power tier from single-target DPS (coarse, at-a-glance).
  powerTier(t) {
    const dps = this.effDps(t);
    if (dps >= 220) return 5;
    if (dps >= 130) return 4;
    if (dps >= 75) return 3;
    if (dps >= 40) return 2;
    return 1;
  }
  // Dominant incoming armor + affinity for the pre-wave telegraph. When a
  // Corrupted Keeper walks in this wave, the telegraph says WHO by name.
  waveTelegraph() {
    const wave = this.currentWave();
    const counts = /* @__PURE__ */ new Map();
    let element;
    let boss = false;
    let keeperName;
    const leakBy = /* @__PURE__ */ new Map();
    for (const entry of wave.entries) {
      const keeper = entry.kind === "keeper" && entry.keeperId ? KEEPER_BY_ID[entry.keeperId] : void 0;
      const def = keeper ? keeper.enemy : ENEMIES[entry.kind];
      counts.set(def.armor, (counts.get(def.armor) ?? 0) + entry.count);
      if (def.affinity) element = def.affinity;
      if (def.boss) boss = true;
      if (keeper && !keeperName) keeperName = entry.echo ? "ECHOES OF THE FIVE" : keeper.name;
      const name = keeper ? keeper.name : def.name;
      if (!leakBy.has(name)) leakBy.set(name, { name, dmg: leakDamageFor(def) });
    }
    let armor = "Unarmored";
    let max = -1;
    for (const [k2, v] of counts) if (v > max) {
      max = v;
      armor = k2;
    }
    const leaks = [...leakBy.values()].sort((a, b) => b.dmg - a.dmg);
    const worstLeak = leaks.reduce((m, l) => Math.max(m, l.dmg), 0);
    return { armor, element, boss, keeperName, leaks, worstLeak };
  }
  // ---- the Prism Wellspring (the base you defend) --------------------------
  // `lives` IS the Wellspring's HP pool (per-level `startLives`); these read-only
  // views give the HUD/renderer clear base-HP semantics without a parallel field.
  get baseHp() {
    return Math.max(0, this.lives);
  }
  get baseMaxHp() {
    return this.startLives;
  }
  get baseIntegrity() {
    return this.startLives > 0 ? clamp(this.lives / this.startLives, 0, 1) : 0;
  }
  liveEnemyCount() {
    let n = 0;
    for (const e3 of this.enemies) if (e3.active) n++;
    return n;
  }
};
var EMPTY_EVENTS = [];
function adjacentCell(a, b, reach = 1) {
  return Math.abs(a.col - b.col) <= reach && Math.abs(a.row - b.row) <= reach;
}

// src/game/workshop.ts
var NEUTRAL = {
  towerDamageMult: 1,
  startGoldBonus: 0,
  spellPowerMult: 1,
  startLivesBonus: 0,
  rangeMult: 1,
  cooldownMult: 1,
  goldGainMult: 1,
  spellCooldownMult: 1,
  towerCostMult: 1
};

// src/game/seedcode.ts
var WORDS_A = [
  "EMBER",
  "FROST",
  "STORM",
  "IVY",
  "DAWN",
  "DUSK",
  "OPAL",
  "RUBY",
  "JADE",
  "GOLD",
  "AZURE",
  "CORAL",
  "INDIGO",
  "VIOLET",
  "CRIMSON",
  "AMBER",
  "PEARL",
  "ONYX",
  "TOPAZ",
  "COBALT",
  "SCARLET",
  "SAFFRON",
  "LILAC",
  "MOSS",
  "FERN",
  "TIDE",
  "CINDER",
  "ASH",
  "BLAZE",
  "SPARK",
  "THUNDER",
  "ZEPHYR",
  "MIST",
  "RAIN",
  "SNOW",
  "HAIL",
  "RIVER",
  "OCEAN",
  "MEADOW",
  "GROVE",
  "BRIAR",
  "THORN",
  "PETAL",
  "BLOOM",
  "PRISM",
  "GLOW",
  "SHADE",
  "NIGHT",
  "STAR",
  "LUNAR",
  "SOLAR",
  "COMET",
  "NOVA",
  "AURORA",
  "HALO",
  "RUNE",
  "GLYPH",
  "CHROMA",
  "MARBLE",
  "SLATE",
  "COPPER",
  "SILVER",
  "IRON",
  "QUARTZ"
];
var WORDS_B = [
  "FOX",
  "WOLF",
  "RAVEN",
  "OTTER",
  "LYNX",
  "HARE",
  "OWL",
  "CRANE",
  "HERON",
  "FINCH",
  "WREN",
  "ROBIN",
  "FALCON",
  "HAWK",
  "EAGLE",
  "BEAR",
  "ELK",
  "DEER",
  "MOLE",
  "VOLE",
  "TOAD",
  "NEWT",
  "KOI",
  "CARP",
  "PIKE",
  "TROUT",
  "SEAL",
  "ORCA",
  "WHALE",
  "CRAB",
  "MOTH",
  "WASP",
  "BEE",
  "ANT",
  "BEETLE",
  "CICADA",
  "MANTIS",
  "BADGER",
  "STOAT",
  "FERRET",
  "MARTEN",
  "SABLE",
  "MINK",
  "SHREW",
  "BAT",
  "GECKO",
  "VIPER",
  "ADDER",
  "SKINK",
  "CROW",
  "MAGPIE",
  "JAY",
  "DOVE",
  "SWAN",
  "GOOSE",
  "DUCK",
  "PONY",
  "MULE",
  "GOAT",
  "RAM",
  "BOAR",
  "HOUND",
  "TABBY",
  "MOUSE"
];
var SEED_SPACE = WORDS_A.length * WORDS_B.length * 100;

// src/game/ranked.ts
var SIM_VERSION = 4;
var RANKED_HERO_LEVEL = 5;
var ENDLESS_START_GOLD = 300;
var ENDLESS_START_LIVES = 20;
function rankedLevelDef() {
  return {
    id: "endless",
    index: 99,
    name: "Endless \u2014 Ranked",
    blurb: "Purchases do not affect this mode",
    lanes: [1, 3, 5, 7, 9],
    startGold: ENDLESS_START_GOLD,
    startLives: ENDLESS_START_LIVES,
    baseCoins: 0,
    palette: LEVELS[3].palette,
    waves: []
  };
}
function normalizeRankedParty(party) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const p of party ?? []) {
    if (out.length >= 3) break;
    if (!p || !p.heroId || seen.has(p.heroId)) continue;
    seen.add(p.heroId);
    out.push({
      heroId: p.heroId,
      level: RANKED_HERO_LEVEL,
      wyrm: p.wyrmId ? { wyrmId: p.wyrmId, level: RANKED_WYRM_LEVEL } : void 0
    });
  }
  return out;
}
function rankedConfig(_mode, seed, party) {
  return {
    level: rankedLevelDef(),
    mods: { ...NEUTRAL },
    // ranked is provably fair: no meta modifiers, ever
    seed: seed >>> 0,
    endless: true,
    // ranked reuses the endless wave curve; rogue layer stays OFF
    startGold: ENDLESS_START_GOLD,
    startLives: ENDLESS_START_LIVES,
    party: normalizeRankedParty(party)
  };
}
var OP_PLACE = 0;
var OP_UPGRADE = 1;
var OP_BRANCH = 2;
var OP_FUSE = 3;
var OP_DEPLOY = 4;
var OP_HEROSPELL = 5;
var OP_SPELL = 6;
var OP_TARGET = 7;
var OP_STARTWAVE = 8;
var OP_HEROMOVE = 9;
var OP_HEROTARGET = 10;
var OP_HEROFOCUS = 11;
var TARGET_MODES_ORDER = ["First", "Last", "Close", "Strong", "Weak", "Primed"];
var REPLAY_TICK_CAP = 60 * 60 * 90;
function applyCmd(sim, cmd) {
  switch (cmd[0]) {
    case OP_PLACE:
      sim.placeTower(cmd[2], cmd[3], cmd[4]);
      break;
    case OP_UPGRADE:
      sim.upgradeTower(cmd[2]);
      break;
    case OP_BRANCH:
      sim.chooseBranch(cmd[2], cmd[3]);
      break;
    case OP_FUSE:
      sim.fuseTowers(cmd[2], cmd[3]);
      break;
    case OP_DEPLOY:
      sim.deployHero(cmd[2], cmd[3], cmd[4]);
      break;
    case OP_HEROSPELL:
      sim.castHeroSpell(cmd[2], cmd[3], cmd[4]);
      break;
    case OP_SPELL:
      sim.castSpell(cmd[2], cmd[3], cmd[4]);
      break;
    case OP_TARGET:
      sim.setTargeting(cmd[2], TARGET_MODES_ORDER[cmd[3]] ?? "First");
      break;
    case OP_STARTWAVE:
      if (sim.state === "prep") sim.startWave();
      break;
    case OP_HEROMOVE:
      sim.moveHero(cmd[2], cmd[3], cmd[4]);
      break;
    case OP_HEROTARGET:
      sim.setHeroTargeting(cmd[2], TARGET_MODES_ORDER[cmd[3]] ?? "First");
      break;
    case OP_HEROFOCUS:
      sim.focusHero(cmd[2], cmd[3]);
      break;
  }
}
function replayRun(rec) {
  const sim = new Sim(rankedConfig(rec.mode, rec.seed, rec.party));
  const cmds = rec.log?.c ?? [];
  const drafts = rec.log?.d ?? [];
  let ci = 0;
  let di = 0;
  let tick = 0;
  while (sim.state !== "won" && sim.state !== "lost" && tick <= REPLAY_TICK_CAP) {
    if (sim.state === "draft") {
      const idx = di < drafts.length ? drafts[di++] : 0;
      const clamped = Math.min(Math.max(0, idx), Math.max(0, sim.draftOffer.length - 1));
      if (!sim.chooseDraft(clamped)) sim.chooseDraft(0);
      continue;
    }
    while (ci < cmds.length && cmds[ci][1] <= tick) {
      applyCmd(sim, cmds[ci]);
      ci++;
    }
    sim.step();
    tick++;
  }
  return {
    score: sim.score(),
    wave: sim.waveIndex + 1,
    fingerprint: `${sim.state}|${sim.waveIndex}|${sim.gold}|${sim.lives}|${sim.runStats.kills}|${sim.runStats.reactions}`
  };
}
function verifyRun(rec) {
  if (!rec || typeof rec !== "object") {
    return { ok: false, score: 0, wave: 0, reason: "invalid", fingerprint: "" };
  }
  if (rec.v !== SIM_VERSION) {
    return { ok: false, score: 0, wave: 0, reason: "version", fingerprint: "" };
  }
  if (!Number.isFinite(rec.seed) || !Number.isFinite(rec.score) || !Number.isFinite(rec.wave)) {
    return { ok: false, score: 0, wave: 0, reason: "invalid", fingerprint: "" };
  }
  let res;
  try {
    res = replayRun(rec);
  } catch {
    return { ok: false, score: 0, wave: 0, reason: "invalid", fingerprint: "" };
  }
  const ok = res.score === rec.score && res.wave === rec.wave;
  return { ok, score: res.score, wave: res.wave, reason: ok ? "" : "mismatch", fingerprint: res.fingerprint };
}
function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function logHash(rec) {
  return fnv1a(JSON.stringify([rec.v, rec.seed, rec.log?.c ?? [], rec.log?.d ?? []]));
}

// server/_supabase.ts
var URL = process.env.GAME_SUPABASE_URL || process.env.VITE_GAME_SUPABASE_URL || "";
var SERVICE_KEY = process.env.GAME_SUPABASE_SERVICE_ROLE_KEY || "";
function serverConfigured() {
  return !!URL && !!SERVICE_KEY;
}
async function sbFetch(path, init = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...init.headers || {}
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`supabase ${res.status}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}
async function upsertPlayer(deviceHash, handle) {
  const body = { device_hash: deviceHash };
  if (handle) body.handle = handle;
  const rows = await sbFetch("players?on_conflict=device_hash", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(body)
  });
  return Array.isArray(rows) ? rows[0] : rows;
}
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// server/verify-run.ts
async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, reason: "method" });
    return;
  }
  if (!serverConfigured()) {
    res.status(503).json({ ok: false, reason: "unconfigured" });
    return;
  }
  let body;
  try {
    body = await readBody(req);
  } catch {
    res.status(400).json({ ok: false, reason: "badbody" });
    return;
  }
  const rec = body?.record;
  const deviceHash = typeof body?.deviceHash === "string" ? body.deviceHash : "";
  const handle = typeof body?.handle === "string" ? body.handle.slice(0, 24) : void 0;
  if (!rec || !deviceHash) {
    res.status(400).json({ ok: false, reason: "missing" });
    return;
  }
  let v;
  try {
    v = verifyRun(rec);
  } catch (e3) {
    res.status(400).json({ ok: false, reason: "unparseable", error: String(e3?.message || e3).slice(0, 200) });
    return;
  }
  if (!v.ok) {
    res.status(200).json({ ok: false, reason: v.reason, score: v.score, wave: v.wave });
    return;
  }
  try {
    const player = await upsertPlayer(deviceHash, handle);
    const playerId = player?.id;
    const displayHandle = player?.handle || handle || null;
    const existing = await sbFetch(
      `runs?mode=eq.${encodeURIComponent(rec.mode)}&period=eq.${rec.period}&player_id=eq.${playerId}&select=id,score`
    );
    const prev = Array.isArray(existing) && existing[0] ? existing[0] : null;
    let runId = prev?.id;
    const improved = !prev || v.score > Number(prev.score);
    if (improved) {
      const payload = {
        seed: rec.seed >>> 0,
        mode: rec.mode,
        period: rec.period,
        score: v.score,
        wave: v.wave,
        sim_version: rec.v,
        player_id: playerId,
        handle: displayHandle,
        replay_input_hash: logHash(rec)
      };
      if (prev) {
        await sbFetch(`runs?id=eq.${prev.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify(payload)
        });
        runId = prev.id;
      } else {
        const rows = await sbFetch("runs", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(payload)
        });
        runId = (Array.isArray(rows) ? rows[0]?.id : rows?.id) || runId;
      }
      if (runId) {
        await sbFetch("run_inputs?on_conflict=run_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({ run_id: runId, log: rec.log, party: rec.party })
        });
      }
    }
    const better = await sbFetch(
      `runs?mode=eq.${encodeURIComponent(rec.mode)}&period=eq.${rec.period}&score=gt.${v.score}&select=id`
    );
    const rank = (Array.isArray(better) ? better.length : 0) + 1;
    res.status(200).json({ ok: true, score: v.score, wave: v.wave, rank, improved, runId, handle: displayHandle });
  } catch (e3) {
    res.status(200).json({ ok: true, verified: true, boarded: false, score: v.score, wave: v.wave, error: String(e3?.message || e3).slice(0, 200) });
  }
}
export {
  handler as default
};
