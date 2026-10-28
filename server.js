'use strict';
/* Brainrot Heist multiplayer server.
   Clients send their own position. Everything that touches money or ownership
   (buy, sell, steal, deposit, collect, income) is decided here. */
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { WebSocketServer } = require('ws');
const BH = require('./shared.js');

const { COS, SPIN, SPIN_MS, DAILY, RECIPES, STYLE, SP, RAR, PITY, PLAN, ENT_X, ROWS, ZLEN, BELT, BASE_D, BASE_W, SPF, FLOORS, FH, BTN, LASER_COST, LASER_MS, MUT, PRESTIGE } = BH;
const PORT = process.env.PORT || 3000;
const MAX = PLAN.length;
const LASER_TIME = Number(process.env.LASER_MS) || LASER_MS;
const SLOTS = SPF * FLOORS;   /* 4 floors of 15 */
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const WEATHER_TIME = num(process.env.WEATHER_MS, BH.WEATHER_MS);       /* one event, then the same length of quiet */
const WEATHER_FIRST = num(process.env.WEATHER_FIRST, 60000);
const MUT_CHANCE = num(process.env.MUT_CHANCE, BH.MUT_CHANCE);
const LUCK_TIME = num(process.env.LUCK_MS, BH.LUCK_MS);
const BOX_TIME = num(process.env.BOX_MS, BH.BOX_MS);
const MAXCASH = 1e12;
/* admin panel: the password is checked here on the server, never in the browser. Set ADMIN_PASSWORD on Render to change it. */
const ADMIN_HASH = crypto.createHash('sha256').update(String(process.env.ADMIN_PASSWORD || 'P@hul2110')).digest();
const adminFailLog = [];
const saves = new Map();     /* device id -> { cash, owned }: the server's own copy of each player's progress */
const WALK_SPD = Number(process.env.WALK_SPD) || 4.2;      /* bought brainrots stroll home at this speed */
const RAG_MS = 2200;       /* ragdoll time after a bat hit */
const SWING_CD = 700;
const SWING_RANGE = 6.5;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = v => Math.round(v * 100) / 100;

/* ---------------- static files ---------------- */
const HTML = ['public/index.html', 'text/html; charset=utf-8'];
const FILES = {
  '/': HTML,
  '/index.html': HTML,
  '/shared.js': ['shared.js', 'application/javascript; charset=utf-8']
};
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  const f = FILES[url];
  if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
  fs.readFile(path.join(__dirname, f[0]), (err, buf) => {
    if (err) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Server error'); return; }
    res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

/* ---------------- world state ---------------- */
const bases = PLAN.map((pl, i) => ({
  idx: i, owner: null, slots: new Array(SLOTS).fill(null), laserUntil: 0
}));
let uidN = 0, itemN = 0, pidN = 0, walkN = 0, spawnT = 0.5;
const walkers = [];
let items = [];
const pity = { 3: 0, 4: 0, 5: 0, 6: 0 };
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
let boxCount = randInt(BH.BOX_EVERY[0], BH.BOX_EVERY[1]);
const luck = { mult: 1, until: 0 };
const weather = { auto: true, phase: 'gap', cur: 0, until: Date.now() + WEATHER_FIRST, forced: new Set(), bag: [] };
const poolOf = r => { const a = []; SP.forEach((s, j) => { if (s.r === r && !s.box) a.push(j); }); return a; };
const boxOf = r => SP.findIndex(s => s.box && s.r === r);
const unit = (sp, uid, mut, open) => ({ sp, uid, mut: mut || 0, open: open || 0 });
const leftMs = (u, now) => (SP[u.sp].box ? Math.max(0, (u.open || 0) - (now || Date.now())) : 0);
const price = (sp, mut) => BH.price(sp, mut);
const conns = new Set();

function pickOfRarity(r) {
  const pool = poolOf(r);
  return pool[Math.floor(Math.random() * pool.length)];
}
/* luck makes every rarity above Common that many times more likely */
function pickRarity() {
  const L = luck.until > Date.now() ? luck.mult : 1;
  const w = RAR.map((r, i) => (i === 0 ? r.w : r.w * L));
  let x = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) { x -= w[i]; if (x <= 0) return i; }
  return 0;
}
function pickSpecies() { return pickOfRarity(pickRarity()); }
function activeMuts() {
  const s = new Set(weather.forced);
  if (weather.phase === 'event' && weather.cur) s.add(weather.cur);
  return [...s].sort((a, b) => a - b);
}
function rollMut() {
  const a = activeMuts();
  if (!a.length || Math.random() >= MUT_CHANCE) return 0;
  if (a.length > 1) {
    const cs = [];
    MUT.forEach((u, i) => { if (u.combo && a.includes(u.parts[0]) && a.includes(u.parts[1])) cs.push(i); });
    if (cs.length && Math.random() < 0.4) return cs[Math.floor(Math.random() * cs.length)];
  }
  return a[Math.floor(Math.random() * a.length)];
}
function weatherPub(now) {
  now = now || Date.now();
  return {
    auto: weather.auto, phase: weather.phase,
    active: activeMuts().map(m => ({ m, forced: weather.forced.has(m) ? 1 : 0, left: weather.forced.has(m) || weather.cur !== m ? 0 : Math.max(0, weather.until - now) })),
    next: weather.phase === 'gap' && weather.auto ? Math.max(0, weather.until - now) : 0
  };
}
const weatherSig = () => activeMuts().join(',');
function weatherChanged(before) {
  const after = activeMuts();
  const b = before.split(',').filter(Boolean).map(Number);
  for (const m of after) if (b.indexOf(m) < 0) bcast({ t: 'weatherStart', m });
  for (const m of b) if (after.indexOf(m) < 0) bcast({ t: 'weatherEnd', m });
  bcast({ t: 'weather', w: weatherPub() });
}
function nextWeather() {
  if (!weather.bag.length) weather.bag = [1, 2, 3, 4, 5, 6].sort(() => Math.random() - 0.5);
  return weather.bag.pop();
}
function tickWeather(now) {
  if (weather.auto && now >= weather.until) {
    const before = weatherSig();
    if (weather.phase === 'gap') { weather.phase = 'event'; weather.cur = nextWeather(); }
    else { weather.phase = 'gap'; weather.cur = 0; }
    weather.until = now + WEATHER_TIME;
    weatherChanged(before);
  }
  if (luck.until && now >= luck.until) { luck.until = 0; luck.mult = 1; bcast({ t: 'luck', mult: 1, ms: 0 }); }
}
function slotPos(b, i) {
  const pl = PLAN[b.idx], f = Math.floor(i / SPF), li = i % SPF, r = Math.floor(li / 5), c = li % 5;
  return { x: pl.side * (ENT_X + ROWS[r]), z: pl.cz + (c - 2) * 5.5, y: f * FH };
}
const onFloor = (p, y) => Math.abs(p.y - y) < 4;     /* you have to be on the same story as the slot */
function rectOf(b) {
  const pl = PLAN[b.idx], x0 = pl.side * ENT_X, x1 = pl.side * (ENT_X + BASE_D);
  return { minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: pl.cz - BASE_W / 2, maxZ: pl.cz + BASE_W / 2 };
}
const firstEmpty = b => b.slots.findIndex(s => !s);
const slotList = b => { const now = Date.now(); return b.slots.map(s => (s ? { sp: s.sp, uid: s.uid, mut: s.mut || 0, o: leftMs(s, now) } : null)); };
const itemZ = (it, now) => -ZLEN + BELT * ((now || Date.now()) - it.born) / 1000;

const joinedList = () => { const a = []; for (const w of conns) if (w.p.joined) a.push(w.p); return a; };
const joinedCount = () => joinedList().length;
function send(ws, o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); }
function bcast(o, except) {
  const s = JSON.stringify(o);
  for (const w of conns) if (w !== except && w.readyState === 1) w.send(s);
}
function deny(p, text) { send(p.ws, { t: 'msg', text, c: '#ffb02e', deny: 1 }); }
const pub = p => ({
  pid: p.pid, name: p.name, base: p.base, x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw),
  carry: p.carry ? { sp: p.carry.sp, uid: p.carry.uid, mut: p.carry.mut || 0, o: leftMs(p.carry) } : null, tool: p.tool, fly: p.fly ? 1 : 0,
  cos: p.mx ? p.mx.eq : null, st: p.mx ? p.mx.st : null
});
const walkPub = w => ({ id: w.id, sp: w.sp, uid: w.uid, mut: w.mut || 0, o: leftMs(w), owner: w.owner.pid, x: r2(w.x), z: r2(w.z) });
const reserved = p => walkers.reduce((n, w) => n + (w.owner === p ? 1 : 0), 0);
const rectHas = (r, x, z, pad) => x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;
const laserOn = (b, now) => b.laserUntil > (now || Date.now());
/* a base with its laser barrier on is closed to everyone except its owner */
function blockedByLaser(p, x, z, now) {
  for (const b of bases) if (b.owner && b.owner !== p && laserOn(b, now) && rectHas(rectOf(b), x, z, 0.2)) return true;
  return false;
}
function landPlayer(q) {
  if (!q.fly) return;
  q.fly = false;
  bcast({ t: 'fly', pid: q.pid, on: 0 });
}
function zap(q, b) {
  const now = Date.now();
  if (now < q.hitT + 600) return;
  const r = rectOf(b);
  const d = [[q.x - r.minX, -1, 0], [r.maxX - q.x, 1, 0], [q.z - r.minZ, 0, -1], [r.maxZ - q.z, 0, 1]].sort((a, c) => a[0] - c[0])[0];
  q.hitT = now + 1500;
  landPlayer(q);
  bcast({ t: 'hit', pid: q.pid, by: 0, nx: d[1], nz: d[2] });
  send(q.ws, { t: 'msg', text: 'The laser barrier zapped you!', c: '#ff6b8b' });
  if (q.carry) returnCarry(q, null);
}
const freeSlots = (b, p) => b.slots.reduce((n, s) => n + (s ? 0 : 1), 0) - reserved(p);

function setSlot(b, i, u, why, extra) {
  b.slots[i] = { sp: u.sp, uid: u.uid, mut: u.mut || 0, open: u.open || 0, cash: 0 };
  bcast(Object.assign({ t: 'slot', base: b.idx, slot: i, sp: u.sp, uid: u.uid, mut: u.mut || 0, o: leftMs(u), why }, extra || {}));
}
function clearSlot(b, i, why, extra) {
  b.slots[i] = null;
  bcast(Object.assign({ t: 'slot', base: b.idx, slot: i, sp: -1, why }, extra || {}));
}
/* plots with no real player on them stay empty */
function resetLot(b) { b.slots.fill(null); }
bases.forEach(resetLot);

function sendYou(p) {
  const b = bases[p.base];
  send(p.ws, { t: 'you', cash: Math.floor(p.cash), pr: p.pr, pads: b.slots.map(s => (s ? r2(s.cash) : 0)) });
}
function sendLb() {
  const list = joinedList().map(p => [p.pid, p.name, Math.floor(p.cash), p.base, p.pr])
    .sort((a, b) => b[2] - a[2]);
  bcast({ t: 'lb', p: list });
}

function spawnItem(force) {
  if (force == null && items.length > 22) return;
  let sp;
  if (force != null) sp = pickOfRarity(force);
  else if (--boxCount <= 0) { boxCount = randInt(BH.BOX_EVERY[0], BH.BOX_EVERY[1]); sp = boxOf(pickRarity()); }
  else sp = pickSpecies();
  const d = SP[sp], r = d.r;
  const it = { id: ++itemN, sp, x: r2(rand(-1.4, 1.4)), born: Date.now(), mut: d.box ? 0 : rollMut() };
  items.push(it);
  if (!d.box && r >= 3 && pity[r] !== undefined) pity[r] = 0;
  bcast({ t: 'item', id: it.id, sp, x: it.x, age: 0, g: force != null, mut: it.mut });
}

/* a carried brainrot goes back to the base it came from (if that player is still around) */
function returnCarry(p, notHere) {
  const c = p.carry;
  p.carry = null;
  bcast({ t: 'carryEnd', pid: p.pid });
  const fb = bases[c.from];
  if (!fb || fb === notHere || !fb.owner) return false;
  const i = firstEmpty(fb);
  if (i < 0) return false;
  setSlot(fb, i, c, 'return');
  send(fb.owner.ws, { t: 'msg', text: 'Your ' + SP[c.sp].n + ' came back home.', c: '#7dff6a' });
  return true;
}

/* ---------------- joining and leaving ---------------- */
function cleanName(n) {
  return String(n || '').replace(/[^\w .!?'-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
}

/* saved progress can come from the browser (plain numbers: species + 1000 x mutation) or from this server (objects) */
function normOwned(list) {
  const out = [];
  for (const e of list) {
    let sp, mut = 0, left = BOX_TIME;
    if (Number.isInteger(e)) { sp = e % 1000; mut = Math.floor(e / 1000); }
    else if (e && typeof e === 'object') { sp = e.sp; mut = e.mut | 0; if (Number.isFinite(e.left)) left = e.left; }
    else continue;
    if (!Number.isInteger(sp) || sp < 0 || sp >= SP.length) continue;
    if (!(mut >= 0 && mut < MUT.length) || SP[sp].box) mut = 0;
    out.push({ sp, mut, left: SP[sp].box ? clamp(left, 0, BOX_TIME) : 0 });
  }
  return out;
}

function onHello(ws, p, m) {
  if (p.joined) return;
  if (joinedCount() >= MAX) { send(ws, { t: 'full' }); return; }
  /* one connection per device, so a second tab can't copy your brainrots */
  const did = /^[\w-]{8,48}$/.test(String(m.did || '')) ? String(m.did) : 'anon' + p.pid;
  if (joinedList().some(q => q.did === did)) { send(ws, { t: 'dupe' }); return; }
  /* one player per name, ignoring case and punctuation */
  const name = cleanName(m.name) || ('Player' + p.pid);
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '') || s.toLowerCase();
  if (joinedList().some(q => norm(q.name) === norm(name))) { send(ws, { t: 'nameTaken', name }); return; }
  const b = bases.find(x => !x.owner);
  p.joined = true;
  p.did = did;
  p.name = name;
  p.base = b.idx;
  b.owner = p;
  b.slots.fill(null);

  let cash = 200, owned = [{ sp: 0, mut: 0, left: 0 }], pr = 0;
  const sv = saves.get(did) || m.save;     /* the server's copy wins over whatever the browser claims */
  if (sv && Array.isArray(sv.owned) && typeof sv.cash === 'number' && isFinite(sv.cash)) {
    const o = normOwned(sv.owned).slice(0, SLOTS);
    const c = clamp(Math.floor(sv.cash), 0, MAXCASH);
    if (o.length + c > 0) { owned = o; cash = c; pr = clamp(Math.floor(Number(sv.pr)) || 0, 0, PRESTIGE.goals.length); }
  }
  p.cash = cash;
  p.pr = pr;
  p.mx = cleanX(sv && sv.x);
  const t0 = Date.now();
  owned.forEach((u, i) => { b.slots[i] = { sp: u.sp, uid: ++uidN, mut: u.mut, open: SP[u.sp].box ? t0 + u.left : 0, cash: 0 }; });

  const pl = PLAN[b.idx];
  p.x = pl.side * (ENT_X + 3); p.z = pl.cz; p.y = 0; p.yaw = -pl.side * Math.PI / 2;

  send(ws, { t: 'joined', pid: p.pid, name: p.name, base: b.idx, cash: p.cash, pr: p.pr, slots: slotList(b), n: joinedCount() });
  sendMeta(p);
  bcast({ t: 'join', player: pub(p), slots: slotList(b), n: joinedCount() }, ws);
  bcast({ t: 'msg', text: p.name + ' joined', c: '#4fe8ff' }, ws);
  sendYou(p);
  sendLb();
  console.log('join', p.name, 'base', b.idx, 'players', joinedCount());
}

function leave(ws, p) {
  if (!conns.delete(ws) || !p.joined) return;
  p.joined = false;
  const b = bases[p.base];
  if (p.carry) returnCarry(p, b);
  /* keep the server's copy of their progress: slots, anything still walking home, and uncollected pad cash */
  const lt = Date.now();
  const owned = b.slots.filter(Boolean).map(s => ({ sp: s.sp, mut: s.mut || 0, left: leftMs(s, lt) }));
  let cash = p.cash + b.slots.reduce((n, s) => n + (s ? Math.floor(s.cash) : 0), 0);
  for (let i = walkers.length - 1; i >= 0; i--) {
    if (walkers[i].owner === p) { const w = walkers[i]; owned.push({ sp: w.sp, mut: w.mut || 0, left: leftMs(w, lt) }); bcast({ t: 'walkEnd', id: w.id }); walkers.splice(i, 1); }
  }
  saves.delete(p.did);
  saves.set(p.did, { cash: clamp(Math.floor(cash), 0, MAXCASH), owned: owned.slice(0, SLOTS), pr: p.pr, x: p.mx });
  if (saves.size > 3000) saves.delete(saves.keys().next().value);
  b.owner = null;
  b.laserUntil = 0;
  resetLot(b);
  bcast({ t: 'leave', pid: p.pid, base: b.idx, slots: slotList(b), n: joinedCount() });
  bcast({ t: 'msg', text: p.name + ' left', c: '#a4acd0' });
  sendLb();
  console.log('leave', p.name, 'players', joinedCount());
}


/* ---------------- cosmetics, daily rewards, spin wheel, fusion, base looks ---------------- */
const incomeOf = p => bases[p.base].slots.reduce((n, sl) => n + (sl && !SP[sl.sp].box ? BH.rate(sl.sp, sl.mut, p.pr) : 0), 0);
const COSBY = {}; COS.forEach(c => { COSBY[c.id] = c; });
const KINDS = ['hat', 'aura', 'trail'];
const dayNum = now => Math.floor(now / 86400000);
function cleanX(x) {
  const o = { cos: [], eq: { hat: '', aura: '', trail: '' }, day: 0, streak: 0, spinAt: 0, st: { roof: -1, win: -1, ban: -1 } };
  if (!x || typeof x !== 'object') return o;
  if (Array.isArray(x.cos)) o.cos = [...new Set(x.cos.filter(id => typeof id === 'string' && COSBY[id]))];
  if (x.eq && typeof x.eq === 'object') for (const k of KINDS) if (o.cos.includes(x.eq[k]) && COSBY[x.eq[k]].k === k) o.eq[k] = x.eq[k];
  o.day = clamp(Math.floor(Number(x.day)) || 0, 0, 1e6);
  o.streak = clamp(Math.floor(Number(x.streak)) || 0, 0, 1000);
  o.spinAt = clamp(Number(x.spinAt) || 0, 0, Date.now() + SPIN_MS);
  if (x.st && typeof x.st === 'object') for (const k of ['roof', 'win', 'ban']) { const v = x.st[k]; if (Number.isInteger(v) && v >= -1 && v < STYLE[k].length) o.st[k] = v; }
  return o;
}
function sendMeta(p) {
  const now = Date.now(), x = p.mx;
  send(p.ws, { t: 'meta', cos: x.cos, eq: x.eq, st: x.st, streak: x.streak, canDaily: x.day !== dayNum(now) ? 1 : 0, spinIn: Math.max(0, x.spinAt - now), x: { cos: x.cos, eq: x.eq, day: x.day, streak: x.streak, spinAt: x.spinAt, st: x.st } });
}
function dailyReward(p, streak) {
  return Math.round(Math.max(DAILY.base, incomeOf(p) * DAILY.secs) * (1 + 0.5 * (Math.min(streak, DAILY.streakMax) - 1)));
}
function claimDaily(p) {
  const now = Date.now(), today = dayNum(now), x = p.mx;
  if (x.day === today) { deny(p, 'You already claimed today. Come back tomorrow.'); return; }
  x.streak = x.day === today - 1 ? x.streak + 1 : 1;
  x.day = today;
  const amt = dailyReward(p, x.streak);
  p.cash = clamp(p.cash + amt, 0, MAXCASH);
  x.spinAt = 0;
  let extra = ' and a free spin';
  if (x.streak % DAILY.streakMax === 0 && freeSlots(bases[p.base], p) > 0) {
    const b = bases[p.base], i = firstEmpty(b), bx = boxOf(2);
    if (i >= 0 && bx >= 0) { setSlot(b, i, unit(bx, ++uidN, 0, Date.now() + BOX_TIME), 'daily'); extra += ' and an Epic Mystery Box'; }
  }
  send(p.ws, { t: 'msg', text: 'Daily reward, day ' + x.streak + ': $' + amt.toLocaleString('en-US') + extra + '!', c: '#ffd23f' });
  sendYou(p); sendMeta(p);
}
function pickWeighted(list) {
  let tot = 0; for (const e of list) tot += e.w;
  let r = Math.random() * tot;
  for (let i = 0; i < list.length; i++) { r -= list[i].w; if (r <= 0) return i; }
  return list.length - 1;
}
function doSpin(p) {
  const now = Date.now(), x = p.mx;
  if (now < x.spinAt) { deny(p, 'Your next free spin is not ready yet.'); return; }
  const i = pickWeighted(SPIN), pr = SPIN[i], b = bases[p.base];
  const cashAmt = () => Math.round(Math.max(pr.min || 300, incomeOf(p) * (pr.sec || 60)));
  let text = '';
  if (pr.kind === 'cash') { const a = cashAmt(); p.cash = clamp(p.cash + a, 0, MAXCASH); text = '$' + a.toLocaleString('en-US'); }
  else if (pr.kind === 'box') {
    const bx = boxOf(pr.r), si = firstEmpty(b);
    if (bx >= 0 && si >= 0 && freeSlots(b, p) > 0) { setSlot(b, si, unit(bx, ++uidN, 0, now + BOX_TIME), 'spin'); text = 'a ' + pr.n; }
    else { const a = cashAmt() * 3; p.cash = clamp(p.cash + a, 0, MAXCASH); text = '$' + a.toLocaleString('en-US') + ' (your base was full)'; }
  } else if (pr.kind === 'cos') {
    const left = COS.filter(c => !x.cos.includes(c.id));
    if (left.length) { const c = left[Math.floor(Math.random() * left.length)]; x.cos.push(c.id); text = 'the ' + c.n + ' ' + c.k; }
    else { const a = Math.round(Math.max(5000, incomeOf(p) * 600)); p.cash = clamp(p.cash + a, 0, MAXCASH); text = '$' + a.toLocaleString('en-US'); }
  }
  x.spinAt = now + SPIN_MS;
  send(p.ws, { t: 'spinRes', i, text });
  if (pr.w <= 4) bcast({ t: 'msg', text: p.name + ' won ' + text + ' on the wheel!', c: pr.c }, p.ws);
  sendYou(p); sendMeta(p);
}
function fuseOut(a, b) {
  for (const r of RECIPES) if ((r.a === a && r.b === b) || (r.a === b && r.b === a)) return r.out;
  if (SP[a].r === SP[b].r && SP[a].r < 6) { const pool = poolOf(SP[a].r + 1); if (pool.length) return pool[Math.floor(Math.random() * pool.length)]; }
  return -1;
}
function fuseMut(m1, m2) {
  if (m1 && m2 && m1 !== m2) {
    const lo = Math.min(m1, m2), hi = Math.max(m1, m2);
    for (let i = 0; i < MUT.length; i++) if (MUT[i].combo && Math.min(...MUT[i].parts) === lo && Math.max(...MUT[i].parts) === hi) return i;
  }
  return MUT[m1 || 0].m >= MUT[m2 || 0].m ? (m1 || 0) : (m2 || 0);
}
function doFuse(p, ia, ib) {
  const b = bases[p.base];
  if (!Number.isInteger(ia) || !Number.isInteger(ib) || ia === ib || ia < 0 || ib < 0 || ia >= SLOTS || ib >= SLOTS) return;
  const A = b.slots[ia], B = b.slots[ib];
  if (!A || !B || SP[A.sp].box || SP[B.sp].box) { deny(p, 'Pick two brainrots (not mystery boxes).'); return; }
  const out = fuseOut(A.sp, B.sp);
  if (out < 0) { deny(p, 'Those two do not fuse. Use two of the same rarity, or a secret recipe pair.'); return; }
  const cost = Math.round(SP[out].p * 0.05);
  if (p.cash < cost) { deny(p, 'Fusing that costs $' + cost.toLocaleString('en-US') + '.'); return; }
  p.cash -= cost;
  const mut = fuseMut(A.mut || 0, B.mut || 0), lo = Math.min(ia, ib), hi = Math.max(ia, ib);
  clearSlot(b, hi, 'fuse');
  setSlot(b, lo, unit(out, ++uidN, mut, 0), 'fuse');
  send(p.ws, { t: 'fuseRes', sp: out, mut, slot: lo });
  if (SP[out].r >= 3) bcast({ t: 'msg', text: p.name + ' fused ' + SP[A.sp === out ? out : out].n + '!', c: RAR[SP[out].r].c === 'rainbow' ? '#ff6bd6' : RAR[SP[out].r].c }, p.ws);
  sendYou(p);
}

function hitPlayer(q, by, nx, nz) {
  q.hitT = Date.now() + RAG_MS;
  landPlayer(q);
  bcast({ t: 'hit', pid: q.pid, by: by.pid, nx: r2(nx), nz: r2(nz) });
  send(q.ws, { t: 'msg', text: by.name + ' knocked you out!', c: '#ff6b8b' });
  if (q.carry) {
    const sp = q.carry.sp;
    const back = returnCarry(q, null);
    send(q.ws, { t: 'msg', text: 'You dropped ' + SP[sp].n + (back ? ' and it ran back home.' : '.'), c: '#ffb02e' });
    send(by.ws, { t: 'msg', text: 'You knocked ' + q.name + ' out and saved ' + SP[sp].n + '!', c: '#7dff6a' });
  }
}

/* ---------------- admin ---------------- */
function onAdminLogin(ws, p, m) {
  const now = Date.now();
  while (adminFailLog.length && now - adminFailLog[0] > 60000) adminFailLog.shift();
  if (p.admin) { send(ws, { t: 'adminOk' }); return; }
  if (now < p.adminLock || adminFailLog.length >= 30) { send(ws, { t: 'adminFail', locked: 1 }); return; }
  const h = crypto.createHash('sha256').update(String(m.pw || '').slice(0, 200)).digest();
  if (crypto.timingSafeEqual(h, ADMIN_HASH)) {
    p.admin = true; p.adminFails = 0;
    console.log('admin login', p.name || ('conn' + p.pid));
    send(ws, { t: 'adminOk' });
  } else {
    adminFailLog.push(now);
    if (++p.adminFails >= 5) { p.adminFails = 0; p.adminLock = now + 60000; }
    send(ws, { t: 'adminFail', locked: now < p.adminLock ? 1 : 0 });
  }
}
function spawnSpecific(sp, k, mut) {
  const it = { id: ++itemN, sp, x: r2(rand(-1.4, 1.4)), born: Date.now() - k * 700, mut: SP[sp].box ? 0 : mut || 0 };
  items.push(it);
  bcast({ t: 'item', id: it.id, sp, x: it.x, age: k * 0.7, g: false, admin: 1, mut: it.mut });
}
const findPlayer = pid => joinedList().find(q => q.pid === pid) || null;
function adminReply(p, text, bad) { send(p.ws, { t: 'adminReply', text, bad: bad ? 1 : 0 }); }
function giveCash(q, amt) {
  q.cash = clamp(q.cash + amt, 0, MAXCASH);
  sendYou(q);
}
function openBox(b, i) {
  const s = b.slots[i], r = SP[s.sp].r, pool = poolOf(r);
  if (!pool.length) return;
  const sp = pool[Math.floor(Math.random() * pool.length)], was = s.sp;
  setSlot(b, i, unit(sp, ++uidN, 0, 0), 'open', { box: was });
  if (b.owner) {
    send(b.owner.ws, { t: 'msg', text: 'Your ' + SP[was].n + ' opened: ' + SP[sp].n + '!', c: '#ffd23f' });
    if (SP[sp].r >= 3) bcast({ t: 'msg', text: b.owner.name + ' opened a ' + RAR[r].n + ' Mystery Box and got ' + SP[sp].n + '!', c: RAR[r].c === 'rainbow' ? '#ff6bd6' : RAR[r].c }, b.owner.ws);
  }
}
function doPrestige(p) {
  const goal = PRESTIGE.goals[p.pr];
  if (goal === undefined) { deny(p, 'You are already at the top prestige.'); return; }
  if (p.carry) { deny(p, 'Put down what you are carrying first.'); return; }
  if (p.cash < goal) { deny(p, 'You need $' + goal.toLocaleString('en-US') + ' to prestige.'); return; }
  const b = bases[p.base];
  b.slots.forEach((s, i) => { if (s) clearSlot(b, i, 'prestige'); });
  for (let i = walkers.length - 1; i >= 0; i--) if (walkers[i].owner === p) { bcast({ t: 'walkEnd', id: walkers[i].id }); walkers.splice(i, 1); }
  p.pr++;
  p.cash = 200;
  setSlot(b, 0, unit(0, ++uidN, 0, 0), 'stock');
  sendYou(p);
  send(p.ws, { t: 'prestige', pr: p.pr });
  bcast({ t: 'msg', text: p.name + ' prestiged to level ' + p.pr + '! (+' + Math.round(p.pr * PRESTIGE.step * 10) / 10 + 'x income)', c: '#ff9a3d' });
  sendLb();
}
function adminState() {
  const now = Date.now();
  return { t: 'adminState', weather: weatherPub(now), luck: { mult: luck.until > now ? luck.mult : 1, ms: luck.until > now ? luck.until - now : 0 },
    players: joinedList().map(q => ({ pid: q.pid, name: q.name, cash: Math.floor(q.cash), pr: q.pr, base: q.base })) };
}
function wipeAllBases() {
  let n = 0;
  for (const b of bases) b.slots.forEach((s, i) => { if (s) { clearSlot(b, i, 'wipe'); n++; } });
  for (const w of walkers.splice(0)) bcast({ t: 'walkEnd', id: w.id });
  for (const q of joinedList()) if (q.carry) { q.carry = null; bcast({ t: 'carryEnd', pid: q.pid }); }
  for (const rec of saves.values()) rec.owned = [];
  for (const q of joinedList()) sendYou(q);
  console.log('admin wiped', n, 'brainrots');
}
function handleAdmin(p, m) {
  switch (m.t) {
    case 'adminMsg': {
      const text = String(m.text || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      if (text) bcast({ t: 'adminMsg', text });
      break;
    }
    case 'adminSpawn': {
      const sp = m.sp, n = clamp(Math.floor(Number(m.n)) || 1, 1, 10);
      if (!Number.isInteger(sp) || sp < 0 || sp >= SP.length) break;
      const mut = Number.isInteger(m.mut) && m.mut > 0 && m.mut < MUT.length && !SP[sp].box ? m.mut : 0;
      for (let k = 0; k < n; k++) spawnSpecific(sp, k, mut);
      bcast({ t: 'adminSpawned', sp, n, mut });
      break;
    }
    case 'adminCash': {
      const amt = clamp(Math.floor(Number(m.amt)) || 0, 0, MAXCASH);
      const take = m.mode === 'take';
      if (amt < 1) { adminReply(p, 'Enter an amount first.', 1); break; }
      const targets = m.target === 'all' ? joinedList() : [findPlayer(m.target)].filter(Boolean);
      if (!targets.length) { adminReply(p, 'Pick a player first.', 1); break; }
      for (const q of targets) {
        const before = q.cash;
        giveCash(q, take ? -amt : amt);
        const diff = Math.abs(q.cash - before);
        send(q.ws, { t: 'msg', text: take ? 'Admin took $' + Math.floor(diff).toLocaleString('en-US') + ' from you.' : 'Admin gave you $' + Math.floor(diff).toLocaleString('en-US') + '!', c: take ? '#ff6b8b' : '#7dff6a' });
      }
      adminReply(p, (take ? 'Took ' : 'Gave ') + '$' + amt.toLocaleString('en-US') + (m.target === 'all' ? ' each ' + (take ? 'from ' : 'to ') + targets.length + ' players.' : ' ' + (take ? 'from ' : 'to ') + targets[0].name + '.'));
      sendLb();
      break;
    }
    case 'adminGive': {
      const q = findPlayer(m.pid), sp = m.sp;
      if (!q) { adminReply(p, 'Pick a player first.', 1); break; }
      if (!Number.isInteger(sp) || sp < 0 || sp >= SP.length) break;
      const qb = bases[q.base], si = firstEmpty(qb);
      if (si < 0) { adminReply(p, q.name + "'s base is full.", 1); break; }
      const mut = Number.isInteger(m.mut) && m.mut > 0 && m.mut < MUT.length && !SP[sp].box ? m.mut : 0;
      setSlot(qb, si, unit(sp, ++uidN, mut, SP[sp].box ? Date.now() + BOX_TIME : 0), 'stock');
      send(q.ws, { t: 'msg', text: 'Admin gave you ' + (mut ? MUT[mut].pre + ' ' : '') + SP[sp].n + '!', c: '#7dff6a' });
      adminReply(p, 'Gave ' + SP[sp].n + ' to ' + q.name + '.');
      break;
    }
    case 'adminClearBase': {
      const q = findPlayer(m.pid);
      if (!q) { adminReply(p, 'Pick a player first.', 1); break; }
      const qb = bases[q.base];
      qb.slots.forEach((s, i) => { if (s) clearSlot(qb, i, 'wipe'); });
      for (let i = walkers.length - 1; i >= 0; i--) if (walkers[i].owner === q) { bcast({ t: 'walkEnd', id: walkers[i].id }); walkers.splice(i, 1); }
      if (q.carry) { q.carry = null; bcast({ t: 'carryEnd', pid: q.pid }); }
      sendYou(q);
      send(q.ws, { t: 'msg', text: 'Admin cleared your base.', c: '#ff6b8b' });
      adminReply(p, 'Cleared ' + q.name + "'s base.");
      break;
    }
    case 'adminKick': {
      const q = findPlayer(m.pid);
      if (!q || q === p) { adminReply(p, 'Pick another player to kick.', 1); break; }
      send(q.ws, { t: 'kicked' });
      adminReply(p, 'Kicked ' + q.name + '.');
      try { q.ws.close(); } catch (e) {}
      break;
    }
    case 'adminPrestige': {
      const q = findPlayer(m.pid), lv = clamp(Math.floor(Number(m.level)) || 0, 0, PRESTIGE.goals.length);
      if (!q) { adminReply(p, 'Pick a player first.', 1); break; }
      q.pr = lv;
      sendYou(q); sendLb();
      send(q.ws, { t: 'msg', text: 'Admin set your prestige to ' + lv + '.', c: '#ff9a3d' });
      adminReply(p, q.name + ' is now prestige ' + lv + '.');
      break;
    }
    case 'adminWeather': {
      const mu = m.m;
      if (!Number.isInteger(mu) || mu < 1 || mu >= MUT.length || MUT[mu].combo) break;
      const before = weatherSig();
      const on = m.on === undefined ? !weather.forced.has(mu) : !!m.on;
      if (on) weather.forced.add(mu); else { weather.forced.delete(mu); if (weather.cur === mu) { weather.phase = 'gap'; weather.cur = 0; weather.until = Date.now() + WEATHER_TIME; } }
      weatherChanged(before);
      break;
    }
    case 'adminWeatherAuto': {
      const before = weatherSig();
      weather.auto = m.on === undefined ? !weather.auto : !!m.on;
      if (!weather.auto) { weather.phase = 'gap'; weather.cur = 0; }
      else { weather.phase = 'gap'; weather.cur = 0; weather.until = Date.now() + 5000; }
      weatherChanged(before);
      break;
    }
    case 'adminWeatherClear': {
      const before = weatherSig();
      weather.forced.clear(); weather.phase = 'gap'; weather.cur = 0; weather.until = Date.now() + WEATHER_TIME;
      weatherChanged(before);
      break;
    }
    case 'adminLuck': {
      const mult = Number(m.mult);
      if (BH.LUCKS.indexOf(mult) >= 0) {
        luck.mult = mult; luck.until = Date.now() + LUCK_TIME;
        bcast({ t: 'luck', mult, ms: LUCK_TIME, admin: 1 });
      } else { luck.mult = 1; luck.until = 0; bcast({ t: 'luck', mult: 1, ms: 0 }); }
      break;
    }
    case 'adminClearTrack': {
      for (const it of items.splice(0)) bcast({ t: 'itemGone', id: it.id, by: 0 });
      adminReply(p, 'Cleared the track.');
      break;
    }
    case 'adminOpenBoxes': {
      const now = Date.now();
      let n = 0;
      for (const b of bases) for (const s of b.slots) if (s && SP[s.sp].box) { s.open = now; n++; }
      for (const w of walkers) if (SP[w.sp].box) { w.open = now; n++; }
      for (const q of joinedList()) if (q.carry && SP[q.carry.sp].box) { q.carry.open = now; n++; }
      adminReply(p, 'Opening ' + n + ' mystery boxes now.');
      break;
    }
    case 'adminRagdoll': {
      for (const q of joinedList()) {
        const a = Math.random() * 6.283;
        q.hitT = Date.now() + RAG_MS;
        landPlayer(q);
        bcast({ t: 'hit', pid: q.pid, by: 0, nx: r2(Math.cos(a)), nz: r2(Math.sin(a)) });
        if (q.carry) returnCarry(q, null);
      }
      bcast({ t: 'adminMsg', text: 'ADMIN KNOCKED EVERYONE OVER', kind: 'wipe' });
      break;
    }
    case 'adminState':
      send(p.ws, adminState());
      break;
    case 'adminWipe':
      wipeAllBases();
      bcast({ t: 'adminMsg', text: "ADMIN WIPED EVERYONE'S BASES", kind: 'wipe' });
      break;
  }
}

/* ---------------- messages ---------------- */
function slotIndex(v) { return Number.isInteger(v) && v >= 0 && v < SLOTS ? v : -1; }

function handle(ws, p, m) {
  if (m.t === 'hello') { onHello(ws, p, m); return; }
  if (m.t === 'adminLogin') { onAdminLogin(ws, p, m); return; }
  if (typeof m.t === 'string' && m.t.startsWith('admin')) { if (p.admin) handleAdmin(p, m); return; }   /* works from the menu too, no need to join */
  if (!p.joined) return;
  const b = bases[p.base];
  const now = Date.now();
  const down = now < p.hitT;
  if (down && m.t !== 'pos' && m.t !== 'eq' && m.t !== 'chat') return;   /* knocked out: no actions */
  if (p.fly && m.t !== 'pos' && m.t !== 'eq' && m.t !== 'fly' && m.t !== 'laser' && m.t !== 'chat') return;   /* on the carpet: land first */
  switch (m.t) {
    case 'cosBuy': {
      const c = COSBY[m.id];
      if (!c) break;
      if (p.mx.cos.includes(c.id)) { deny(p, 'You already own that.'); break; }
      if (p.cash < c.p) { deny(p, 'You need $' + c.p.toLocaleString('en-US') + '.'); break; }
      p.cash -= c.p; p.mx.cos.push(c.id);
      send(p.ws, { t: 'msg', text: 'Bought ' + c.n + '!', c: '#7dff6a' });
      sendYou(p); sendMeta(p);
      break;
    }
    case 'cosEq': {
      if (KINDS.indexOf(m.k) < 0) break;
      const id = m.id === '' ? '' : String(m.id);
      if (id && !(p.mx.cos.includes(id) && COSBY[id].k === m.k)) break;
      p.mx.eq[m.k] = id;
      bcast({ t: 'cos', pid: p.pid, eq: p.mx.eq });
      sendMeta(p);
      break;
    }
    case 'daily': claimDaily(p); break;
    case 'spin': doSpin(p); break;
    case 'fuse': doFuse(p, m.a, m.b); break;
    case 'style': {
      const st = Object.assign({}, p.mx.st);
      for (const k of ['roof', 'win', 'ban']) if (Number.isInteger(m[k]) && m[k] >= -1 && m[k] < STYLE[k].length) st[k] = m[k];
      if (st.roof === p.mx.st.roof && st.win === p.mx.st.win && st.ban === p.mx.st.ban) break;
      if (p.cash < STYLE.cost) { deny(p, 'Restyling your base costs $' + STYLE.cost.toLocaleString('en-US') + '.'); break; }
      p.cash -= STYLE.cost; p.mx.st = st;
      bcast({ t: 'style', base: p.base, st });
      sendYou(p); sendMeta(p);
      break;
    }
    case 'eq': {
      const tl = m.tool === 1 || m.tool === 2 ? m.tool : 0;
      if (tl && p.fly) break;
      p.tool = tl;
      bcast({ t: 'eq', pid: p.pid, tool: tl }, ws);
      break;
    }

    case 'chat': {
      /* relayed and forgotten: nothing is stored on the server */
      if (now < p.chatT) break;
      const text = String(m.text || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!text) break;
      p.chatT = now + 700;
      bcast({ t: 'chat', pid: p.pid, text });
      break;
    }

    case 'emote': {
      const e = m.e;
      if (!Number.isInteger(e) || e < 0 || e > 3 || now < p.emoteT) break;
      p.emoteT = now + 600;
      bcast({ t: 'emote', pid: p.pid, e }, ws);
      break;
    }

    case 'prestige':
      doPrestige(p);
      break;

    case 'fly': {
      const on = !!m.on;
      if (on === p.fly) break;
      if (on && p.carry) break;                         /* no flying while carrying a stolen brainrot */
      p.fly = on;
      if (on && p.tool) { p.tool = 0; bcast({ t: 'eq', pid: p.pid, tool: 0 }, ws); }
      bcast({ t: 'fly', pid: p.pid, on: on ? 1 : 0 }, ws);
      break;
    }

    case 'shoot': {
      if (p.tool !== 2 || now < p.shotT) break;
      const dx = Number(m.dx), dy = Number(m.dy), dz = Number(m.dz);
      if (![dx, dy, dz].every(Number.isFinite)) break;
      const l = Math.hypot(dx, dy, dz);
      if (l < 0.01) break;
      p.shotT = now + 140;
      /* the gun is just for show: shots are relayed so everyone sees them, and they hit nothing */
      bcast({ t: 'shot', pid: p.pid, dx: r2(dx / l), dy: r2(dy / l), dz: r2(dz / l) }, ws);
      break;
    }

    case 'laser': {
      if (!rectHas(rectOf(b), p.x, p.z, 0.5)) { deny(p, 'You have to be inside your own base to lock it.'); break; }
      if (now < b.laserUntil) { deny(p, 'Your laser barrier is already on.'); break; }
      if (p.cash < LASER_COST) { deny(p, 'The laser barrier costs $' + LASER_COST + '.'); break; }
      p.cash -= LASER_COST;
      b.laserUntil = now + LASER_TIME;
      bcast({ t: 'laser', base: b.idx, ms: LASER_TIME });
      sendYou(p);
      for (const q of joinedList()) if (q !== p && rectHas(rectOf(b), q.x, q.z, 0)) zap(q, b);
      break;
    }

    case 'collectAll': {
      const pl = PLAN[b.idx], bx = pl.side * (ENT_X + BTN.xo), bz = pl.cz + BTN.zo;
      let near = false;
      if (Math.hypot(p.x - bx, p.z - bz) <= 6) for (let f = 0; f < FLOORS; f++) if (Math.abs(p.y - f * FH) < 4) near = true;
      if (!near) break;
      let tot = 0;
      for (const s of b.slots) if (s) { const w = Math.floor(s.cash); if (w >= 1) { tot += w; s.cash -= w; } }
      p.cash += tot;
      send(p.ws, { t: 'collected', v: tot });
      sendYou(p);
      break;
    }

    case 'swing': {
      if (p.tool !== 1 || now < p.swingT) break;
      p.swingT = now + SWING_CD;
      bcast({ t: 'swing', pid: p.pid }, ws);
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      for (const q of joinedList()) {
        if (q === p || now < q.hitT + 600) continue;      /* short grace so nobody is chain-ragdolled */
        const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz) || 0.001;
        if (d > SWING_RANGE || Math.abs(q.y - p.y) > 5) continue;
        if ((dx * fx + dz * fz) / d < -0.15) continue;     /* must be in front */
        hitPlayer(q, p, dx / d, dz / d);
      }
      break;
    }

    case 'buyw': {
      const w = walkers.find(x => x.id === m.id);
      if (!w || w.owner === p || now < w.lock) break;
      const d = SP[w.sp], pc = price(w.sp, w.mut);
      if (Math.hypot(p.x - w.x, p.z - w.z) > 6.5) break;
      if (p.cash < pc) { deny(p, 'Not enough cash.'); break; }
      if (freeSlots(b, p) <= 0) { deny(p, 'Your base is full. Hold E on one of your own to sell it.'); break; }
      const old = w.owner;
      p.cash -= pc;
      old.cash += pc;                                    /* the old owner gets their money back */
      w.owner = p; w.stage = 0; w.lock = now + 1200;
      bcast({ t: 'walkOwner', id: w.id, owner: p.pid });
      send(old.ws, { t: 'msg', text: p.name + ' bought your ' + d.n + ' off you!', c: '#ff6b8b', alarm: 1 });
      sendYou(p); sendYou(old);
      break;
    }

    case 'stealStart': {
      const tb = bases[m.base], si = slotIndex(m.slot);
      if (!tb || tb === b || si < 0 || !tb.owner || p.carry) break;
      const s = tb.slots[si];
      if (!s || now < p.alertT || laserOn(tb, now)) break;
      const sp = slotPos(tb, si);
      if (Math.hypot(p.x - sp.x, p.z - sp.z) > 10 || !onFloor(p, sp.y)) break;
      p.alertT = now + 1200;
      send(tb.owner.ws, { t: 'alert', pid: p.pid, name: p.name, base: tb.idx, slot: si, sp: s.sp });
      break;
    }

    case 'pos':
      if ([m.x, m.y, m.z, m.yaw].every(Number.isFinite)) {
        const nx = clamp(m.x, -62, 62), nz = clamp(m.z, -ZLEN - 8, ZLEN + 8);
        p.yaw = m.yaw;
        if (blockedByLaser(p, nx, nz, now)) break;     /* a laser barrier is in the way */
        p.x = nx; p.z = nz; p.y = clamp(m.y, 0, 60);
      }
      break;

    case 'buy': {
      const it = items.find(i => i.id === m.id);
      if (!it) { deny(p, 'Too late, someone got that one.'); break; }
      const d = SP[it.sp], pc = price(it.sp, it.mut);
      if (Math.hypot(p.x - it.x, p.z - itemZ(it)) > 9) break;
      if (p.cash < pc) { deny(p, 'Not enough cash.'); break; }
      if (freeSlots(b, p) <= 0) { deny(p, 'Your base is full. Hold E on one of your own to sell it.'); break; }
      p.cash -= pc;
      items.splice(items.indexOf(it), 1);
      bcast({ t: 'itemGone', id: it.id, by: p.pid });
      const w = { id: ++walkN, sp: it.sp, uid: ++uidN, mut: it.mut || 0, open: d.box ? now + BOX_TIME : 0, owner: p, x: it.x, z: itemZ(it), stage: 0, lock: now + 800 };
      walkers.push(w);
      bcast({ t: 'walk', w: walkPub(w), why: 'buy' });
      sendYou(p);
      break;
    }

    case 'sell': {
      const si = slotIndex(m.slot);
      if (si < 0 || !b.slots[si]) break;
      const sp = slotPos(b, si);
      if (Math.hypot(p.x - sp.x, p.z - sp.z) > 7 || !onFloor(p, sp.y)) break;
      const v = Math.floor(price(b.slots[si].sp, b.slots[si].mut) * 0.5);
      p.cash += v;
      clearSlot(b, si, 'sell', { v, who: p.pid });
      sendYou(p);
      break;
    }

    case 'steal': {
      if (p.carry) break;
      const tb = bases[m.base];
      const si = slotIndex(m.slot);
      if (!tb || tb === b || si < 0) break;
      const s = tb.slots[si];
      if (!s) break;
      if (laserOn(tb, now)) { deny(p, 'That base has its laser barrier on.'); break; }
      const sp = slotPos(tb, si);
      if (Math.hypot(p.x - sp.x, p.z - sp.z) > 8 || !onFloor(p, sp.y)) break;
      clearSlot(tb, si, 'steal', { who: p.pid });
      p.carry = { sp: s.sp, uid: s.uid, mut: s.mut || 0, open: s.open || 0, from: tb.idx };
      bcast({ t: 'carry', pid: p.pid, sp: s.sp, uid: s.uid, mut: s.mut || 0, o: leftMs(s) });
      if (tb.owner) {
        send(tb.owner.ws, { t: 'msg', text: p.name + ' stole your ' + SP[s.sp].n + '!', c: '#ff6b8b', alarm: 1 });
        sendYou(tb.owner);
      }
      break;
    }

    case 'deposit': {
      if (!p.carry) break;
      const r = rectOf(b);
      if (p.x < r.minX - 3 || p.x > r.maxX + 3 || p.z < r.minZ - 3 || p.z > r.maxZ + 3) break;
      const si = freeSlots(b, p) > 0 ? firstEmpty(b) : -1;
      if (si < 0) {
        if (Date.now() > p.fullT) { p.fullT = Date.now() + 3000; deny(p, 'Base full. Hold E on one of yours to sell it, then step in again.'); }
        break;
      }
      const c = p.carry;
      p.carry = null;
      bcast({ t: 'carryEnd', pid: p.pid });
      setSlot(b, si, c, 'dep', { who: p.pid });
      break;
    }

    case 'collect': {
      const si = slotIndex(m.slot);
      if (si < 0 || !b.slots[si]) break;
      const sp = slotPos(b, si);
      if (Math.hypot(p.x - sp.x, p.z - sp.z) > 6 || !onFloor(p, sp.y)) break;
      const s = b.slots[si], whole = Math.floor(s.cash);
      if (whole >= 1) { p.cash += whole; s.cash -= whole; sendYou(p); }
      break;
    }
  }
}

/* ---------------- sockets ---------------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });
wss.on('connection', ws => {
  const p = { pid: ++pidN, ws, joined: false, name: '', base: -1, cash: 0, x: 0, y: 0, z: 0, yaw: 0, carry: null, fullT: 0, rate: 0, tool: 0, fly: false, did: '', admin: false, adminFails: 0, adminLock: 0, hitT: 0, swingT: 0, shotT: 0, alertT: 0, chatT: 0, emoteT: 0, pr: 0, mx: null };
  ws.p = p;
  ws.isAlive = true;
  conns.add(ws);
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', data => {
    if (++p.rate > 120) return;
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    try { handle(ws, p, m); } catch (e) { console.error(e); }
  });
  ws.on('close', () => leave(ws, p));
  ws.on('error', () => {});
  const now = Date.now();
  send(ws, {
    t: 'init', pid: p.pid, max: MAX, n: joinedCount(), pity,
    items: items.map(it => ({ id: it.id, sp: it.sp, x: it.x, age: (now - it.born) / 1000, mut: it.mut || 0 })),
    weather: weatherPub(now), luck: { mult: luck.until > now ? luck.mult : 1, ms: luck.until > now ? luck.until - now : 0 },
    bases: bases.map(b => ({ owner: b.owner ? { pid: b.owner.pid, name: b.owner.name } : null, slots: slotList(b), laser: b.laserUntil > now ? b.laserUntil - now : 0 })),
    players: joinedList().map(pub),
    walkers: walkers.map(walkPub)
  });
});

/* ---------------- loops ---------------- */
let last = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  tickWeather(now);
  if (conns.size) {
    spawnT -= dt;
    if (spawnT <= 0) { spawnT = rand(4, 5.5); spawnItem(null); }
    if (joinedCount()) {
      for (const r of [3, 4, 5, 6]) { pity[r] += dt; if (pity[r] >= PITY[r]) spawnItem(r); }
    }
  }
  for (let i = items.length - 1; i >= 0; i--) {
    if (itemZ(items[i], now) > ZLEN + 1) { bcast({ t: 'itemGone', id: items[i].id, by: 0 }); items.splice(i, 1); }
  }
  for (const b of bases) {
    if (b.owner) {
      const pr = b.owner.pr;
      for (let i = 0; i < b.slots.length; i++) {
        const s = b.slots[i];
        if (!s) continue;
        if (SP[s.sp].box) { if (s.open && now >= s.open) openBox(b, i); continue; }
        s.cash += BH.rate(s.sp, s.mut, pr) * dt;
      }
    }
    if (b.laserUntil && now > b.laserUntil) {
      b.laserUntil = 0; bcast({ t: 'laser', base: b.idx, ms: 0 });
      if (b.owner) send(b.owner.ws, { t: 'msg', text: 'Your laser barrier switched off. Go into your base and press L to lock it again.', c: '#ffb02e' });
    }
  }
  /* bought brainrots walk home on their own, so anyone nearby can try to buy them off the owner */
  for (let i = walkers.length - 1; i >= 0; i--) {
    const w = walkers[i], pl = PLAN[w.owner.base], b = bases[w.owner.base];
    const tx = pl.side * (w.stage ? ENT_X + 2.5 : ENT_X - 3), tz = pl.cz;
    const dx = tx - w.x, dz = tz - w.z, d = Math.hypot(dx, dz);
    if (d <= 0.6) {
      if (!w.stage) { w.stage = 1; continue; }
      const si = firstEmpty(b);
      if (si >= 0) {
        walkers.splice(i, 1);
        setSlot(b, si, w, 'dep', { who: w.owner.pid });
        bcast({ t: 'walkEnd', id: w.id });
      }
      continue;
    }
    const st = Math.min(d, WALK_SPD * dt);
    w.x += dx / d * st; w.z += dz / d * st;
  }
  for (const p of joinedList()) {
    const b = bases[p.base];
    if (p.cash < 25 && !p.carry && b.slots.every(s => !s)) {
      p.cash = 50;
      send(p.ws, { t: 'msg', text: 'Here is a little starter cash.', c: '#7dff6a' });
      sendYou(p);
    }
  }
}, 50);

setInterval(() => {
  const list = joinedList();
  if (list.length >= 2) bcast({ t: 'snap', p: list.map(p => [p.pid, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw)]) });
  if (walkers.length) bcast({ t: 'wsnap', w: walkers.map(w => [w.id, r2(w.x), r2(w.z)]) });
}, 66);

setInterval(() => { for (const p of joinedList()) sendYou(p); }, 200);
setInterval(() => { bcast({ t: 'pity', p: pity }); sendLb(); bcast({ t: 'weather', w: weatherPub() }); }, 2000);
setInterval(() => {
  let st = null;
  for (const w of conns) if (w.p.admin) { if (!st) st = adminState(); send(w, st); }
}, 1000);
setInterval(() => { for (const w of conns) w.p.rate = 0; }, 1000);
setInterval(() => {
  for (const w of conns) {
    if (!w.isAlive) { w.terminate(); continue; }
    w.isAlive = false;
    try { w.ping(); } catch (e) {}
  }
}, 25000);

server.listen(PORT, () => console.log('Brainrot Heist listening on ' + PORT));
