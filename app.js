/* Sawgrass Route & Deals - app logic */
const STORE_RADIUS = 7;
const SELECTED_RADIUS = 9;
const PATH_WIDTH = 3;

let stores = [];
let corridors = []; // walkable graph edges between coordinate nodes
let selectedIds = new Set();
let startNode = 'Entrance A';

const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');
const storeListEl = document.getElementById('storeList');
const searchInput = document.getElementById('searchInput');
const computeBtn = document.getElementById('computeBtn');
const clearBtn = document.getElementById('clearBtn');
const startSelect = document.getElementById('startSelect');
const routeStepsEl = document.getElementById('routeSteps');
const totalsEl = document.getElementById('totals');
const couponDialog = document.getElementById('couponDialog');
const couponTitle = document.getElementById('couponTitle');
const couponBody = document.getElementById('couponBody');

/* PWA install prompt */
let deferredPrompt;
const installBtn = document.getElementById('installBtn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.classList.remove('hidden');
});
installBtn?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  installBtn.classList.add('hidden');
});

/* Load data */
async function loadData() {
  const s = await fetch('data/stores.json').then(r => r.json());
  stores = s.stores;
  corridors = s.corridors;
  buildStoreList();
  buildStartOptions(s.starts);
  draw();
}

function buildStartOptions(starts){
  startSelect.innerHTML = '';
  for(const start of starts){
    const opt = document.createElement('option');
    opt.value = start.id;
    opt.textContent = start.name;
    startSelect.appendChild(opt);
  }
  startSelect.value = startNode;
  startSelect.addEventListener('change', ()=>{
    startNode = startSelect.value;
    draw();
  });
}

function buildStoreList(filter = '') {
  storeListEl.innerHTML = '';
  const query = filter.trim().toLowerCase();
  for (const st of stores) {
    if (query && !(`${st.name} ${st.zone}`.toLowerCase().includes(query))) continue;
    const row = document.createElement('div');
    row.className = 'store';
    row.innerHTML = `<div>
        <h3>${st.name}</h3>
        <small>${st.zone} • ${st.category}</small>
      </div>`;
    const actions = document.createElement('div');
    actions.className = 'store-actions';

    const selectBtn = document.createElement('button');
    selectBtn.className = 'icon-btn';
    const updateSelectUI = () => {
      const picked = selectedIds.has(st.id);
      selectBtn.textContent = picked ? '✓ Added' : 'Add';
      selectBtn.ariaPressed = picked ? 'true' : 'false';
      row.style.background = picked ? '#fff7f2' : '#f7fbfa';
    };
    selectBtn.addEventListener('click', () => {
      if (selectedIds.has(st.id)) selectedIds.delete(st.id);
      else selectedIds.add(st.id);
      updateSelectUI();
      draw();
    });
    updateSelectUI();

    const couponBtn = document.createElement('button');
    couponBtn.className = 'icon-btn';
    couponBtn.textContent = 'Coupons';
    couponBtn.addEventListener('click', () => showCoupons(st));

    actions.append(selectBtn, couponBtn);
    row.append(actions);
    storeListEl.append(row);
  }
}

searchInput.addEventListener('input', (e)=> buildStoreList(e.target.value));

function showCoupons(store){
  couponTitle.textContent = `${store.name} • Coupons`;
  couponBody.innerHTML = '';
  if(!store.coupons || store.coupons.length === 0){
    const p = document.createElement('p');
    p.textContent = 'No coupons currently available for this store.';
    couponBody.append(p);
  } else {
    for(const c of store.coupons){
      const card = document.createElement('div');
      card.className = 'coupon';
      card.innerHTML = `<h4>${c.title}</h4>
        <p>${c.desc}</p>
        <p><strong>Code:</strong> ${c.code} • <strong>Expires:</strong> ${c.expires}</p>`;
      couponBody.append(card);
    }
  }
  couponDialog.showModal();
}

/* Geometry helpers */
function drawNode(x,y,color,radius){
  ctx.beginPath();
  ctx.arc(x,y,radius,0,Math.PI*2);
  ctx.fillStyle = color;
  ctx.fill();
}
function drawLine(a,b,color,width){
  ctx.beginPath();
  ctx.moveTo(a.x,a.y);
  ctx.lineTo(b.x,b.y);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function draw(){
  ctx.clearRect(0,0,canvas.width, canvas.height);
  // draw corridors
  ctx.globalAlpha = 0.2;
  for(const e of corridors){
    drawLine(e.a, e.b, '#000', 18);
  }
  ctx.globalAlpha = 1;

  // draw path if exists
  if(window.currentPath && window.currentPath.length > 1){
    for(let i=0;i<window.currentPath.length-1;i++){
      const a = window.currentPath[i];
      const b = window.currentPath[i+1];
      drawLine(a, b, '#1565c0', PATH_WIDTH);
    }
  }

  // draw stores
  for(const st of stores){
    const isSelected = selectedIds.has(st.id);
    drawNode(st.x, st.y, isSelected ? '#ff7043' : '#0E7C7B', isSelected ? SELECTED_RADIUS : STORE_RADIUS);
  }
  // draw starts
  for(const start of window.startsData){
    drawNode(start.x, start.y, start.id === startNode ? '#7b1fa2' : '#9c27b0', 8);
  }
}

function distance(p, q){
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  return Math.hypot(dx, dy);
}

function computeRoute(){
  // Build list of points: start + selected stores
  const start = window.startsData.find(s => s.id === startNode);
  const selectedStores = stores.filter(s => selectedIds.has(s.id));
  if(selectedStores.length === 0){
    routeStepsEl.innerHTML = '<li>Select at least one store.</li>';
    window.currentPath = [];
    draw();
    totalsEl.textContent = '';
    return;
  }
  // Greedy nearest-neighbor from start
  let path = [start];
  let remaining = [...selectedStores];
  let cur = start;
  while(remaining.length){
    remaining.sort((a,b)=> distance(cur,a)-distance(cur,b));
    const next = remaining.shift();
    path.push(next);
    cur = next;
  }

  // Optional 2-opt improvement
  const algo = document.querySelector('input[name="algo"]:checked')?.value || 'nn';
  if(algo === 'twoopt'){
    path = twoOpt(path);
  }

  // Compute totals & steps
  window.currentPath = path;
  draw();
  routeStepsEl.innerHTML = '';
  let total = 0;
  for(let i=0;i<path.length-1;i++){
    const from = path[i], to = path[i+1];
    const leg = distance(from, to);
    total += leg;
    const li = document.createElement('li');
    li.innerHTML = `<strong>${i+1}.</strong> ${from.name || from.id} → <em>${to.name || to.id}</em> <small>(${leg.toFixed(0)} ft est.)</small>`;
    routeStepsEl.append(li);
  }
  totalsEl.textContent = `Estimated walking: ${total.toFixed(0)} ft • ~${Math.round(total/225)} min (at ~3 mph)`;
}

function twoOpt(path){
  // Simple 2-opt implementation (do not move start at index 0)
  let improved = true;
  const pts = [...path];
  while(improved){
    improved = false;
    for(let i=1;i<pts.length-2;i++){
      for(let k=i+1;k<pts.length-1;k++){
        const d1 = distance(pts[i-1], pts[i]) + distance(pts[k], pts[k+1]);
        const d2 = distance(pts[i-1], pts[k]) + distance(pts[i], pts[k+1]);
        if(d2 < d1){
          const rev = pts.slice(i, k+1).reverse();
          pts.splice(i, k-i+1, ...rev);
          improved = true;
        }
      }
    }
  }
  return pts;
}

computeBtn.addEventListener('click', computeRoute);
clearBtn.addEventListener('click', ()=>{
  selectedIds.clear(); buildStoreList(searchInput.value); window.currentPath = []; draw();
  routeStepsEl.innerHTML=''; totalsEl.textContent='';
});

/* Initialize */
window.addEventListener('resize', ()=> draw());
loadData();

/* Expose starts for drawing */
window.startsData = [];

window.startsData = [
  {
    "id": "Entrance A",
    "name": "Entrance A (Fashion Ave)",
    "x": 80,
    "y": 340
  },
  {
    "id": "Entrance B",
    "name": "Entrance B (Oasis)",
    "x": 600,
    "y": 60
  },
  {
    "id": "Entrance C",
    "name": "Entrance C (Colonnade)",
    "x": 1080,
    "y": 360
  }
];
