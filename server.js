// --- CHUNK 1: SERVER SETUP & DATA ---
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

const WORLD_SIZE = 6000;
const TICK_RATE = 30;

// The full 15-Card Upgrade System
const CARDS = [
  { id: 'hp', name: 'Vitality', desc: '+25% Max HP' },
  { id: 'spd', name: 'Agility', desc: '+15% Move Speed' },
  { id: 'dmg', name: 'Brute Force', desc: '+20% Damage' },
  { id: 'firerate', name: 'Trigger Happy', desc: '+20% Fire Rate' },
  { id: 'bulletspeed', name: 'Velocity', desc: '+25% Bullet Speed' },
  { id: 'regen', name: 'Cellular Regen', desc: 'Heal 1 HP/sec' },
  { id: 'sprintspd', name: 'Track Star', desc: '+25% Sprint Speed' },
  { id: 'sprintdur', name: 'Marathon', desc: '+30% Sprint Duration' },
  { id: 'revive', name: 'Combat Medic', desc: '+50% Revive Speed' },
  { id: 'pierce', name: 'Piercing', desc: 'Bullets pierce +1 target' },
  { id: 'multishot', name: 'Spread', desc: '+1 Projectile per shot' },
  { id: 'lifesteal', name: 'Vampirism', desc: 'Heal on enemy kill' },
  { id: 'knockback', name: 'Repel', desc: '+30% Knockback' },
  { id: 'fire_ammo', name: 'Incendiary', desc: 'Burn enemies over time' },
  { id: 'ice_ammo', name: 'Cryogenics', desc: 'Slow enemies on hit' }
];

const rooms = {};

// Procedural Map Generation
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

// Player Blueprint (Stamina, Dash, Elements, Revive State)
function initPlayer(id, name, isHost) {
  return {
    id, name, isHost,
    x: WORLD_SIZE / 2, y: WORLD_SIZE / 2,
    vx: 0, vy: 0, angle: 0,
    hp: 100, maxHp: 100,
    knocked: false, deathTimer: 30 * TICK_RATE, dead: false, reviveProgress: 0,
    stamina: 100, maxStamina: 100, isDashing: false, dashTimer: 0,
    stats: { 
      spd: 6, dmg: 25, firerate: 300, bulletspeed: 15, regen: 0, 
      sprintspd: 9, sprintdur: 1, revivespd: 1, pierce: 0, multishot: 1, 
      lifesteal: 0, knockback: 1, element: 'none', crit: 0.05 
    },
    upgrades: {}, lastShot: 0, hasPickedCard: false
  };
}

function getRandomCards() {
  return [...CARDS].sort(() => 0.5 - Math.random()).slice(0, 3);
}
// --- END OF CHUNK 1 ---
// --- CHUNK 2: SOCKET CONNECTIONS & PLAYER INPUT ---
io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, username }) => {
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = { 
        id: roomId, state: 'LOBBY', wave: 0, weather: 'CLEAR',
        players: {}, enemies: [], bullets: [], traps: [], map: [], host: socket.id 
      };
    }
    rooms[roomId].players[socket.id] = initPlayer(socket.id, username, rooms[roomId].host === socket.id);
    io.to(roomId).emit('updateLobby', Object.values(rooms[roomId].players));
  });

  socket.on('startGame', (roomId) => {
    const room = rooms[roomId];
    if (room && room.host === socket.id) {
      room.map = generateMap(); 
      room.wave = 1; 
      room.state = 'PLAYING'; 
      room.enemies = []; 
      room.bullets = []; 
      room.traps = [];
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

    // Dash Mechanic
    if (isDashing && p.stamina >= 30 && p.dashTimer <= 0) {
      p.isDashing = true; 
      p.dashTimer = 12; // Dash duration
      p.stamina -= 30;
      let len = Math.hypot(dx, dy) || 1;
      p.vx = (dx / len) * 25; 
      p.vy = (dy / len) * 25;
    }

    // Standard Movement & Sprinting
    if (p.dashTimer > 0) {
      p.dashTimer--; 
      p.x += p.vx; 
      p.y += p.vy;
      if (p.dashTimer <= 0) p.isDashing = false;
    } else {
      let speed = p.stats.spd;
      if (isSprinting && p.stamina > 0) { 
        speed = p.stats.sprintspd; 
        p.stamina -= 0.5; // Drain stamina
      } else if (p.stamina < p.maxStamina) { 
        p.stamina += 0.4; // Regen stamina
      }
      
      let len = Math.hypot(dx, dy);
      if (len > 0) { 
        p.x += (dx / len) * speed; 
        p.y += (dy / len) * speed; 
      }
    }

    // Clamp to map boundaries
    p.x = Math.max(20, Math.min(WORLD_SIZE - 20, p.x)); 
    p.y = Math.max(20, Math.min(WORLD_SIZE - 20, p.y));

    // Shooting Mechanics
    if (isShooting && Date.now() - p.lastShot > p.stats.firerate && !p.isDashing) {
      p.lastShot = Date.now();
      for (let i = 0; i < p.stats.multishot; i++) {
        const spread = (i - (p.stats.multishot - 1) / 2) * 0.15;
        let isCrit = Math.random() < p.stats.crit;
        room.bullets.push({
          x: p.x, y: p.y, 
          vx: Math.cos(angle + spread) * p.stats.bulletspeed, 
          vy: Math.sin(angle + spread) * p.stats.bulletspeed,
          dmg: p.stats.dmg * (isCrit ? 2 : 1), 
          pierce: p.stats.pierce, 
          owner: p.id, 
          element: p.stats.element, 
          isCrit, 
          life: 80, 
          type: 'PLAYER'
        });
      }
    }
  });

  socket.on('selectCard', ({ roomId, cardId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const p = room.players[socket.id];
    if (p && !p.hasPickedCard) {
      p.upgrades[cardId] = (p.upgrades[cardId] || 0) + 1;
      
      // Apply Stats
      if (cardId === 'hp') { p.maxHp *= 1.25; p.hp = p.maxHp; }
      if (cardId === 'spd') p.stats.spd *= 1.15;
      if (cardId === 'dmg') p.stats.dmg *= 1.20;
      if (cardId === 'firerate') p.stats.firerate *= 0.8;
      if (cardId === 'bulletspeed') p.stats.bulletspeed *= 1.25;
      if (cardId === 'regen') p.stats.regen += 1;
      if (cardId === 'sprintspd') p.stats.sprintspd *= 1.25;
      if (cardId === 'sprintdur') p.maxStamina *= 1.30;
      if (cardId === 'revive') p.stats.revivespd *= 1.5;
      if (cardId === 'pierce') p.stats.pierce += 1;
      if (cardId === 'multishot') p.stats.multishot += 1;
      if (cardId === 'lifesteal') p.stats.lifesteal += 5;
      if (cardId === 'knockback') p.stats.knockback *= 1.3;
      if (cardId === 'fire_ammo') p.stats.element = 'FIRE';
      if (cardId === 'ice_ammo') p.stats.element = 'ICE';
      
      p.hasPickedCard = true;
    }
    
    // Resume wave if all living players picked
    const livingPlayers = Object.values(room.players).filter(pl => !pl.dead);
    if (livingPlayers.every(pl => pl.hasPickedCard)) {
      room.state = 'PLAYING'; 
      spawnWave(room); 
      io.to(roomId).emit('resumeWave', { wave: room.wave, weather: room.weather });
    }
  });

  socket.on('disconnect', () => { 
    for (let r in rooms) {
      if (rooms[r].players[socket.id]) {
        delete rooms[r].players[socket.id];
        io.to(r).emit('updateLobby', Object.values(rooms[r].players));
      }
    }
  });
});
// --- END OF CHUNK 2 ---
// --- CHUNK 3: WAVE LOGIC & GAME TICK LOOP ---
function spawnWave(room) {
  const count = 10 + (room.wave * 5);
  room.weather = Math.random() < 0.2 ? 'FOG' : 'CLEAR';
  
  for (let i = 0; i < count; i++) {
    // Spawn around the edges
    const x = Math.random() < 0.5 ? -50 : WORLD_SIZE + 50; 
    const y = Math.random() * WORLD_SIZE;
    
    let type = 'NORMAL', hp = 40 * (1 + room.wave*0.1), size = 15, speed = 4 + (room.wave*0.05);
    
    if (Math.random() < 0.15) { type = 'SPLITTER'; hp = 150 * (1 + room.wave*0.1); size = 30; speed = 2.5; }
    else if (Math.random() < 0.1) { type = 'SNIPER'; hp = 30 * (1 + room.wave*0.1); size = 18; speed = 2; }
    
    room.enemies.push({ 
      id: Math.random(), x, y, hp, maxHp: hp, 
      speed, baseSpeed: speed, size, type, 
      chargeTimer: 0, status: 'NONE', statusTimer: 0 
    });
  }
}

// Main Game Loop
setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.state !== 'PLAYING') continue;

    const players = Object.values(room.players);
    const alivePlayers = players.filter(p => !p.dead && !p.knocked);
    
    // Game Over Check
    if (alivePlayers.length === 0 && !players.some(p => p.knocked && !p.dead)) { 
      room.state = 'GAME_OVER'; 
      io.to(roomId).emit('gameOver', room.wave); 
      continue; 
    }

    // Player Knockdown & Regen Logic
    players.forEach(p => {
      if (p.knocked && !p.dead) {
        p.deathTimer--; 
        p.reviveProgress = Math.max(0, p.reviveProgress - 2);
        if (p.deathTimer <= 0) p.dead = true;
      } else if (!p.knocked && !p.dead && p.hp < p.maxHp && p.stats.regen > 0) {
        p.hp = Math.min(p.maxHp, p.hp + (p.stats.regen / TICK_RATE));
      }
    });

    // Revive Logic (Proximity)
    alivePlayers.forEach(r => {
      players.forEach(d => {
        if (d.knocked && !d.dead && Math.hypot(r.x - d.x, r.y - d.y) < 80) {
          d.reviveProgress += 2 * r.stats.revivespd;
          if (d.reviveProgress >= 100) { 
            d.knocked = false; 
            d.hp = d.maxHp * 0.3; 
            d.deathTimer = 30 * TICK_RATE; 
          }
        }
      });
    });

    // Enemy AI & Status Effects
    for (let i = room.enemies.length - 1; i >= 0; i--) {
      let e = room.enemies[i];
      
      // Apply Elemental Statuses
      if (e.statusTimer > 0) {
        e.statusTimer--;
        if (e.status === 'FIRE' && e.statusTimer % 10 === 0) {
          e.hp -= 5; // Burn damage
          io.to(roomId).emit('floatingText', { x: e.x, y: e.y, text: '-5', color: '#F97316' });
        }
        if (e.status === 'ICE') e.speed = e.baseSpeed * 0.4;
      } else { 
        e.speed = e.baseSpeed; 
        e.status = 'NONE'; 
      }

      // Kill enemy if burn killed it
      if (e.hp <= 0) { room.enemies.splice(i, 1); continue; }

      let target = alivePlayers.sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y))[0];
      
      if (target) {
        let angle = Math.atan2(target.y - e.y, target.x - e.x);
        let dist = Math.hypot(target.x - e.x, target.y - e.y);

        if (e.type === 'SNIPER') {
          if (dist < 800) {
            e.chargeTimer++; 
            e.aimAngle = angle;
            if (e.chargeTimer > 60) {
              room.bullets.push({ 
                x: e.x, y: e.y, vx: Math.cos(angle)*22, vy: Math.sin(angle)*22, 
                dmg: 45, life: 100, type: 'ENEMY' 
              });
              e.chargeTimer = 0;
            }
          } else { 
            e.x += Math.cos(angle)*e.speed; 
            e.y += Math.sin(angle)*e.speed; 
          }
        } else {
          e.x += Math.cos(angle)*e.speed; 
          e.y += Math.sin(angle)*e.speed;
          
          // Melee Collision
          if (dist < e.size + 15 && !target.isDashing) {
            let damage = (e.type === 'SPLITTER' ? 30 : 15);
            target.hp -= damage;
            io.to(roomId).emit('floatingText', { x: target.x, y: target.y, text: `-${damage}`, color: '#EF4444' });
            if (target.hp <= 0) { target.knocked = true; target.hp = 0; }
            e.x -= Math.cos(angle)*50; e.y -= Math.sin(angle)*50; // Bounce back
          }
        }
      }
    }

    // Bullet Physics & Collisions
    for (let j = room.bullets.length - 1; j >= 0; j--) {
      let b = room.bullets[j];
      b.x += b.vx; b.y += b.vy; b.life--;
      let destroyed = false;

      if (b.type === 'PLAYER') {
        for (let i = room.enemies.length - 1; i >= 0; i--) {
          let e = room.enemies[i];
          if (Math.hypot(b.x - e.x, b.y - e.y) < e.size + 8) {
            e.hp -= b.dmg;
            if (b.element !== 'none') { e.status = b.element; e.statusTimer = 60; }
            
            let color = b.element === 'FIRE' ? '#F97316' : (b.element === 'ICE' ? '#38BDF8' : (b.isCrit ? '#FBBF24' : '#FFF'));
            io.to(roomId).emit('floatingText', { x: e.x, y: e.y, text: Math.floor(b.dmg), color });
            
            // Knockback
            let owner = room.players[b.owner];
            if (owner) {
              e.x += b.vx * 0.15 * owner.stats.knockback;
              e.y += b.vy * 0.15 * owner.stats.knockback;
            }

            if (b.pierce > 0) b.pierce--; else destroyed = true;

            if (e.hp <= 0) {
              // Lifesteal
              if (owner && owner.stats.lifesteal > 0 && !owner.knocked) {
                owner.hp = Math.min(owner.maxHp, owner.hp + owner.stats.lifesteal);
              }
              
              // Splitter Mechanic
              if (e.type === 'SPLITTER') {
                room.enemies.push({ id: Math.random(), x: e.x-15, y: e.y, hp: 60, maxHp: 60, speed: 6, baseSpeed: 6, size: 12, type: 'NORMAL', chargeTimer:0, status:'NONE', statusTimer:0 });
                room.enemies.push({ id: Math.random(), x: e.x+15, y: e.y, hp: 60, maxHp: 60, speed: 6, baseSpeed: 6, size: 12, type: 'NORMAL', chargeTimer:0, status:'NONE', statusTimer:0 });
                io.to(roomId).emit('screenShake');
              }
              room.enemies.splice(i, 1);
            }
            if (destroyed) break; // Break out of enemy loop if bullet is gone
          }
        }
      } else if (b.type === 'ENEMY') {
        alivePlayers.forEach(p => {
          if (!p.isDashing && Math.hypot(p.x - b.x, p.y - b.y) < 20) {
            p.hp -= b.dmg;
            if (p.hp <= 0) { p.knocked = true; p.hp = 0; }
            destroyed = true;
            io.to(roomId).emit('floatingText', { x: p.x, y: p.y, text: `-${Math.floor(b.dmg)}`, color: '#EF4444' });
          }
        });
      }

      if (destroyed || b.life <= 0) room.bullets.splice(j, 1);
    }

    // Wave Progression
    if (room.enemies.length === 0) {
      room.wave++;
      if (room.wave % 5 === 0) {
        room.state = 'CARD_SELECT'; 
        players.forEach(p => p.hasPickedCard = false);
        io.to(roomId).emit('showCards', getRandomCards());
      } else { 
        spawnWave(room); 
        io.to(roomId).emit('waveAdvanced', { wave: room.wave, weather: room.weather }); 
      }
    }

    // Send state to clients
    io.to(roomId).emit('gameState', { players: room.players, enemies: room.enemies, bullets: room.bullets });
  }
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Shape Siege Server running on port ${PORT}`));
// --- END OF CHUNK 3 (SERVER.JS COMPLETE) ---
