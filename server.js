const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static('public'));

const WORLD_SIZE = 6000, TICK_RATE = 30;
const CARDS = [
  { id: 'hp', name: 'Vitality', desc: '+25% Max HP' }, { id: 'spd', name: 'Agility', desc: '+15% Move Speed' },
  { id: 'dmg', name: 'Brute Force', desc: '+20% Damage' }, { id: 'firerate', name: 'Trigger Happy', desc: '+20% Fire Rate' },
  { id: 'regen', name: 'Regen', desc: 'Heal 1 HP/sec' }, { id: 'sprintspd', name: 'Track Star', desc: '+25% Sprint Speed' },
  { id: 'pierce', name: 'Piercing', desc: 'Bullets pierce +1' }, { id: 'multishot', name: 'Spread', desc: '+1 Projectile' },
  { id: 'lifesteal', name: 'Vampirism', desc: 'Heal on kill' }, { id: 'fire_ammo', name: 'Incendiary', desc: 'Burn enemies' },
  { id: 'ice_ammo', name: 'Cryogenics', desc: 'Slow enemies' }
];

const rooms = {};

function initPlayer(id, name, isHost) {
  return {
    id, name, isHost, x: WORLD_SIZE/2, y: WORLD_SIZE/2, vx: 0, vy: 0, angle: 0, hp: 100, maxHp: 100,
    knocked: false, deathTimer: 30*TICK_RATE, dead: false, reviveProgress: 0, stamina: 100, maxStamina: 100, isDashing: false, dashTimer: 0,
    stats: { spd: 6, dmg: 25, firerate: 300, bulletspeed: 15, regen: 0, sprintspd: 9, revivespd: 1, pierce: 0, multishot: 1, lifesteal: 0, knockback: 1, element: 'none', crit: 0.05 },
    upgrades: {}, lastShot: 0, hasPickedCard: false
  };
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, username }) => {
    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = { id: roomId, state: 'LOBBY', wave: 0, weather: 'CLEAR', players: {}, enemies: [], bullets: [], traps: [], host: socket.id };
    rooms[roomId].players[socket.id] = initPlayer(socket.id, username, rooms[roomId].host === socket.id);
    io.to(roomId).emit('updateLobby', Object.values(rooms[roomId].players));
  });

  socket.on('startGame', (roomId) => {
    if (rooms[roomId] && rooms[roomId].host === socket.id) {
      rooms[roomId].wave = 1; rooms[roomId].state = 'PLAYING'; rooms[roomId].enemies = []; rooms[roomId].bullets = [];
      Object.values(rooms[roomId].players).forEach(p => Object.assign(p, initPlayer(p.id, p.name, p.isHost)));
      spawnWave(rooms[roomId]);
      io.to(roomId).emit('gameStarted', { worldSize: WORLD_SIZE });
    }
  });

  socket.on('playerInput', ({ roomId, dx, dy, angle, isShooting, isSprinting, isDashing }) => {
    const room = rooms[roomId]; if (!room || room.state !== 'PLAYING') return;
    const p = room.players[socket.id]; if (!p || p.dead || p.knocked) return;
    p.angle = angle;

    if (isDashing && p.stamina >= 30 && p.dashTimer <= 0) { p.isDashing = true; p.dashTimer = 12; p.stamina -= 30; let len = Math.hypot(dx, dy)||1; p.vx = (dx/len)*25; p.vy = (dy/len)*25; }
    if (p.dashTimer > 0) { p.dashTimer--; p.x += p.vx; p.y += p.vy; if (p.dashTimer <= 0) p.isDashing = false; } 
    else {
      let speed = p.stats.spd;
      if (isSprinting && p.stamina > 0) { speed = p.stats.sprintspd; p.stamina -= 0.5; } else if (p.stamina < p.maxStamina) p.stamina += 0.4;
      let len = Math.hypot(dx, dy); if (len > 0) { p.x += (dx/len)*speed; p.y += (dy/len)*speed; }
    }
    p.x = Math.max(20, Math.min(WORLD_SIZE-20, p.x)); p.y = Math.max(20, Math.min(WORLD_SIZE-20, p.y));

    if (isShooting && Date.now() - p.lastShot > p.stats.firerate && !p.isDashing) {
      p.lastShot = Date.now();
      for (let i = 0; i < p.stats.multishot; i++) {
        let spread = (i - (p.stats.multishot-1)/2) * 0.15;
        let isCrit = Math.random() < p.stats.crit;
        room.bullets.push({ x: p.x, y: p.y, vx: Math.cos(angle+spread)*p.stats.bulletspeed, vy: Math.sin(angle+spread)*p.stats.bulletspeed, dmg: p.stats.dmg*(isCrit?2:1), pierce: p.stats.pierce, owner: p.id, element: p.stats.element, isCrit, life: 80, type: 'PLAYER' });
      }
    }
  });

  socket.on('selectCard', ({ roomId, cardId }) => {
    const room = rooms[roomId]; if (!room) return;
    const p = room.players[socket.id];
    if (p && !p.hasPickedCard) {
      if (cardId === 'hp') { p.maxHp *= 1.25; p.hp = p.maxHp; } if (cardId === 'spd') p.stats.spd *= 1.15; if (cardId === 'dmg') p.stats.dmg *= 1.20;
      if (cardId === 'firerate') p.stats.firerate *= 0.8; if (cardId === 'fire_ammo') p.stats.element = 'FIRE'; if (cardId === 'ice_ammo') p.stats.element = 'ICE';
      if (cardId === 'multishot') p.stats.multishot += 1; if (cardId === 'pierce') p.stats.pierce += 1;
      p.hasPickedCard = true;
    }
    if (Object.values(room.players).filter(pl=>!pl.dead).every(pl=>pl.hasPickedCard)) { room.state = 'PLAYING'; spawnWave(room); io.to(roomId).emit('resumeWave', { wave: room.wave }); }
  });

  socket.on('pingMap', ({roomId, x, y}) => io.to(roomId).emit('mapPinged', {x, y, color: '#38BDF8'}));
  socket.on('disconnect', () => { for (let r in rooms) if (rooms[r].players[socket.id]) delete rooms[r].players[socket.id]; });
});

function spawnWave(room) {
  for (let i = 0; i < 10 + (room.wave*5); i++) {
    let x = Math.random()<0.5 ? -50 : WORLD_SIZE+50, y = Math.random()*WORLD_SIZE;
    let type = 'NORMAL', hp = 40*(1+room.wave*0.1), size = 15, speed = 4+(room.wave*0.05);
    if (Math.random()<0.15) { type = 'SPLITTER'; hp = 150*(1+room.wave*0.1); size = 30; speed = 2.5; }
    else if (Math.random()<0.1) { type = 'SNIPER'; hp = 30*(1+room.wave*0.1); size = 18; speed = 2; }
    room.enemies.push({ id: Math.random(), x, y, hp, maxHp: hp, speed, baseSpeed: speed, size, type, chargeTimer: 0, status: 'NONE', statusTimer: 0 });
  }
}

setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId]; if (room.state !== 'PLAYING') continue;
    const players = Object.values(room.players), alivePlayers = players.filter(p=>!p.dead&&!p.knocked);
    if (alivePlayers.length === 0 && !players.some(p=>p.knocked&&!p.dead)) { room.state = 'GAME_OVER'; io.to(roomId).emit('gameOver', room.wave); continue; }

    players.forEach(p => { if (p.knocked&&!p.dead) { p.deathTimer--; if(p.deathTimer<=0) p.dead=true; } else if (p.hp<p.maxHp && p.stats.regen>0) p.hp = Math.min(p.maxHp, p.hp+(p.stats.regen/TICK_RATE)); });
    
    for (let i = room.enemies.length - 1; i >= 0; i--) {
      let e = room.enemies[i];
      if (e.statusTimer > 0) { e.statusTimer--; if (e.status === 'FIRE' && e.statusTimer%10===0) e.hp-=5; if (e.status === 'ICE') e.speed = e.baseSpeed*0.4; } else { e.speed = e.baseSpeed; e.status = 'NONE'; }
      if (e.hp <= 0) { room.enemies.splice(i, 1); continue; }
      
      let target = alivePlayers.sort((a,b)=>Math.hypot(a.x-e.x,a.y-e.y)-Math.hypot(b.x-e.x,b.y-e.y))[0];
      if (target) {
        let angle = Math.atan2(target.y-e.y, target.x-e.x), dist = Math.hypot(target.x-e.x, target.y-e.y);
        if (e.type === 'SNIPER') { if (dist < 800) { e.chargeTimer++; e.aimAngle=angle; if(e.chargeTimer>60){ room.bullets.push({x:e.x,y:e.y,vx:Math.cos(angle)*22,vy:Math.sin(angle)*22,dmg:45,life:100,type:'ENEMY'}); e.chargeTimer=0; } } else { e.x+=Math.cos(angle)*e.speed; e.y+=Math.sin(angle)*e.speed; } }
        else { e.x+=Math.cos(angle)*e.speed; e.y+=Math.sin(angle)*e.speed; if (dist < e.size+15 && !target.isDashing) { target.hp -= (e.type==='SPLITTER'?30:15); if(target.hp<=0) target.knocked=true; e.x-=Math.cos(angle)*50; e.y-=Math.sin(angle)*50; } }
      }
    }

    for (let j = room.bullets.length - 1; j >= 0; j--) {
      let b = room.bullets[j]; b.x+=b.vx; b.y+=b.vy; b.life--; let destroyed = false;
      if (b.type === 'PLAYER') {
        for (let i = room.enemies.length - 1; i >= 0; i--) {
          let e = room.enemies[i];
          if (Math.hypot(b.x-e.x, b.y-e.y) < e.size+8) {
            e.hp -= b.dmg; if(b.element!=='none'){e.status=b.element; e.statusTimer=60;}
            if (b.pierce>0) b.pierce--; else destroyed = true;
            if (e.hp <= 0) { if (e.type === 'SPLITTER') { room.enemies.push({id:Math.random(),x:e.x-15,y:e.y,hp:60,maxHp:60,speed:6,baseSpeed:6,size:12,type:'NORMAL',chargeTimer:0,status:'NONE',statusTimer:0}); room.enemies.push({id:Math.random(),x:e.x+15,y:e.y,hp:60,maxHp:60,speed:6,baseSpeed:6,size:12,type:'NORMAL',chargeTimer:0,status:'NONE',statusTimer:0}); } room.enemies.splice(i, 1); }
            if (destroyed) break;
          }
        }
      } else if (b.type === 'ENEMY') { alivePlayers.forEach(p => { if (!p.isDashing && Math.hypot(p.x-b.x,p.y-b.y)<20) { p.hp-=b.dmg; if(p.hp<=0)p.knocked=true; destroyed=true; } }); }
      if (destroyed || b.life <= 0) room.bullets.splice(j, 1);
    }

    if (room.enemies.length === 0) { room.wave++; room.state = 'CARD_SELECT'; players.forEach(p=>p.hasPickedCard = false); io.to(roomId).emit('showCards', [...CARDS].sort(()=>0.5-Math.random()).slice(0,3)); }
    io.to(roomId).emit('gameState', { players: room.players, enemies: room.enemies, bullets: room.bullets });
  }
}, 1000/TICK_RATE);
server.listen(process.env.PORT || 3000);
