const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const restartBtn = document.getElementById('restartBtn');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayText = document.getElementById('overlayText');
const sunCountEl = document.getElementById('sunCount');
const plantSelector = document.getElementById('plantSelector');

let WIDTH = 1000, HEIGHT = 600;
let gridCols = 9, gridRows = 5;
let cellW, cellH;
let gameRunning = false;
let lastTime = 0;
let sun = 50;
let selectedPlant = null;

let plantsConfig = null;
let zombiesConfig = null;

// state
let plants = []; // {r,c,config,lastShot}
let bullets = []; // {x,y,vx,vy,damage,radius,ttl}
let zombies = []; // {x,y,type,hp,maxHp,speed,row,spawnedAt}
let particles = [];

let currentWave = 0;
let waveQueue = [];
let waveTimer = 0;
let waveInProgress = false;

function updatePlantSelectorAvailability() {
  if (!plantsConfig) return;

  document.querySelectorAll('.plant-btn').forEach(btn => {
    const plantId = btn.dataset.id;
    const plantCfg = plantsConfig.plants.find(p => p.id === plantId);
    
    if (plantCfg) {
      if (sun < plantCfg.cost) {
        btn.classList.add('locked');
      } else {
        btn.classList.remove('locked');
      }
    }
  });
}

function setSun(newAmount) {
  sun = newAmount;
  sunCountEl.textContent = sun;
  updatePlantSelectorAvailability();
}

async function loadConfigs(){
  plantsConfig = await (await fetch('plants.json')).json();
  zombiesConfig = await (await fetch('zombies.json')).json();
  buildPlantSelector();
  buildWaves();
  setSun(sun);
}

function buildPlantSelector(){
  plantSelector.innerHTML = '';
  plantsConfig.plants.forEach(p=>{
    const btn = document.createElement('div');
    btn.className = 'plant-btn';
    btn.dataset.id = p.id;
    btn.innerHTML = `
      <div class="plant-swatch" style="background:${p.color};width:${p.size}px;height:${p.size}px;border-radius:8px;box-shadow:0 8px 24px ${hexToRgba(p.color,0.18)} inset"></div>
      <div>
        <div class="plant-info">${p.name}</div>
        <div class="plant-cost">${p.cost} sun</div>
      </div>
    `;
    btn.addEventListener('click', ()=> {
      if (sun < p.cost){ btn.classList.add('locked'); flashOverlay('Not enough sun'); return; }
      document.querySelectorAll('.plant-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      selectedPlant = p;
    });
    plantSelector.appendChild(btn);
  });
}

function buildWaves(){
  waveQueue = zombiesConfig.waves.map(w=>Object.assign({}, w));
  currentWave = 0;
  waveInProgress = false;
}

function resize(){
  const cssMaxW = Math.min(1300, window.innerWidth - 120);
  const cssMaxH = Math.min(820, Math.max(480, window.innerHeight * 0.66));
  const cssWidth = Math.max(800, cssMaxW);
  const cssHeight = cssMaxH;

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  WIDTH = cssWidth;
  HEIGHT = cssHeight;

  cellW = WIDTH / gridCols;
  cellH = HEIGHT / gridRows;
}

function gridToXY(r,c){
  const x = c*cellW + cellW/2;
  const y = r*cellH + cellH/2;
  return {x,y};
}

canvas.addEventListener('click', (e)=>{
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const c = Math.floor(x / cellW);
  const r = Math.floor(y / cellH);
  if (selectedPlant){
    if (r<0||r>=gridRows||c<0||c>=gridCols) return;
    const occupied = plants.some(p=>p.r===r && p.c===c);
    if (occupied) { flashOverlay('Cell occupied'); return; }
    if (sun < selectedPlant.cost) { flashOverlay('Not enough sun'); return; }
    placePlant(r,c,selectedPlant);
    
    setSun(sun - selectedPlant.cost);

    document.querySelectorAll('.plant-btn').forEach(b=>b.classList.remove('active'));
    selectedPlant = null;
  } else {
    // clicking canvas without selected plant could pick up sun (future)
  }
});

function placePlant(r,c,config){
  plants.push({r,c,config,lastShot:0, sinceSun:0});
  particles.push({
    x: c*cellW + cellW/2,
    y: r*cellH + cellH/2,
    vx:0, vy:0, life:400, size:24, type:'pulse', color:config.color
  });
}

function spawnZombie(typeId, row, offsetX=0){
  const cfg = zombiesConfig.zombies.find(z=>z.id===typeId);
  const y = row*cellH + cellH*0.6;
  const x = WIDTH + 40 + offsetX;
  zombies.push({x,y,type:cfg.id,hp:cfg.hp,maxHp:cfg.hp,speed:cfg.speed,row:row,spawnedAt:performance.now(), colorBase: cfg.colorBase, reward: cfg.reward});
}

function startNextWave(){
  if (currentWave >= waveQueue.length) { flashOverlay('All waves completed!'); return; }
  const wave = waveQueue[currentWave];
  let spawned = 0;
  waveInProgress = true;
  const interval = wave.interval;
  const spawnInterval = setInterval(()=>{
    if (spawned >= wave.count){ clearInterval(spawnInterval); currentWave++; waveInProgress=false; return; }
    // choose random row
    const row = Math.floor(Math.random()*gridRows);
    // choose type based on simple probability
    const type = Math.random() < 0.75 ? 'triangle' : 'pentagon';
    spawnZombie(type, row, Math.random()*120);
    spawned++;
  }, interval);
}

function update(dt){
  // plant actions
  plants.forEach(p=>{
    // sunflowers
    if (p.config.id === 'sunflower'){
      p.sinceSun += dt;
      if (p.sinceSun > (p.config.sunInterval || 4000)){
        setSun(sun + (p.config.sunPerInterval || 15));
        p.sinceSun = 0;
        particles.push({x: p.c*cellW + cellW/2, y: p.r*cellH + cellH/2 - 10, vx:0, vy:-0.06, life:800, size:10, type:'sun', color:'#FFD36E'});
      }
    }
    p.lastShot += dt;
    if (p.config.rate > 0 && p.lastShot > p.config.rate){
      // find first zombie in row (closest to left)
      const rowZ = zombies.filter(z=>z.row===p.r);
      if (rowZ.length>0){
        const target = rowZ.reduce((a,b)=> a.x<b.x? a:b );
        fireBullet(p, target);
      }
      p.lastShot = 0;
    }
  });

  // bullets
  for (let i=bullets.length-1;i>=0;i--){
    const b = bullets[i];
    b.x += b.vx * (dt/16);
    b.y += b.vy * (dt/16);
    b.ttl -= dt;
    if (b.ttl <= 0 || b.x < -40 || b.x > WIDTH+40){ bullets.splice(i,1); continue; }
    // collisions with zombies
    for (let j=0;j<zombies.length;j++){
      const z = zombies[j];
      if (z.row !== b.row) continue;
      const dist = Math.hypot(z.x - b.x, z.y - b.y);
      if (dist < b.radius + 18){
        z.hp -= b.damage;
        bullets.splice(i,1);
        // hit particles
        particles.push({x: b.x, y: b.y, vx: (Math.random()-0.5)*0.6, vy:(Math.random()-0.5)*0.6, life:500, size:6, type:'spark', color:'#ffffff'});
        break;
      }
    }
  }

  for (let i=zombies.length-1;i>=0;i--){
    const z = zombies[i];
    // if in front of a plant in same cell, "eat" it
    // determine column based on x position
    const col = Math.floor(z.x / cellW);
    const plantIndex = plants.findIndex(p=>p.row===z.row && p.c === col);
    if (plantIndex >= 0){
      // eat plant slowly
      // remove plant after short delay/eating (simplified)
      const victim = plants[plantIndex];
      // create bite particle
      particles.push({x: victim.c*cellW + cellW/2, y: victim.r*cellH + cellH/2, vx:0, vy:0, life:300, size:8, type:'bite', color:'#ffdd88'});
      plants.splice(plantIndex,1);
      // slow down zombie briefly
      z.x += 10;
    } else {
      // move forward smoothly
      z.x -= z.speed * (dt/16) * 60;
    }
    if (z.hp <= 0){
      
      // UPDATED
      setSun(sun + (z.reward || 8));
      
      // death particles
      for (let p=0;p<8;p++){
        particles.push({x: z.x + (Math.random()-0.5)*20, y: z.y + (Math.random()-0.5)*20, vx:(Math.random()-0.5)*1.2, vy:(Math.random()-0.5)*1.2, life:600 + Math.random()*400, size:6, type:'spark', color:'#ffddff'});
      }
      zombies.splice(i,1);
    } else if (z.x < -40){
      // zombie reached left end — penalty (remove random plant in row)
      const idx = plants.findIndex(p=>p.r===z.row);
      if (idx>=0) plants.splice(idx,1);
      zombies.splice(i,1);
    }
  }

  // particles
  for (let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0){ particles.splice(i,1); continue; }
    p.x += (p.vx||0) * (dt/16) * 40;
    p.y += (p.vy||0) * (dt/16) * 40;
    p.size *= 0.995;
  }

  // waves auto-start
  if (!waveInProgress && currentWave < waveQueue.length && gameRunning){
    startNextWave();
  }
}

function fireBullet(p, target){
  const px = p.c*cellW + cellW/2;
  const py = p.r*cellH + cellH/2 - 6;
  const dx = target.x - px;
  const dy = target.y - py;
  const mag = Math.hypot(dx,dy) || 1;
  const speed = p.config.bulletSpeed || 4;
  bullets.push({
    x: px + cellW*0.2,
    y: py,
    vx: (dx/mag)*speed,
    vy: (dy/mag)*speed,
    damage: p.config.damage,
    radius: 7,
    ttl: 4000,
    row: p.r
  });
  // muzzle particle
  particles.push({x: px+6, y: py, vx: (dx/mag)*0.3, vy:(dy/mag)*0.3, life:260, size:6, type:'muzzle', color:'#ffffff'});
}

function drawGrid(){
  // clear any alpha state that could bleed into subsequent draws
  ctx.save();
  ctx.globalAlpha = 1;

  // alternating row fills (use semi-transparent rgba values directly)
  for (let r = 0; r < gridRows; r++){
    ctx.fillStyle = r % 2 === 0
      ? 'rgba(69, 66, 66, 0.62)'
      : 'rgba(17, 15, 15, 0.84)';
    // fill in logical coordinates
    ctx.fillRect(0, r * cellH, WIDTH, cellH);
  }

  // crisp 1px grid lines: draw on 0.5 offsets in logical pixels
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(212, 202, 202, 0.12)';

  // horizontal lines
  for (let r = 0; r <= gridRows; r++){
    const y = Math.round(r * cellH) + 0.5; // 0.5 for sharp 1px
    ctx.beginPath();
    ctx.moveTo(0.5, y);                // start at 0.5 so leftmost line is crisp
    ctx.lineTo(WIDTH - 0.5, y);
    ctx.stroke();
  }

  // vertical lines
  for (let c = 0; c <= gridCols; c++){
    const x = Math.round(c * cellW) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0.5);
    ctx.lineTo(x, HEIGHT - 0.5);
    ctx.stroke();
  }

  ctx.restore();
}

function draw(){
  // background
  ctx.clearRect(0,0,WIDTH,HEIGHT);
  // lanes
  drawGrid();

  // plants
  plants.forEach(p=>{
    const {x,y} = gridToXY(p.r,p.c);
    const s = p.config.size * 0.9;
    // glowing square
    ctx.save();
    ctx.shadowColor = hexToRgba(p.config.color,0.9);
    ctx.shadowBlur = 18;
    roundRect(ctx, x - s/2, y - s/2, s, s, 8, true, false, p.config.color);
    ctx.restore();
  });

  // bullets (glowing)
  bullets.forEach(b=>{
    ctx.save();
    ctx.beginPath();
    const g = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, b.radius*3);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.globalCompositeOperation = 'lighter';
    ctx.arc(b.x, b.y, b.radius*1.6, 0, Math.PI*2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  });

  // zombies
  zombies.forEach(z=>{
    drawPolygon(z.x, z.y, z.type === 'triangle' ? 3 : 5, z.type === 'triangle' ? 22 : 28, z.hp/z.maxHp, z.colorBase);
    // health bar
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(z.x-26, z.y-36, 52, 6);
    ctx.fillStyle = '#ff7a7a';
    ctx.fillRect(z.x-26, z.y-36, 52 * Math.max(0, z.hp / z.maxHp), 6);
  });

  // particles
  particles.forEach(p=>{
    ctx.save();
    if (p.type === 'sun'){
      ctx.beginPath();
      ctx.fillStyle = '#FFD36E';
      ctx.globalAlpha = 0.95;
      ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.fillStyle = p.color || '#fff';
      ctx.globalAlpha = Math.max(0.08, Math.min(1, p.life/600));
      ctx.arc(p.x, p.y, Math.max(1, p.size), 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  });
}

function roundRect(ctx,x,y,w,h,r,fill,stroke, fillColor){
  if (typeof r === 'number') r = {tl:r,tr:r,br:r,bl:r};
  ctx.beginPath();
  ctx.moveTo(x + r.tl, y);
  ctx.lineTo(x + w - r.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r.tr);
  ctx.lineTo(x + w, y + h - r.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
  ctx.lineTo(x + r.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r.bl);
  ctx.lineTo(x, y + r.tl);
  ctx.quadraticCurveTo(x, y, x + r.tl, y);
  ctx.closePath();
  if (fill){
    ctx.fillStyle = fillColor || '#ffffff';
    ctx.fill();
  }
  if (stroke) ctx.stroke();
}

function drawPolygon(cx,cy,sides,radius, healthRatio=1, baseColor='#FF9F7A'){
  ctx.save();
  // color blend from base to darker
  const col = baseColor;
  // convert hex to rgba for shading
  ctx.shadowColor = hexToRgba(col,0.6);
  ctx.shadowBlur = 18;
  ctx.beginPath();
  for (let i=0;i<sides;i++){
    const ang = (i/sides) * Math.PI*2 - Math.PI/2;
    const px = cx + Math.cos(ang)*radius;
    const py = cy + Math.sin(ang)*radius;
    if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  }
  ctx.closePath();
  // fill with gradient depending on health
  const g = ctx.createLinearGradient(cx-radius, cy-radius, cx+radius, cy+radius);
  g.addColorStop(0, hexToRgba(col, 0.95));
  g.addColorStop(1, hexToRgba('#111827', 1 - healthRatio*0.6));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

function flashOverlay(txt){
  overlayTitle.textContent = txt;
  overlayText.textContent = '';
  overlay.classList.remove('hidden');
  setTimeout(()=> overlay.classList.add('hidden'), 900);
}

function hexToRgba(hex, alpha){
  hex = hex.replace('#','');
  if (hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
  const r = parseInt(hex.substring(0,2),16);
  const g = parseInt(hex.substring(2,4),16);
  const b = parseInt(hex.substring(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function gameLoop(t){
  if (!lastTime) lastTime = t;
  const dt = t - lastTime;
  lastTime = t;
  if (gameRunning){
    update(dt);
  }
  draw();
  requestAnimationFrame(gameLoop);
}

startBtn.addEventListener('click', ()=>{
  gameRunning = true;
  overlay.classList.add('hidden');
  overlayTitle.textContent = 'Running';
});
pauseBtn.addEventListener('click', ()=>{
  gameRunning = false;
  overlay.classList.remove('hidden');
  overlayTitle.textContent = 'Paused';
});
restartBtn.addEventListener('click', ()=>{
  plants = []; bullets=[]; zombies=[]; particles=[]; currentWave=0;
  buildWaves();
  
  setSun(50); // This now resets sun, updates text, AND updates buttons
  
  gameRunning = false;
  overlay.classList.remove('hidden'); overlayTitle.textContent='Restarted';
});

// initial
window.addEventListener('resize', resize);
resize();
loadConfigs();
requestAnimationFrame(gameLoop);
