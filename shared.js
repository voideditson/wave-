/* Data shared by the server and the browser. Add new brainrots at the END of SP so saves keep working. */
(function(){
var RAR=[
  {n:'Common',c:'#c9d1de',w:65},{n:'Uncommon',c:'#5be37d',w:23.4},{n:'Epic',c:'#b968ff',w:7},
  {n:'Legendary',c:'#ffb02e',w:3},{n:'Mythic',c:'#ff4f7b',w:1},{n:'Ultra',c:'#4fe8ff',w:0.5},{n:'Secret',c:'rainbow',w:0.1},{n:'Admin',c:'#ff2d55',w:0.02}
];
var SP=[
  {n:'Loco Motivo Locomotivo',r:0,p:25,i:.5,k:'loco',c1:0xd9363e,c2:0xffd23f},
  {n:'Boom Boom Bombini Jr',r:0,p:50,i:1,k:'bomb',c1:0x2c2f44,c2:0xff3d3d},
  {n:'Detentiondilo Snappini',r:0,p:90,i:1.7,k:'detcroc',c1:0x5aa545,c2:0x2c6b2a},
  {n:'Patapim Stumpini',r:0,p:140,i:2.5,k:'stump',c1:0x8a5a2b,c2:0x5d3a1a},
  {n:'Professor Pepperonaldo',r:0,p:200,i:3.5,k:'pizza',c1:0xffc247,c2:0xd33b2c},
  {n:'Bombardiro Boomdilo',r:1,p:300,i:4,k:'bomber',c1:0x6b8f3a,c2:0x3f5a24},
  {n:'Tonk Tonk Tonk Mr Stickeh',r:1,p:450,i:6.5,k:'log',c1:0xc48a45,c2:0x7a4a22},
  {n:'Homeworkodon the Late',r:1,p:650,i:9,k:'homework',c1:0x3fb6a8,c2:0x2e8a80},
  {n:'Mr Pickleballsandwich',r:1,p:900,i:12.5,k:'coin',c1:0xffc928,c2:0xe0a21a},
  {n:'Sigmundo Chadius',r:1,p:1300,i:18,k:'sigma',c1:0xe9e6df,c2:0xcfcfd9},
  {n:'Tralalero Sharkaleo',r:2,p:2500,i:30,k:'shark',c1:0x5a8fd6,c2:0x2f5fa8},
  {n:'Zillamax Maximum',r:2,p:4000,i:46,k:'kaiju',c1:0x2f7d4a,c2:0x1d4d2f,scale:1.1},
  {n:'Cappuccinoso Latteo',r:2,p:6000,i:70,k:'cup',c1:0xfff6ea,c2:0x7a4a2a},
  {n:'Mr Ohiolo',r:3,p:12000,i:120,k:'ohio',c1:0x6b2d12,c2:0xe0a867},
  {n:'Brr Brr Snowbrrr',r:3,p:18000,i:180,k:'yeti',c1:0xcfeeff,c2:0x5fb4e6},
  {n:'Rizzolini Pepperoni',r:3,p:28000,i:280,k:'rizz',c1:0xff8a7a,c2:0x3a1a14},
  {n:'Skibidolo Toiletto',r:4,p:80000,i:600,k:'throne',c1:0xf8fbff,c2:0xffd23f},
  {n:'Professor Yapzilla',r:4,p:140000,i:1050,k:'yap',c1:0x8e5cff,c2:0x3b1a8c},
  {n:'Tonk Tonk Tonk Ticklini',r:5,p:400000,i:2500,k:'ultralog',c1:0x5a3a1e,c2:0x4fe8ff,scale:1.1},
  {n:'Mr Gyattolo',r:6,p:1500000,i:7500,k:'gyatt',c1:0xffffff,c2:0xffffff,scale:1.1,rainbow:1},
  {n:'Spaghettini Bolognaldo',r:0,p:110,i:2,k:'spag',c1:0xffe08a,c2:0xd33b2c},
  {n:'Mr Cactusino',r:0,p:170,i:3,k:'cactus',c1:0x3fae5a,c2:0xff7aa3},
  {n:'Caterpillini Pillardo',r:1,p:550,i:8,k:'worm',c1:0x7bd34a,c2:0xff8a3d},
  {n:'Monkeyni Bananarama',r:1,p:1000,i:14,k:'banana',c1:0xffd93d,c2:0x7a4a2a},
  {n:'Lirili Elefantola',r:2,p:3200,i:38,k:'ele',c1:0x5fb85a,c2:0xffd23f},
  {n:'Helicoptero Whirlini',r:2,p:5200,i:58,k:'copter',c1:0xe84a5f,c2:0x2b2f4a},
  {n:'Sir Knightsalot Armorini',r:3,p:15000,i:150,k:'knight',c1:0xb8c2d6,c2:0xd0213a},
  {n:'Robotron 9000 Beepbop',r:3,p:24000,i:240,k:'robot',c1:0x9aa5b8,c2:0xff9f1c},
  {n:'Mr Suited Monocle',r:4,p:110000,i:850,k:'monocle',c1:0x1b1b30,c2:0xffd23f},
  {n:'Galaxo Cosmoverse',r:5,p:550000,i:3400,k:'galaxy',c1:0x5b3fd6,c2:0x4fe8ff},
  {n:'Mr Suited Monocle Prime',r:6,p:2500000,i:11000,k:'monocle',c1:0xffffff,c2:0xffffff,scale:1.15,rainbow:1},
  /* more brainrots for the lower tiers, plus one more Secret */
  {n:'Toastini Butterino',r:0,p:70,i:1.3,k:'toast',c1:0xe8b36a,c2:0xffe27a},
  {n:'Quackadoodle Quackini',r:0,p:130,i:2.3,k:'duck',c1:0xffd93d,c2:0xff8a2a},
  {n:'Cheesebert Meltini',r:1,p:700,i:10,k:'cheese',c1:0xffc83a,c2:0xe59a1a},
  {n:'Escargotto Slowpoke',r:2,p:4600,i:52,k:'snail',c1:0xc98f5a,c2:0x7ad07a},
  {n:'Dragonaro Emberdrake',r:3,p:20000,i:200,k:'dragon',c1:0xb2331f,c2:0xffb02e},
  {n:'Rexzilla Maximosaurus',r:6,p:4200000,i:17500,k:'trex',c1:0x3a8f4a,c2:0xffd23f,scale:1.2},
  /* the friends */
  {n:'Mikaelalini Sandanayakini',r:2,p:3600,i:42,k:'mikael',c1:0xff7a2a,c2:0xffd23f},
  {n:'Mushy',r:2,p:5200,i:60,k:'mushy',c1:0x6b7fd6,c2:0xb6c3ff},
  {n:'Manrajalini Sidhuini',r:3,p:16000,i:160,k:'manraj',c1:0x2fa86a,c2:0xcfeedd},
  {n:'Jayden Oxenbridge',r:4,p:95000,i:700,k:'jayden',c1:0x1f2a4a,c2:0x4fb0ff},
  {n:'Ian M a bombo',r:5,p:450000,i:2800,k:'ian',c1:0x3a3f52,c2:0xff4a2a},
  {n:'Pahul Pannulini',r:7,p:12000000,i:50000,k:'pahul',c1:0x111118,c2:0xff2d55,scale:1.2}
];
/* one mystery box per rarity, priced a bit under the average brainrot of that rarity. Appended last so saves keep working. */
(function(){
  var R2=RAR.length,k,j;
  for(k=0;k<R2;k++){
    var tot=0,n=0,inc=0;
    for(j=0;j<SP.length;j++)if(!SP[j].box&&SP[j].r===k){tot+=SP[j].p;n++}
    SP.push({n:RAR[k].n+' Mystery Box',r:k,p:Math.round(tot/n*0.7/10)*10||10,i:0,k:'mbox',c1:0x2b2f4a,c2:0xffffff,box:1,scale:1});
  }
})();
/* round 5/6 additions, appended after the boxes so saves keep working */
SP.push(
  {n:'Pumpkino Jackolantern',r:3,p:25000,i:240,k:'pumpkin',c1:0xf07a14,c2:0x4a7a2a},
  {n:'Draculino Fangsworth',r:4,p:120000,i:880,k:'dracula',c1:0x14101e,c2:0xc01030},
  {n:'George Linini Chellolini',r:2,p:4000,i:46,k:'george',c1:0x2f4f8f,c2:0xc98a45},
  {n:'Ronaldodo Lililolo',r:1,p:650,i:9,k:'swimmer',c1:0xf3cda3,c2:0x1f6fe0},
  {n:'Eric The Gao Shao',r:3,p:18000,i:180,k:'eric',c1:0xf5f5f5,c2:0x1c2a5a},
  {n:'William Stinkyladero',r:2,p:4800,i:55,k:'william',c1:0x4f9f2a,c2:0x8bd04a},
  {n:'Sean Fu Fu Yuan Yuan',r:2,p:5600,i:64,k:'sean',c1:0xe8e8f0,c2:0xd03a3a},
  {n:'Oliver Turner',r:4,p:105000,i:760,k:'oliver',c1:0x2a2f45,c2:0x7dff3a},
  {n:'Agam Kahlonini',r:3,p:17000,i:170,k:'agam',c1:0x2a6adf,c2:0xffffff},
  {n:'Austinradero Dyerdodo',r:3,p:19000,i:190,k:'austin',c1:0x5b2fa0,c2:0xffd23f},
  {n:'Ronaldini Bebe',r:4,p:110000,i:800,k:'bebe',c1:0xf1b08a,c2:0xf08a3a},
  {n:'Oliver Le Goblino',r:5,p:500000,i:3200,k:'goblin',c1:0x6fb04f,c2:0x4a7a35,scale:1.1}
);
/* weather mutations. index 0 is "none". m = income multiplier, pm = price multiplier */
var MUT=[
  {n:'',pre:'',m:1,pm:1,c:0xffffff,cs:'#ffffff'},
  {n:'Rain',pre:'Soaked',m:1.5,pm:1.25,c:0x4aa8ff,cs:'#4aa8ff'},
  {n:'Snow',pre:'Frozen',m:2,pm:1.5,c:0xcfeeff,cs:'#cfeeff'},
  {n:'Sandstorm',pre:'Sandy',m:2.5,pm:1.75,c:0xe0b060,cs:'#e0b060'},
  {n:'Thunderstorm',pre:'Shocked',m:3.5,pm:2.25,c:0xffe83a,cs:'#ffe83a'},
  {n:'Meteor Shower',pre:'Molten',m:5,pm:3,c:0xff6a2a,cs:'#ff6a2a'},
  {n:'Blood Moon',pre:'Cursed',m:7,pm:4,c:0xd0102a,cs:'#ff2a4a'},
  /* combos: only roll while both parent events are on at once. combo:1 keeps them out of the weather cycle */
  {n:'Storm Surge',pre:'Surging',m:9,pm:5,c:0x3aa0ff,cs:'#3aa0ff',combo:1,parts:[1,4]},
  {n:'Frostfire',pre:'Frostfire',m:12,pm:6,c:0x9ff0ff,cs:'#9ff0ff',combo:1,parts:[2,5]},
  {n:'Dust Devil',pre:'Dusty Devil',m:11,pm:5.5,c:0xe0a040,cs:'#e0a040',combo:1,parts:[3,4]},
  {n:'Crimson Tide',pre:'Crimson',m:15,pm:7,c:0xff3060,cs:'#ff3060',combo:1,parts:[1,6]},
  {n:'Hellstorm',pre:'Hellish',m:22,pm:9,c:0xff2a00,cs:'#ff2a00',combo:1,parts:[5,6]}
];
/* prestige: reach the cash goal, then reset for a permanent +0.1x income per level */
var PRESTIGE={goals:[100000,500000,2500000,12500000,60000000,300000000,1500000000,7500000000,40000000000,200000000000],step:0.1};
var PLAN=[{side:-1,cz:25},{side:1,cz:25},{side:-1,cz:-25},{side:1,cz:-25},{side:-1,cz:75},{side:1,cz:75},{side:-1,cz:-75},{side:1,cz:-75},{side:-1,cz:125},{side:1,cz:125},{side:-1,cz:-125},{side:1,cz:-125}];

/* ---- cosmetics, spin wheel, daily rewards, fusion, base looks ---- */
var COS=[
  {id:'h1',k:'hat',n:'Witch Hat',p:2000,c:0x6a2fa0},{id:'h2',k:'hat',n:'Top Hat',p:5000,c:0x1a1a22},
  {id:'h4',k:'hat',n:'Cat Ears',p:8000,c:0x2a2a38},{id:'h5',k:'hat',n:'Devil Horns',p:15000,c:0xd01030},
  {id:'h3',k:'hat',n:'Crown',p:25000,c:0xffd23f},{id:'h6',k:'hat',n:'Halo',p:40000,c:0xfff3a0},
  {id:'h7',k:'hat',n:'Pumpkin Head',p:60000,c:0xf08a1a},
  {id:'a1',k:'aura',n:'Pumpkin Glow',p:4000,c:0xff9a2a},{id:'a2',k:'aura',n:'Ghost Mist',p:12000,c:0xdfe8ff},
  {id:'a3',k:'aura',n:'Toxic Green',p:20000,c:0x6cff3a},{id:'a5',k:'aura',n:'Blood Red',p:50000,c:0xff2040},
  {id:'a4',k:'aura',n:'Rainbow',p:90000,c:0xffffff,rb:1},
  {id:'t1',k:'trail',n:'Candy Sparks',p:3000,c:0xff9a2a},{id:'t2',k:'trail',n:'Bat Dust',p:10000,c:0x9a50ff},
  {id:'t3',k:'trail',n:'Slime',p:18000,c:0x6cff3a},{id:'t5',k:'trail',n:'Fire',p:35000,c:0xff5a1a},
  {id:'t4',k:'trail',n:'Rainbow',p:70000,c:0xffffff,rb:1}
];
var SPIN_MS=1800000;   /* one free spin every 30 minutes */
/* kind: cash = seconds of your income (min floor), box = mystery box of rarity r, cos = random unowned cosmetic */
var SPIN=[
  {n:'Small cash',w:30,kind:'cash',sec:60,min:300,c:'#7dff6a'},
  {n:'Cash bag',w:22,kind:'cash',sec:240,min:900,c:'#4fe8ff'},
  {n:'Common Box',w:14,kind:'box',r:0,c:'#c9d1de'},
  {n:'Epic Box',w:8,kind:'box',r:2,c:'#b968ff'},
  {n:'Big cash',w:10,kind:'cash',sec:900,min:3000,c:'#ffd23f'},
  {n:'Cosmetic',w:8,kind:'cos',c:'#ff9a2a'},
  {n:'Legendary Box',w:4,kind:'box',r:3,c:'#ffb02e'},
  {n:'JACKPOT',w:2,kind:'cash',sec:3600,min:20000,c:'#ff4f7b'},
  {n:'Mythic Box',w:2,kind:'box',r:4,c:'#ff4f7b'}
];
var DAILY={base:1000,secs:90,streakMax:7};   /* reward = max(base, secs of income) x (1 + 0.5 per streak day) */
/* fusion: two brainrots of the same rarity make a random one of the next rarity. these named pairs make a specific one */
var RECIPES=[
  ['Toastini Butterino','Quackadoodle Quackini','Cheesebert Meltini'],
  ['Cheesebert Meltini','Ronaldodo Lililolo','Escargotto Slowpoke'],
  ['George Linini Chellolini','William Stinkyladero','Pumpkino Jackolantern'],
  ['Mushy','Sean Fu Fu Yuan Yuan','Manrajalini Sidhuini'],
  ['Pumpkino Jackolantern','Agam Kahlonini','Draculino Fangsworth'],
  ['Eric The Gao Shao','Austinradero Dyerdodo','Jayden Oxenbridge'],
  ['Draculino Fangsworth','Oliver Turner','Ian M a bombo'],
  ['Ronaldini Bebe','Jayden Oxenbridge','Oliver Le Goblino']
].map(function(r){var f=function(n){for(var i=0;i<SP.length;i++)if(SP[i].n===n)return i;return -1};return {a:f(r[0]),b:f(r[1]),out:f(r[2])}});
/* base looks. -1 = the default colour */
var STYLE={roof:[0xff6b6b,0xffd166,0x4cc9f0,0x80ed99,0xc77dff,0xff9f1c,0xf5f5f5,0x15151c],
  win:[0xffb347,0x8affb0,0xc77dff,0xffffff,0xff4f6a],
  ban:[0xff6b6b,0xffd166,0x4cc9f0,0x80ed99,0xc77dff,0xff9f1c,0xf5f5f5,0x15151c],cost:20000};
var BH={RAR:RAR,SP:SP,PLAN:PLAN,COS:COS,SPIN:SPIN,SPIN_MS:SPIN_MS,DAILY:DAILY,RECIPES:RECIPES,STYLE:STYLE,
  PITY:{3:600,4:1200,5:2700,6:3600},
  WALK_X:7,ENT_X:15,BASE_D:40,BASE_W:30,ZLEN:150,BELT:4.5,ROWS:[9,20,31],
  SPF:15,FLOORS:4,FH:12,                 /* slots per floor, floors per base, floor height */
  LIFT:{xo:4.5,zo:11.5},BTN:{xo:4.5,zo:-11.5},   /* lift and collect-all button, relative to the base entrance */
  LASER_COST:2500,LASER_MS:30000,
  MUT:MUT,PRESTIGE:PRESTIGE,
  WEATHER_MS:300000,           /* each weather event lasts 5 minutes, then 5 minutes of nothing */
  MUT_CHANCE:0.22,             /* chance that a spawn picks up an active mutation */
  LUCKS:[2,3,5,10,15],LUCK_MS:300000,
  BOX_MS:900000,BOX_EVERY:[20,30],   /* a mystery box takes 15 minutes to open; one turns up every 20 to 30 spawns */
  CODE:1000,
  enc:function(sp,mut){return sp+1000*(mut||0)},
  price:function(sp,mut){return Math.round(SP[sp].p*MUT[mut||0].pm)},
  rate:function(sp,mut,pr){return SP[sp].i*MUT[mut||0].m*(1+PRESTIGE.step*(pr||0))}};
if(typeof module!=='undefined'&&module.exports)module.exports=BH;else window.BH=BH;
})();
