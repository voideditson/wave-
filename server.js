const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

const WORLD_SIZE = 6000;
const TICK_RATE = 30; // Server ticks at 30Hz, client renders at native monitor refresh rate

const CARDS = [
  { id: 'hp', name: 'Vitality', desc: '+25% Max HP' },
  { id: 'spd', name: 'Agility', desc: '+15% Move Speed' },
  { id: 'dmg', name: 'Brute Force', desc: '+20% Damage' },
  { id: 'firerate', name: 'Trigger Happy', desc: '+20% Fire Rate' },
  { id: 'fire_ammo', name: 'Incendiary', desc: 'Bullets burn enemies' },
  { id: 'ice_ammo', name: 'Cryogenics', desc: 'Bullets slow enemies' },
  { id: 'trap', name: 'Trapper', desc: 'Deploy mines on dash' }
];

const rooms = {};

function initPlayer(id, name, isHost) {
  return {
    id, name, isHost,
    x: WORLD_SIZE / 2, y: WORLD_SIZE / 2,
    hp: 100, maxHp: 100,
    knocked: false, deathTimer: 30 * TICK_RATE, dead: false, reviveProgress: 0,
    stamina: 100, maxStamina: 100, dashTimer: 0,
    stats: { spd: 6, dmg: 25, firerate: 250, bulletspeed: 16, revivespd: 1, element: 'none', dropsTraps: false },
    upgrades: {}, lastShot: 0
  };
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, username }) => {
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = { 
        id: roomId, state: 'LOBBY', wave: 0, weather: 'CLEAR',
        players: {}, enemies: [], bullets: [], traps: [], host: socket.id 
      };
    }
    rooms[roomId].players[socket.id] = initPlayer(socket.id, username, rooms[roomId].host === socket.id);
    io.to(roomId).emit('updateLobby', Object.values(rooms[roomId].players));
  });

  socket.on('startGame', (roomId) => {
    const room = rooms[roomId];
    if (room && room.host === socket.id) {
      room.wave = 1; room.state = 'PLAYING'; room.enemies = []; room.bullets = []; room.traps = [];
      Object.values(room.players).forEach(p => Object.assign(p, initPlayer(p.id, p.name, p.isHost)));
      spawnWave(room);
      io.to(roomId).emit('gameStarted', { worldSize: WORLD_SIZE });
    }
  });

  // Client sends exact timestamp for smooth reconciliation
  socket.on('playerInput', ({ roomId, x, y, angle, isShooting, isDashing, ts }) => {
    const room = rooms[roomId];
    if (!room || room.state !== 'PLAYING') return;
    const p = room.players[socket.id];
    if (!p || p.dead || p.knocked) return;

    // Trust client position slightly for butter-smooth movement (Server Reconciliation)
    p.x = Math.max(20, Math.min(WORLD_SIZE - 20, x));
    p.y = Math.max(20, Math.min(WORLD_SIZE - 20, y));
    p.angle = angle;
    p.lastTs = ts;

    if (isDashing && p.stamina >= 30 && p.dashTimer <= 0) {
      p.dashTimer = 15; p.stamina -= 30;
      if (p.stats.dropsTraps) {
        room.traps.push({ id: Math.random(), x: p.x, y: p.y, life: 300, dmg: p.stats.dmg * 3 });
      }
    } else if (p.stamina < p.maxStamina && p.dashTimer <= 0) {
      p.stamina += 0.4;
    }
    if (p.dashTimer > 0) p.dashTimer--;

    if (isShooting && Date.now() - p.lastShot > p.stats.firerate) {
      p.lastShot = Date.now();
      room.bullets.push({
        x: p.x, y: p.y, vx: Math.cos(angle) * p.stats.bulletspeed, vy: Math.sin(angle) * p.stats.bulletspeed,
        dmg: p.stats.dmg, owner: p.id, element: p.stats.element, life: 60, type: 'PLAYER'
      });
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
      if (cardId === 'fire_ammo') p.stats.element = 'FIRE';
      if (cardId === 'ice_ammo') p.stats.element = 'ICE';
      if (cardId === 'trap') p.stats.dropsTraps = true;
      p.hasPickedCard = true;
    }
    if (Object.values(room.players).every(pl => pl.dead || pl.hasPickedCard)) {
      room.state = 'PLAYING'; spawnWave(room); io.to(roomId).emit('resumeWave', room.wave);
    }
  });

  socket.on('pingMap', ({ roomId, x, y }) => {
    io.to(roomId).emit('mapPinged', { x, y, color: rooms[roomId].players[socket.id].color || '#38BDF8' });
  });

  socket.on('disconnect', () => {
    for (let r in rooms) if (rooms[r].players[socket.id]) delete rooms[r].players[socket.id];
  });
});

function spawnWave(room) {
  const count = 10 + (room.wave * 5);
  room.weather = Math.random() < 0.2 ? 'FOG' : 'CLEAR';
  
  for (let i = 0; i < count; i++) {
    const x = Math.random() < 0.5 ? -50 : WORLD_SIZE + 50; const y = Math.random() * WORLD_SIZE;
    let type = 'NORMAL', hp = 40 * (1 + room.wave*0.1), size = 15, speed = 4 + (room.wave*0.05);
    
    if (Math.random() < 0.15) { type = 'SPLITTER'; hp = 150 * (1 + room.wave*0.1); size = 30; speed = 2.5; }
    else if (Math.random() < 0.1) { type = 'SNIPER'; hp = 30 * (1 + room.wave*0.1); size = 18; speed = 2; }
    
    room.enemies.push({ id: Math.random(), x, y, hp, maxHp: hp, speed, baseSpeed: speed, size, type, chargeTimer: 0, status: 'NONE', statusTimer: 0 });
  }
}

setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.state !== 'PLAYING') continue;

    const players = Object.values(room.players);
    const alivePlayers = players.filter(p => !p.dead && !p.knocked);
    
    if (alivePlayers.length === 0 && !players.some(p => p.knocked && !p.dead)) { 
      room.state = 'GAME_OVER'; io.to(roomId).emit('gameOver', room.wave); continue; 
    }

    players.forEach(p => {
      if (p.knocked && !p.dead) {
        p.deathTimer--; p.reviveProgress = Math.max(0, p.reviveProgress - 2);
        if (p.deathTimer <= 0) p.dead = true;
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

    for (let i = room.traps.length - 1; i >= 0; i--) {
      let t = room.traps[i]; t.life--;
      if (t.life <= 0) room.traps.splice(i, 1);
    }

    for (let i = room.enemies.length - 1; i >= 0; i--) {
      let e = room.enemies[i];
      
      // Status Effects
      if (e.statusTimer > 0) {
        e.statusTimer--;
        if (e.status === 'FIRE' && e.statusTimer % 10 === 0) e.hp -= 2;
        if (e.status === 'ICE') e.speed = e.baseSpeed * 0.4;
      } else { e.speed = e.baseSpeed; e.status = 'NONE'; }

      let target = alivePlayers.sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y))[0];
      if (target) {
        let angle = Math.atan2(target.y - e.y, target.x - e.x);
        let dist = Math.hypot(target.x - e.x, target.y - e.y);

        if (e.type === 'SNIPER') {
          if (dist < 800) {
            e.chargeTimer++; e.aimAngle = angle;
            if (e.chargeTimer > 60) {
              room.bullets.push({ x: e.x, y: e.y, vx: Math.cos(angle)*22, vy: Math.sin(angle)*22, dmg: 45, life: 100, type: 'ENEMY' });
              e.chargeTimer = 0;
            }
          } else { e.x += Math.cos(angle)*e.speed; e.y += Math.sin(angle)*e.speed; }
        } else {
          e.x += Math.cos(angle)*e.speed; e.y += Math.sin(angle)*e.speed;
          if (dist < e.size + 15) {
            target.hp -= (e.type === 'SPLITTER' ? 30 : 15);
            io.to(roomId).emit('floatingText', { x: target.x, y: target.y, text: `-${e.type === 'SPLITTER' ? 30 : 15}`, color: '#EF4444' });
            if (target.hp <= 0) { target.knocked = true; target.hp = 0; }
            e.x -= Math.cos(angle)*50; e.y -= Math.sin(angle)*50;
          }
        }
      }

      // Trap Collisions
      for (let j = room.traps.length - 1; j >= 0; j--) {
        if (Math.hypot(room.traps[j].x - e.x, room.traps[j].y - e.y) < e.size + 20) {
          e.hp -= room.traps[j].dmg;
          io.to(roomId).emit('floatingText', { x: e.x, y: e.y, text: `BOOM ${room.traps[j].dmg}`, color: '#F59E0B' });
          room.traps.splice(j, 1);
          break;
        }
      }

      // Bullet Collisions
      for (let j = room.bullets.length - 1; j >= 0; j--) {
        let b = room.bullets[j];
        if (b.type === 'PLAYER' && Math.hypot(b.x - e.x, b.y - e.y) < e.size + 8) {
          e.hp -= b.dmg;
          if (b.element !== 'none') { e.status = b.element; e.statusTimer = 60; }
          io.to(roomId).emit('floatingText', { x: e.x, y: e.y, text: Math.floor(b.dmg), color: b.element === 'FIRE' ? '#F97316' : (b.element === 'ICE' ? '#38BDF8' : '#FFF') });
          room.bullets.splice(j, 1);

          if (e.hp <= 0) {
            if (e.type === 'SPLITTER') {
              room.enemies.push({ id: Math.random(), x: e.x-15, y: e.y, hp: 60, maxHp: 60, speed: 6, baseSpeed: 6, size: 12, type: 'NORMAL', chargeTimer:0, status:'NONE', statusTimer:0 });
              room.enemies.push({ id: Math.random(), x: e.x+15, y: e.y, hp: 60, maxHp: 60, speed: 6, baseSpeed: 6, size: 12, type: 'NORMAL', chargeTimer:0, status:'NONE', statusTimer:0 });
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
          if (Math.hypot(p.x - b.x, p.y - b.y) < 20) {
            p.hp -= b.dmg;
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
      } else { spawnWave(room); io.to(roomId).emit('waveAdvanced', { wave: room.wave, weather: room.weather }); }
    }

    io.to(roomId).emit('gameState', { players: room.players, enemies: room.enemies, bullets: room.bullets, traps: room.traps });
  }
}, 1000 / TICK_RATE);

server.listen(process.env.PORT || 3000, () => console.log('Shape Siege Engine V3 Running'));
