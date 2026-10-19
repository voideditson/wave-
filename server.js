const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

const WORLD_SIZE = 6000;
const TICK_RATE = 30;

const CARDS = [
  { id: 'hp', name: 'Vitality', desc: '+25% Max HP' },
  { id: 'spd', name: 'Agility', desc: '+15% Move Speed' },
  { id: 'dmg', name: 'Brute Force', desc: '+20% Damage' },
  { id: 'firerate', name: 'Trigger Happy', desc: '+20% Fire Rate' },
  { id: 'bulletspeed', name: 'Velocity', desc: '+25% Bullet Speed' },
  { id: 'regen', name: 'Cellular Regen', desc: 'Heal 1 HP/sec' },
  { id: 'sprintspd', name: 'Track Star', desc: '+25% Sprint Speed' },
  { id: 'revive', name: 'Combat Medic', desc: '+50% Revive Speed' },
  { id: 'pierce', name: 'Piercing', desc: 'Bullets pierce +1 target' },
  { id: 'multishot', name: 'Spread', desc: '+1 Projectile per shot' },
  { id: 'lifesteal', name: 'Vampirism', desc: 'Heal on enemy kill' },
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
    id, name, isHost, x: WORLD_SIZE / 2, y: WORLD_SIZE / 2,
    vx: 0, vy: 0, angle: 0, hp: 100, maxHp: 100,
    knocked: false, deathTimer: 30 * TICK_RATE, dead: false, reviveProgress: 0,
    stamina: 100, maxStamina: 100, isDashing: false, dashTimer: 0,
    stats: { spd: 5, dmg: 20, firerate: 300, bulletspeed: 12, regen: 0, sprintspd: 8, revivespd: 1, pierce: 0, multishot: 1, lifesteal: 0, knockback: 1, armor: 1, crit: 0.05 },
    upgrades: {}, lastShot: 0
  };
}

function getRandomCards() {
  return [...CARDS].sort(() => 0.5 - Math.random()).slice(0, 3);
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, username }) => {
    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = { id: roomId, state: 'LOBBY', wave: 0, players: {}, enemies: [], bullets: [], map: [], host: socket.id };
    rooms[roomId].players[socket.id] = initPlayer(socket.id, username, rooms[roomId].host === socket.id);
    io.to(roomId).emit('updateLobby', Object.values(rooms[roomId].players));
  });

  socket.on('startGame', (roomId) => {
    const room = rooms[roomId];
    if (room && room.host === socket.id) {
      room.map = generateMap(); room.wave = 1; room.state = 'PLAYING'; room.enemies = []; room.bullets = [];
      Object.values(room.players).forEach(p => Object.assign(p, initPlayer(p.id, p.name, p.isHost)));
      spawnWave(room);
      io.to(roomId).emit('gameStarted', { map: room.map, worldSize: WORLD_SIZE });
    }
  });

  socket.on('playerInput', ({ roomId, dx, dy, angle, isShooting, isSprinting, isDashing }) => {
    const room = rooms[roomId];
    if (!room || room.state !== 'PLAYING') return;
    const p = room.players[socket.id];
    if (!p || p.dead || p.knocked) return;

    p.angle = angle;

    if (isDashing && p.stamina >= 30 && p.dashTimer <= 0) {
      p.isDashing = true; p.dashTimer = 10; p.stamina -= 30;
      let len = Math.hypot(dx, dy) || 1;
      p.vx = (dx / len) * 25; p.vy = (dy / len) * 25;
    }

    if (p.dashTimer > 0) {
      p.dashTimer--; p.x += p.vx; p.y += p.vy;
      if (p.dashTimer <= 0) p.isDashing = false;
    } else {
      let speed = p.stats.spd;
      if (isSprinting && p.stamina > 0) { speed = p.stats.sprintspd; p.stamina -= 0.5; } 
      else if (p.stamina < p.maxStamina) { p.stamina += 0.3; }
      
      let len = Math.hypot(dx, dy);
      if (len > 0) { p.x += (dx / len) * speed; p.y += (dy / len) * speed; }
    }

    p.x = Math.max(20, Math.min(WORLD_SIZE - 20, p.x)); p.y = Math.max(20, Math.min(WORLD_SIZE - 20, p.y));

    if (isShooting && Date.now() - p.lastShot > p.stats.firerate && !p.isDashing) {
      p.lastShot = Date.now();
      for (let i = 0; i < p.stats.multishot; i++) {
        const spread = (i - (p.stats.multishot - 1) / 2) * 0.15;
        let isCrit = Math.random() < p.stats.crit;
        room.bullets.push({
          x: p.x, y: p.y, vx: Math.cos(angle + spread) * p.stats.bulletspeed, vy: Math.sin(angle + spread) * p.stats.bulletspeed,
          dmg: p.stats.dmg * (isCrit ? 2 : 1), pierce: p.stats.pierce, owner: p.id, color: isCrit ? '#FBBF24' : '#38BDF8', isCrit, life: 60, type: 'PLAYER'
        });
      }
    }
  });

  socket.on('selectCard', ({ roomId, cardId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const p = room.players[socket.id];
    if (p) {
      p.upgrades[cardId] = (p.upgrades[cardId] || 0) + 1;
      if (cardId === 'hp') { p.maxHp *= 1.25; p.hp = p.maxHp; }
      if (cardId === 'spd') p.stats.spd *= 1.15;
      if (cardId === 'dmg') p.stats.dmg *= 1.20;
      if (cardId === 'firerate') p.stats.firerate *= 0.8;
      if (cardId === 'bulletspeed') p.stats.bulletspeed *= 1.25;
      if (cardId === 'regen') p.stats.regen += 1;
      if (cardId === 'sprintspd') p.stats.sprintspd *= 1.25;
      if (cardId === 'revive') p.stats.revivespd *= 1.5;
      if (cardId === 'pierce') p.stats.pierce += 1;
      if (cardId === 'multishot') p.stats.multishot += 1;
      if (cardId === 'lifesteal') p.stats.lifesteal += 5;
      if (cardId === 'knockback') p.stats.knockback *= 1.3;
      if (cardId === 'armor') p.stats.armor *= 0.9;
      if (cardId === 'crit') p.stats.crit += 0.1;
      p.hasPickedCard = true;
    }
    if (Object.values(room.players).every(pl => pl.dead || pl.hasPickedCard)) {
      room.state = 'PLAYING'; spawnWave(room); io.to(roomId).emit('resumeWave', room.wave);
    }
  });

  socket.on('disconnect', () => { for (let r in rooms) if (rooms[r].players[socket.id]) delete rooms[r].players[socket.id]; });
});

function spawnWave(room) {
  const count = 10 + (room.wave * 5);
  for (let i = 0; i < count; i++) {
    const x = Math.random() < 0.5 ? -50 : WORLD_SIZE + 50; const y = Math.random() * WORLD_SIZE;
    let type = 'NORMAL', hp = 40 * (1 + room.wave*0.1), size = 15, speed = 4 + (room.wave*0.05);
    if (Math.random() < 0.15) { type = 'TANK'; hp = 150 * (1 + room.wave*0.1); size = 30; speed = 2.5; }
    else if (Math.random() < 0.1) { type = 'SNIPER'; hp = 30 * (1 + room.wave*0.1); size = 18; speed = 2; }
    room.enemies.push({ id: Math.random(), x, y, hp, maxHp: hp, speed, size, type, chargeTimer: 0 });
  }
}

setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.state !== 'PLAYING') continue;

    const players = Object.values(room.players);
    const alivePlayers = players.filter(p => !p.dead && !p.knocked);
    
    if (alivePlayers.length === 0 && !players.some(p => p.knocked && !p.dead)) { room.state = 'GAME_OVER'; io.to(roomId).emit('gameOver', room.wave); continue; }

    players.forEach(p => {
      if (p.knocked && !p.dead) {
        p.deathTimer--; p.reviveProgress = Math.max(0, p.reviveProgress - 2);
        if (p.deathTimer <= 0) p.dead = true;
      } else if (!p.knocked && !p.dead && p.hp < p.maxHp && p.stats.regen > 0) {
        p.hp = Math.min(p.maxHp, p.hp + (p.stats.regen / TICK_RATE));
      }
    });

    alivePlayers.forEach(r => {
      players.forEach(d => {
        if (d.knocked && !d.dead && Math.hypot(r.x - d.x, r.y - d.y) < 80) {
          d.reviveProgress += 2 * r.stats.revivespd;
          if (d.reviveProgress >= 100) { d.knocked = false; d.hp = d.maxHp * 0.3; d.deathTimer = 30 * TICK_RATE; }
        }
      });
    });

    for (let i = room.enemies.length - 1; i >= 0; i--) {
      let e = room.enemies[i];
      let target = alivePlayers.sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y))[0];

      if (target) {
        let angle = Math.atan2(target.y - e.y, target.x - e.x);
        let dist = Math.hypot(target.x - e.x, target.y - e.y);

        if (e.type === 'SNIPER') {
          if (dist < 800) {
            e.chargeTimer++; e.aimAngle = angle;
            if (e.chargeTimer > 60) {
              room.bullets.push({ x: e.x, y: e.y, vx: Math.cos(angle)*20, vy: Math.sin(angle)*20, dmg: 40, life: 100, type: 'ENEMY' });
              e.chargeTimer = 0;
            }
          } else { e.x += Math.cos(angle)*e.speed; e.y += Math.sin(angle)*e.speed; }
        } else {
          e.x += Math.cos(angle)*e.speed; e.y += Math.sin(angle)*e.speed;
          if (dist < e.size + 15 && !target.isDashing) {
            target.hp -= (e.type === 'TANK' ? 25 : 10) * target.stats.armor;
            io.to(roomId).emit('floatingText', { x: target.x, y: target.y, text: `-${e.type === 'TANK' ? 25 : 10}`, color: '#EF4444' });
            if (target.hp <= 0) { target.knocked = true; target.hp = 0; }
            e.x -= Math.cos(angle)*50; e.y -= Math.sin(angle)*50;
          }
        }
      }

      for (let j = room.bullets.length - 1; j >= 0; j--) {
        let b = room.bullets[j];
        if (b.type === 'PLAYER' && Math.hypot(b.x - e.x, b.y - e.y) < e.size + 8) {
          e.hp -= b.dmg;
          io.to(roomId).emit('floatingText', { x: e.x, y: e.y, text: Math.floor(b.dmg), color: b.isCrit ? '#FBBF24' : '#FFF' });
          e.x += b.vx * 0.2 * room.players[b.owner].stats.knockback; e.y += b.vy * 0.2 * room.players[b.owner].stats.knockback;
          
          if (b.pierce > 0) b.pierce--; else room.bullets.splice(j, 1);

          if (e.hp <= 0) {
            if (room.players[b.owner].stats.lifesteal > 0 && !room.players[b.owner].knocked) room.players[b.owner].hp = Math.min(room.players[b.owner].maxHp, room.players[b.owner].hp + room.players[b.owner].stats.lifesteal);
            if (e.type === 'TANK') {
              room.enemies.push({ id: Math.random(), x: e.x-10, y: e.y, hp: 40, maxHp: 40, speed: 5, size: 15, type: 'NORMAL' });
              room.enemies.push({ id: Math.random(), x: e.x+10, y: e.y, hp: 40, maxHp: 40, speed: 5, size: 15, type: 'NORMAL' });
              io.to(roomId).emit('screenShake');
            }
            room.enemies.splice(i, 1);
            break;
          }
        }
      }
    }

    for (let i = room.bullets.length - 1; i >= 0; i--) {
      let b = room.bullets[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      if (b.type === 'ENEMY') {
        alivePlayers.forEach(p => {
          if (!p.isDashing && Math.hypot(p.x - b.x, p.y - b.y) < 20) {
            p.hp -= b.dmg * p.stats.armor;
            if (p.hp <= 0) { p.knocked = true; p.hp = 0; }
            b.life = 0;
            io.to(roomId).emit('floatingText', { x: p.x, y: p.y, text: `-${Math.floor(b.dmg)}`, color: '#EF4444' });
          }
        });
      }
      if (b.life <= 0) room.bullets.splice(i, 1);
    }

    if (room.enemies.length === 0) {
      room.wave++;
      if (room.wave % 5 === 0) {
        room.state = 'CARD_SELECT'; players.forEach(p => p.hasPickedCard = false);
        io.to(roomId).emit('showCards', getRandomCards());
      } else { spawnWave(room); io.to(roomId).emit('waveAdvanced', room.wave); }
    }

    io.to(roomId).emit('gameState', { players: room.players, enemies: room.enemies, bullets: room.bullets });
  }
}, 1000 / TICK_RATE);

server.listen(process.env.PORT || 3000, () => console.log('Shape Siege Ultimate Running'));
