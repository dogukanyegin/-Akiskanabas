/* Akışkan’a Bas — HTML5 Canvas, Web Audio ve JavaScript. Flash tarzı hiciv oyunu. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const game = el('game');
  const canvas = el('scene');
  const ctx = canvas.getContext('2d', {alpha: false});
  const photoStatus = el('photo-status');
  const hitButton = el('punch-button');
  const statHits = el('hits');
  const statCoins = el('coins');
  const statCombo = el('combo');
  const menu = el('menu');
  const shade = el('shade');
  let W = 986, H = 660, pxRatio = 1;
  let hits = 0, coins = 0, best = 0, streak = 0, lastStrike = -Infinity;
  let duration = 0, remaining = 0, running = true, paused = false, showMenu = false, fullMotion = true;
  let soundOn = true, musicOn = false, audio = null, musicHandle = null, step = 0;
  let impactAt = -Infinity, impactSign = 1;
  let activePunches = [], bursts = [], floats = [], lastTick = 0;
  let art = null, photoKind = 'fallback', customObjectUrl = null;
  const storeKey = 'akiskana-bas-js-v1';
  try { const s = JSON.parse(localStorage.getItem(storeKey) || '{}'); hits = Math.max(0, +s.hits || 0); coins = Math.max(0, +s.coins || 0); best = Math.max(0, +s.best || 0); }
  catch (_) { /* localStorage devre dışıysa oyunu yine aç */ }
  function save() { try { localStorage.setItem(storeKey, JSON.stringify({hits, coins, best})); } catch (_) {} }
  function loadImage(url, kind) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      art = img; photoKind = kind;
      photoStatus.textContent = kind === 'custom' ? 'SEÇİLEN GÖRSEL' : 'AKIŞKAN · EKRAN GÖRÜNTÜSÜ';
    };
    img.onerror = () => { photoStatus.textContent = 'GÖRSEL YÜKLENEMEDİ'; };
    img.src = url;
  }
  loadImage('assets/akiskan_ekran_goruntusu.webp', 'fallback');
  function resize() {
    const r = game.getBoundingClientRect();
    W = Math.max(200, r.width); H = Math.max(300, r.height);
    pxRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * pxRatio);
    canvas.height = Math.round(H * pxRatio);
    ctx.setTransform(pxRatio, 0, 0, pxRatio, 0, 0);
  }
  window.addEventListener('resize', resize, {passive: true});
  resize();
  function hud() {
    statHits.textContent = hits.toLocaleString('tr-TR');
    statCoins.textContent = coins.toLocaleString('tr-TR');
    statCombo.textContent = `SERİ x${streak}`;
    statCombo.classList.toggle('visible', streak > 1 && performance.now() - lastStrike < 1500);
    el('timer').textContent = duration ? String(Math.ceil(remaining)) + ' sn' : '∞';
    el('time-block').firstChild.textContent = duration ? duration + ' SANİYE MODU ' : 'SONSUZ MOD ';
    el('sound-button').textContent = soundOn ? '🔊' : '🔇';
    el('sound-button').setAttribute('aria-label', soundOn ? 'Sesi kapat' : 'Sesi aç');
    el('menu-sound').textContent = soundOn ? 'Ses: Açık' : 'Ses: Kapalı';
    el('menu-music').textContent = musicOn ? 'Müzik: Açık' : 'Müzik: Kapalı';
  }
  function audioContext() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      if (!audio) audio = new AudioContextClass();
      if (audio.state === 'suspended') audio.resume();
      return audio;
    } catch (_) { return null; }
  }
  function osc(freq, seconds = .10, volume = .09) {
    const a = audioContext(); if (!a) return;
    const o = a.createOscillator(), gain = a.createGain(), t = a.currentTime;
    o.type = 'triangle'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(35, freq * .28), t + seconds);
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(.0001, t + seconds);
    o.connect(gain).connect(a.destination); o.start(t); o.stop(t + seconds + .01);
  }
  function smack() {
    if (!soundOn) return;
    const a = audioContext(); if (!a) return;
    const n = Math.round(a.sampleRate * .10), buffer = a.createBuffer(1, n, a.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    const noise = a.createBufferSource(), low = a.createBiquadFilter(), g = a.createGain();
    noise.buffer = buffer; low.type = 'lowpass'; low.frequency.value = 750; g.gain.value = .21;
    noise.connect(low).connect(g).connect(a.destination); noise.start();
    osc(110, .13, .15);
  }
  function stopMusic() { if (musicHandle) clearInterval(musicHandle); musicHandle = null; }
  function music() {
    stopMusic(); if (!musicOn || paused || showMenu || !running) return;
    const melody = [164.81, 196, 220, 246.94, 220, 196, 146.83, 164.81];
    musicHandle = setInterval(() => { if (soundOn && musicOn && !paused && running && !showMenu) osc(melody[step++ % melody.length], .20, .017); }, 320);
  }
  function setMenu(open) {
    showMenu = !!open; menu.hidden = !open; shade.hidden = !open; el('menu-trigger').setAttribute('aria-expanded', String(open));
    if (open) { paused = true; stopMusic(); }
    else { paused = false; lastTick = performance.now(); music(); }
  }
  function changeMode(seconds) {
    duration = seconds; remaining = seconds; running = true; hits = 0; coins = 0; streak = 0;
    activePunches = []; bursts = []; floats = [];
    el('end-overlay').hidden = true;
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', +b.dataset.mode === seconds));
    save(); hud(); setMenu(false);
  }
  const clamp = (v, low = 0, high = 1) => Math.max(low, Math.min(high, v));
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeIn = t => t * t * t;
  function hit() {
    if (!running || paused || showMenu) return;
    const now = performance.now();
    streak = now - lastStrike <= 1300 ? streak + 1 : 1;
    lastStrike = now; hits++; coins += 10 + (streak % 5 === 0 ? 50 : 0); best = Math.max(best, hits);
    activePunches.push({start: now, side: hits % 2 ? 1 : -1, affected: false, points: 10 + (streak % 5 === 0 ? 50 : 0)});
    hitButton.classList.add('pressed'); window.setTimeout(() => hitButton.classList.remove('pressed'), 80);
    save(); hud();
  }
  function spawnImpact(p, time) {
    p.affected = true;
    impactAt = time; impactSign = p.side;
    smack();
    for (let i = 0; i < 15; i++) {
      const ang = i / 15 * Math.PI * 2 + Math.random() * .4;
      const vel = (110 + Math.random() * 260) * (fullMotion ? 1 : .45);
      bursts.push({x: W*.51, y: H*.43, vx: Math.cos(ang)*vel, vy: Math.sin(ang)*vel, life: .48 + Math.random()*.18, max: .60, radius: 2 + Math.random()*5, color: i%4?'#ffd63e':'#ffffff'});
    }
    floats.push({text:'+' + p.points, x:W*.54 + p.side*18, y:H*.37, born:time});
    floats.push({text: streak%5===0?'SÜPER!':'PAT!', x:W*.46, y:H*.32, born:time, big:true});
  }
  function roundRect(x,y,w,h,r) {ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
  function drawBackground(t) {
    const gradient = ctx.createRadialGradient(W*.50, H*.32, 20, W*.50, H*.55, Math.max(W,H)*.80);
    gradient.addColorStop(0, '#e9f0f3'); gradient.addColorStop(.5, '#b0c4d5'); gradient.addColorStop(1, '#6b8497');
    ctx.fillStyle = gradient; ctx.fillRect(0,0,W,H);
    ctx.save();ctx.globalAlpha = .045;
    for (let x = 0; x < W; x+= 35) {ctx.fillStyle = x%70===0 ? '#fff' : '#163e58';ctx.fillRect(x + Math.sin(t*.0001+x)*7,0,1,H)}
    ctx.restore();
  }
  function drawPortrait(t) {
    if (!art) return;
    const i = art;
    const timeSince = Math.max(0, t - impactAt);
    let recoil = t >= impactAt ? Math.exp(-timeSince/220) * Math.sin(timeSince/70 * Math.PI) : 0;
    if (!fullMotion) recoil *= .35;
    const breath = Math.sin(t/800) * 1.2;
    const direction = impactSign || 1;
    ctx.save();
    ctx.translate(W*.5 + recoil * direction * 28, H*.56 + recoil * 13 + breath);
    ctx.rotate(recoil*direction*.065);
    ctx.scale(1+Math.abs(recoil)*.018,1-Math.abs(recoil)*.009);
    ctx.translate(-W*.5, -H*.56);
    let dw, dh, dx, dy;
    dw = Math.min(W*.95, H*1.36); dh = dw * i.naturalHeight/i.naturalWidth;
    dx = (W-dw)/2; dy = H*.015;
    // Çok küçük gecikmeli yatay görüntü bantları: vuruş anında başın esnemesi.
    const n = 44; const sy = i.naturalHeight/n; const stripH = dh/n;
    for (let k=0; k<n; k++) {
      const normalized = (k+.5)/n;
      const headFactor = Math.sin(Math.PI * clamp((normalized-.02)/.70));
      const warp = fullMotion ? recoil*direction*20*headFactor*Math.sin(normalized*14) : 0;
      ctx.drawImage(i, 0, k*sy, i.naturalWidth, sy+1, dx + warp, dy + k*stripH, dw, stripH+1);
    }
    ctx.restore();
    const fade = ctx.createLinearGradient(0,0,0,H);
    fade.addColorStop(0,'#152c4409');fade.addColorStop(.75,'#152b3510');fade.addColorStop(1,'#05152355');
    ctx.fillStyle=fade; ctx.fillRect(0,0,W,H);
    // Ani ışık parlaması, yumruğun çarptığı tek kare civarı.
    const fadeFlash = t >= impactAt ? Math.max(0, 1 - (t-impactAt)/110) : 0;
    if (fadeFlash && fullMotion) { ctx.globalAlpha = fadeFlash*.16;ctx.fillStyle='#fff9b5';ctx.fillRect(0,0,W,H);ctx.globalAlpha=1; }
  }
  function drawKnockbackLines(t) {
    const delta=t-impactAt;if(!fullMotion||delta<0||delta>220)return;
    const progress=delta/220;ctx.save();ctx.globalAlpha=(1-progress)*.60;ctx.strokeStyle='#fff7ba';ctx.lineWidth=5;
    for(let i=0;i<9;i++){const a = (i/9)*Math.PI*2;const cx=W*.50+Math.cos(a)*50,cy=H*.43+Math.sin(a)*55;
      ctx.beginPath();ctx.moveTo(cx+Math.cos(a)*30*progress,cy+Math.sin(a)*30*progress);
      ctx.lineTo(cx+Math.cos(a)*(80+50*progress),cy+Math.sin(a)*(80+50*progress));ctx.stroke();}
    ctx.restore();
  }
  function drawGlove(cx,cy,scale,side) {
    ctx.save();ctx.translate(cx,cy);ctx.rotate(side*.16);ctx.scale(scale,scale);
    // Kol, elin aşağısından uzanır.
    const arm = ctx.createLinearGradient(-35,55,50,210);
    arm.addColorStop(0,'#f3bd31');arm.addColorStop(1,'#a96d15');
    ctx.fillStyle=arm;ctx.strokeStyle='#66370e';ctx.lineWidth=5;
    roundRect(-32,26,64,160,16);ctx.fill();ctx.stroke();
    ctx.fillStyle='#222f3b';roundRect(-40,102,80,120,11);ctx.fill();
    // Dört ayrı boğumlu ve yüksek ışıklı yumruk.
    const fist = ctx.createRadialGradient(-28,-31,10,0,18,95);
    fist.addColorStop(0,'#ffe88c');fist.addColorStop(.34,'#ffcf42');fist.addColorStop(.78,'#de8d18');fist.addColorStop(1,'#9d5e0d');
    ctx.fillStyle=fist;ctx.strokeStyle='#8e5d19';ctx.lineWidth=4;
    roundRect(-63,-71,126,120,38);ctx.fill();ctx.stroke();
    for(let j=0;j<4;j++){
      ctx.fillStyle=j===0?'#ffdc59':'#ffd04a';roundRect(-56+j*29,-73,34,55,14);ctx.fill();ctx.stroke();
    }
    ctx.fillStyle='#f4b132';roundRect(-67,-3,49,58,20);ctx.fill();ctx.stroke();
    ctx.strokeStyle='#b57415';ctx.lineWidth=3;
    for(let j=0;j<3;j++){ctx.beginPath();ctx.moveTo(-27+j*29,-20);ctx.lineTo(-24+j*29,0);ctx.stroke();}
    ctx.restore();
  }
  function drawPunches(t) {
    activePunches = activePunches.filter(p => t-p.start<680);
    for (const p of activePunches) {
      const age = t-p.start, progress=clamp(age/600);
      if (age>=175 && !p.affected) spawnImpact(p,t);
      let travel;
      if(progress<.31)travel=easeOut(progress/.31);
      else if(progress<.38)travel=1;
      else travel=1-easeIn((progress-.38)/.62);
      const startX=W*(p.side>0?.70:.30),startY=H+155;
      const goalX=W*(.5+p.side*.045),goalY=H*.44;
      const x=startX+(goalX-startX)*travel, y=startY+(goalY-startY)*travel;
      const zoom=(.55 + travel*1.0) * (Math.min(W/986,H/660)*.30 + .70);
      if (progress<.34) {
        ctx.save();ctx.strokeStyle='#fff8ac';ctx.globalAlpha=.26*travel;ctx.lineWidth=5*zoom;
        for(let s=0;s<4;s++){ctx.beginPath();ctx.moveTo(x+p.side*(30+s*22),y+90+s*18);ctx.lineTo(x+p.side*(85+s*24),y+150+s*20);ctx.stroke()};ctx.restore();
      }
      drawGlove(x,y,zoom,p.side);
    }
  }
  function drawParticles(t,dt) {
    ctx.save();
    bursts=bursts.filter(p=>p.life>0);
    for(const p of bursts){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=180*dt;
      ctx.globalAlpha=clamp(p.life/p.max);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.radius,0,Math.PI*2);ctx.fill();}
    ctx.restore();
    floats=floats.filter(p=>t-p.born<800);
    for(const p of floats){const age=(t-p.born)/800;
      ctx.save();ctx.globalAlpha=(1-age)*clamp(age*8);ctx.translate(p.x,p.y-age*86);
      const scale=(p.big?1.5:1.0)*(1+Math.sin(Math.PI*age)*.25);
      ctx.scale(scale,scale);ctx.rotate(Math.sin(age*8)*.035);
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.font='900 43px Impact, Arial Black, sans-serif';
      ctx.strokeStyle='#613b0c';ctx.lineWidth=6;ctx.strokeText(p.text,0,0);
      ctx.fillStyle='#ffd735';ctx.fillText(p.text,0,0);ctx.restore();}
  }
  function frame(t) {
    const dt = lastTick ? clamp((t-lastTick)/1000,0,.055) : 0;
    lastTick=t;
    if (duration && running && !paused && !showMenu) {
      remaining=Math.max(0,remaining-dt);
      if (remaining===0) {
        running=false; stopMusic();el('end-result').textContent=hits.toLocaleString('tr-TR')+' VURUŞ · '+coins.toLocaleString('tr-TR')+' PARA';el('end-overlay').hidden=false;
      }
    }
    if (streak>1 && t-lastStrike>1500){streak=0;statCombo.classList.remove('visible');}
    ctx.setTransform(pxRatio,0,0,pxRatio,0,0);
    drawBackground(t); drawPortrait(t);drawKnockbackLines(t);drawPunches(t);drawParticles(t,dt);hud();
    requestAnimationFrame(frame);
  }
  el('hit-area').addEventListener('pointerdown', ev => {if (ev.isPrimary) hit();});
  hitButton.addEventListener('pointerdown', ev => { ev.preventDefault(); hit(); });
  // Eski tarayıcılarda pointer olayı yoksa click yedeği.
  if (!('PointerEvent' in window)) {
    el('hit-area').addEventListener('click',hit);
    hitButton.addEventListener('click',hit);
  }
  el('menu-trigger').addEventListener('click',()=>setMenu(!showMenu));
  el('close-menu').addEventListener('click',()=>setMenu(false));
  el('resume').addEventListener('click',()=>setMenu(false));
  shade.addEventListener('click',()=>setMenu(false));
  el('restart').addEventListener('click',()=>changeMode(duration));
  el('play-again').addEventListener('click',()=>changeMode(duration));
  document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>changeMode(Number(b.dataset.mode))));
  document.querySelectorAll('[data-motion]').forEach(b=>b.addEventListener('click',()=>{fullMotion=b.dataset.motion==='full'; document.querySelectorAll('[data-motion]').forEach(n=>n.classList.toggle('active',n===b));}));
  const changeSound=()=>{soundOn=!soundOn;hud();if (soundOn)osc(220,.1,.06);};
  el('sound-button').addEventListener('click',changeSound);
  el('menu-sound').addEventListener('click',changeSound);
  const changeMusic=()=>{musicOn=!musicOn;music();hud();};
  el('menu-music').addEventListener('click',changeMusic);
  el('photo-file').addEventListener('change',ev=>{const file=ev.target.files?.[0];if(!file||!file.type.startsWith('image/'))return;
    if(customObjectUrl)URL.revokeObjectURL(customObjectUrl);customObjectUrl=URL.createObjectURL(file);
    loadImage(customObjectUrl,'custom');setMenu(false);
  });
  document.addEventListener('keydown',ev=>{
    if (ev.code==='Escape'){ ev.preventDefault();setMenu(!showMenu);return;}
    if (ev.code==='KeyM' && !ev.repeat){changeMusic();return;}
    if ((ev.code==='Space'||ev.code==='KeyF') && !ev.repeat && !showMenu && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) {
      if(ev.code==='Space' && document.activeElement?.tagName==='BUTTON' && document.activeElement!==hitButton){return;}
      ev.preventDefault();hit();
    }
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){paused=true;stopMusic();}else if(!showMenu){paused=false;lastTick=performance.now();music();}});
  hud(); requestAnimationFrame(frame);
})();
