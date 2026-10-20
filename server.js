const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

const WORLD_SIZE = 6000;
const TICK_RATE = 20;

// 15 Upgrade Cards
const CARDS = [
  { id: 'hp', name: 'Vitality', desc: '+25% Max HP' },
  { id: 'spd', name: 'Agility', desc: '+15% Move Speed' },
  { id: 'dmg', name: 'Brute Force', desc: '+20% Damage' },
  { id: 'firerate', name: 'Trigger Happy', desc: '+20% Fire Rate' },
  { id: 'bulletspeed', name: 'Velocity', desc: '+25% Bullet Speed' },
  { id: 'regen', name: 'Cellular Regen', desc: 'Heal 1.5 HP/sec' },
  { id: 'sprintspd', name: 'Track Star', desc: '+25% Sprint Speed' },
  { id: 'sprintdur', name: 'Marathon', desc: '+30% Max Stamina' },
  { id: 'revive', name: 'Combat Medic', desc: '+50% Revive Speed' },
  { id: 'pierce', name: 'Piercing', desc: 'Bullets pierce +1 target' },
  { id: 'multishot', name: 'Spread', desc: '+1 Projectile per shot' },
  { id: 'lifesteal', name: 'Vampirism', desc: '+5 HP on kill' },
  { id: 'knockback', name: 'Repel', desc: '+30% Knockback' },
  { id: 'armor', name: 'Plating', desc: '-10% Damage Taken' },
  { id: 'crit', name: 'Lethality', desc: '+10% Crit Chance' }
];

const rooms = {};

function generateMap() {
  const obstacles = [];
  for (let i = 0; i < 150; i++) {
    obstacles.push({
      x: Math.random() * (WORLD_SIZE - 200) + 100,
      y: Math.random() * (WORLD_SIZE - 200) + 100,
      w: Math.random() * 150 + 50,
      h: Math.random() * 150 + 50,
      color: ['#1E293B', '#334155', '#0F172A'][Math.floor(Math.random() * 3)]
    });
  }
  return obstacles;
}

function initPlayer(id, name, isHost) {
  return {
    id, name, isHost,
    x: WORLD_SIZE / 2 + (Math.random() * 100 - 50), 
    y: WORLD_SIZE / 2 + (Math.random() * 100 - 50),
    vx: 0, vy: 0, angle: 0,
    hp: 100, maxHp: 100,
    knocked: false, deathTimer: 30 * TICK_RATE, dead: false,
    reviveProgress: 0,
    sprint: 100, maxSprint: 100,
    stats: { spd: 5.5, dmg: 22, firerate: 250, bulletspeed: 14, regen: 0, sprintspd: 9, sprintdur: 1, revivespd: 1, pierce: 0, multishot: 1, lifesteal: 0, knockback: 1, armor: 1, crit: 0.05 },
    upgrades: {},
    lastShot: 0,
    isReviving: false
  };
}

function getRandomCards() {
  const shuffled = [...CARDS].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 3);
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, username }) => {
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId, state: 'LOBBY', wave: 0,
        players: {}, enemies: [], bullets: [],
        map: [], host: socket.id
      };
    }
    const room = rooms[roomId];
    room.players[socket.id] = initPlayer(socket.id, username, room.host === socket.id);
    io.to(roomId).emit('updateLobby', Object.values(room.players));
  });

  socket.on('startGame', (roomId) => {
    const room = rooms[roomId];
    if (room && room.host === socket.id) {
      room.map = generateMap();
      room.wave = 1;
      room.state = 'PLAYING';
      room.enemies = [];
      room.bullets = [];
      Object.values(room.players).forEach(p => {
        Object.assign(p, initPlayer(p.id, p.name, p.isHost));
      });
      spawnWave(room);
      io.to(roomId).emit('gameStarted', { map: room.map, worldSize: WORLD_SIZE });
    }
  });

  socket.on('playerInput', ({ roomId, dx, dy, angle, isShooting, isSprinting, isReviving }) => {
    const room = rooms[roomId];
    if (!room || room.state !== 'PLAYING') return;
    const p = room.players[socket.id];
    if (!p || p.dead) return;

    p.angle = angle;
    p.isReviving = !!isReviving;

    if (!p.knocked) {
      // Sprinting & Stamina Regeneration Fix
      let speed = p.stats.spd;
      if (isSprinting && p.sprint > 0 && (dx !== 0 || dy !== 0)) {
        speed = p.stats.sprintspd;
        p.sprint = Math.max(0, p.sprint - (1.2 / p.stats.sprintdur));
      } else {
        if (p.sprint < p.maxSprint) {
          p.sprint = Math.min(p.maxSprint, p.sprint + 0.6);
        }
      }

      // Movement
      let len = Math.hypot(dx, dy);
      if (len > 0) {
        p.x += (dx / len) * speed;
        p.y += (dy / len) * speed;
      }

      // Map Boundaries
      p.x = Math.max(20, Math.min(WORLD_SIZE - 20, p.x));
      p.y = Math.max(20, Math.min(WORLD_SIZE - 20, p.y));

      // Shooting
      const now = Date.now();
      if (isShooting && now - p.lastShot > p.stats.firerate) {
        p.lastShot = now;
        for (let i = 0; i < p.stats.multishot; i++) {
          const spread = (i - (p.stats.multishot - 1) / 2) * 0.12;
          let isCrit = Math.random() < p.stats.crit;
          room.bullets.push({
            id: Math.random().toString(36).substring(2, 7),
            x: p.x, y: p.y,
            vx: Math.cos(angle + spread) * p.stats.bulletspeed,
            vy: Math.sin(angle + spread) * p.stats.bulletspeed,
            dmg: p.stats.dmg * (isCrit ? 2 : 1),
            pierce: p.stats.pierce, owner: p.id,
            color: isCrit ? '#FBBF24' : '#38BDF8',
            life: 55
          });
        }
      }
    }
  });

  socket.on('selectCard', ({ roomId, cardId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const p = room.players[socket.id];
    if (p) {
      p.upgrades[cardId] = (p.upgrades[cardId] || 0) + 1;
      applyUpgrade(p, cardId);
      p.hasPickedCard = true;
    }

    if (Object.values(room.players).every(pl => pl.dead || pl.hasPickedCard)) {
      room.state = 'PLAYING';
      spawnWave(room);
      io.to(roomId).emit('resumeWave', room.wave);
    }
  });

  socket.on('disconnect', () => {
    for (let r in rooms) {
      if (rooms[r].players[socket.id]) {
        delete rooms[r].players[socket.id];
        if (Object.keys(rooms[r].players).length === 0) delete rooms[r];
        else io.to(r).emit('updateLobby', Object.values(rooms[r].players));
      }
    }
  });
});

function applyUpgrade(p, cardId) {
  if (cardId === 'hp') { p.maxHp *= 1.25; p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.25); }
  if (cardId === 'spd') p.stats.spd *= 1.15;
  if (cardId === 'dmg') p.stats.dmg *= 1.20;
  if (cardId === 'firerate') p.stats.firerate *= 0.82;
  if (cardId === 'bulletspeed') p.stats.bulletspeed *= 1.25;
  if (cardId === 'regen') p.stats.regen += 1.5;
  if (cardId === 'sprintspd') p.stats.sprintspd *= 1.25;
  if (cardId === 'sprintdur') { p.stats.sprintdur *= 1.30; p.maxSprint *= 1.30; }
  if (cardId === 'revive') p.stats.revivespd *= 1.5;
  if (cardId === 'pierce') p.stats.pierce += 1;
  if (cardId === 'multishot') p.stats.multishot += 1;
  if (cardId === 'lifesteal') p.stats.lifesteal += 5;
  if (cardId === 'knockback') p.stats.knockback *= 1.3;
  if (cardId === 'armor') p.stats.armor *= 0.9;
  if (cardId === 'crit') p.stats.crit += 0.1;
}

function applyBossBuffs(room) {
  Object.values(room.players).forEach(p => {
    p.maxHp += 50;
    p.hp = p.maxHp;
    p.stats.dmg *= 1.3;
    p.stats.spd *= 1.15;
  });
}

function spawnWave(room) {
  const isBossWave = room.wave % 5 === 0;

  if (isBossWave) {
    // Boss Spawning
    const pos = getMapSpawnPosition(room);
    room.enemies.push({
      id: Math.random().toString(36).substring(2, 7),
      x: pos.x, y: pos.y,
      hp: 1200 * (1 + room.wave * 0.35),
      maxHp: 1200 * (1 + room.wave * 0.35),
      speed: 3.2,
      size: 55,
      type: 'BOSS'
    });
  } else {
    // Standard Enemy Wave
    const count = 12 + (room.wave * 4);
    for (let i = 0; i < count; i++) {
      const pos = getMapSpawnPosition(room);
      const rand = Math.random();
      let type = 'TRIANGLE';
      let hp = 35 * (1 + room.wave * 0.12);
      let speed = 4.2 + (room.wave * 0.04);
      let size = 16;

      if (rand < 0.20) {
        type = 'CIRCLE'; // Fast Chaser
        speed = 6.2; hp *= 0.7; size = 12;
      } else if (rand < 0.40) {
        type = 'PENTAGON'; // Tanky & Stronger
        speed = 3.5; hp *= 1.8; size = 22;
      } else if (rand < 0.52) {
        type = 'HEXAGON'; // Heavy Tank
        speed = 2.2; hp *= 3.5; size = 32;
      }

      room.enemies.push({
        id: Math.random().toString(36).substring(2, 7),
        x: pos.x, y: pos.y,
        hp, maxHp: hp, speed, size, type
      });
    }
  }
}

function getMapSpawnPosition(room) {
  const players = Object.values(room.players).filter(p => !p.dead);
  let x, y, safe = false;
  let attempts = 0;
  
  while (!safe && attempts < 20) {
    x = Math.random() * (WORLD_SIZE - 400) + 200;
    y = Math.random() * (WORLD_SIZE - 400) + 200;
    safe = true;
    for (let p of players) {
      if (Math.hypot(p.x - x, p.y - y) < 600) { safe = false; break; }
    }
    attempts++;
  }
  return { x, y };
}

// Fixed Tick Loop & Performance Spatial Calculation
setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.state !== 'PLAYING') continue;

    const players = Object.values(room.players);
    const alivePlayers = players.filter(p => !p.dead && !p.knocked);

    if (alivePlayers.length === 0 && players.some(p => p.knocked)) {
      // Waiting for knock timer expiration
    } else if (alivePlayers.length === 0) {
      room.state = 'GAME_OVER';
      io.to(roomId).emit('gameOver', room.wave);
      continue;
    }

    // Regeneration & Death Timer
    players.forEach(p => {
      if (p.knocked && !p.dead) {
        p.deathTimer--;
        p.reviveProgress = Math.max(0, p.reviveProgress - 0.5); // Slow decay
        if (p.deathTimer <= 0) p.dead = true;
      } else if (!p.knocked && !p.dead) {
        if (p.hp < p.maxHp && p.stats.regen > 0) {
          p.hp = Math.min(p.maxHp, p.hp + (p.stats.regen / TICK_RATE));
        }
      }
    });

    // Revive Logic (Requires pressing 'E')
    alivePlayers.forEach(rescuer => {
      if (!rescuer.isReviving) return;
      players.forEach(downed => {
        if (downed.knocked && !downed.dead && Math.hypot(rescuer.x - downed.x, rescuer.y - downed.y) < 90) {
          downed.reviveProgress += 2.5 * rescuer.stats.revivespd;
          if (downed.reviveProgress >= 100) {
            downed.knocked = false;
            downed.hp = downed.maxHp * 0.4;
            downed.deathTimer = 30 * TICK_RATE;
            downed.reviveProgress = 0;
          }
        }
      });
    });

    // Bullet Physics Processing
    for (let i = room.bullets.length - 1; i >= 0; i--) {
      let b = room.bullets[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      if (b.life <= 0) { room.bullets.splice(i, 1); }
    }

    // Enemy AI & Bullet Collisions
    for (let i = room.enemies.length - 1; i >= 0; i--) {
      let e = room.enemies[i];
      let target = null, minDist = Infinity;
      alivePlayers.forEach(p => {
        let d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d < minDist) { minDist = d; target = p; }
      });

      if (target) {
        let angle = Math.atan2(target.y - e.y, target.x - e.x);
        e.x += Math.cos(angle) * e.speed;
        e.y += Math.sin(angle) * e.speed;

        // Player Collision Damage
        if (minDist < e.size + 15) {
          let baseDamage = e.type === 'BOSS' ? 40 : (e.type === 'HEXAGON' ? 25 : 12);
          target.hp -= baseDamage * target.stats.armor;
          if (target.hp <= 0) {
            target.knocked = true;
            target.hp = 0;
          }
          e.x -= Math.cos(angle) * 35; 
          e.y -= Math.sin(angle) * 35;
        }
      }

      // Bullet Hit Checking
      for (let j = room.bullets.length - 1; j >= 0; j--) {
        let b = room.bullets[j];
        if (Math.hypot(b.x - e.x, b.y - e.y) < e.size + 6) {
          e.hp -= b.dmg;
          let owner = room.players[b.owner];
          if (owner) {
            e.x += b.vx * 0.15 * owner.stats.knockback;
            e.y += b.vy * 0.15 * owner.stats.knockback;
          }

          if (b.pierce > 0) b.pierce--;
          else room.bullets.splice(j, 1);

          if (e.hp <= 0) {
            if (owner && owner.stats.lifesteal > 0 && !owner.knocked) {
              owner.hp = Math.min(owner.maxHp, owner.hp + owner.stats.lifesteal);
            }
            room.enemies.splice(i, 1);
            break;
          }
        }
      }
    }

    // Wave Completion & Upgrades Every Round
    if (room.enemies.length === 0) {
      if (room.wave % 5 === 0) {
        applyBossBuffs(room); // Big buff rewarded after defeating boss
      }

      room.state = 'CARD_SELECT';
      players.forEach(p => p.hasPickedCard = false);
      io.to(roomId).emit('showCards', { cards: getRandomCards(), wasBoss: room.wave % 5 === 0 });
      room.wave++;
    }

    // Broadcast Game State
    io.to(roomId).emit('gameState', {
      players: room.players,
      enemies: room.enemies,
      bullets: room.bullets
    });
  }
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Shape Siege running on port ${PORT}`));
