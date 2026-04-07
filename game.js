(function(){
'use strict';
if (typeof THREE === 'undefined') {
  alert('Three.js の読み込みに失敗しました。通信状態を確認して再読み込みしてください。');
  return;
}

const SAVE_PREFIX = 'yoiyado_b1_smartphone_slot_';
const TAU = Math.PI * 2;

const canvas = document.getElementById('game-canvas');
const hud = document.getElementById('hud');
const promptEl = document.getElementById('prompt');
const areaLabelEl = document.getElementById('area-label');
const phaseLabelEl = document.getElementById('phase-label');
const dayLabelEl = document.getElementById('day-label');
const distanceLabelEl = document.getElementById('distance-label');
const minimap = document.getElementById('minimap');
const minimapCtx = minimap.getContext('2d');
const menuBtn = document.getElementById('menu-btn');
const menuOverlay = document.getElementById('menu');
const dialogueOverlay = document.getElementById('dialogue');
const portraitEl = document.getElementById('portrait');
const dialogueNameEl = document.getElementById('dialogue-name');
const dialogueTextEl = document.getElementById('dialogue-text');
const gameOverEl = document.getElementById('gameover');
const endingEl = document.getElementById('ending');
const slotOverlay = document.getElementById('slot-overlay');
const slotTitleEl = document.getElementById('slot-title');
const slotNoteEl = document.getElementById('slot-note');
const slotListEl = document.getElementById('slot-list');
const returnHomeEl = document.getElementById('return-home');
const actBtn = document.getElementById('act-btn');
const lookZone = document.getElementById('look-zone');
const joystickBase = document.getElementById('joystick-base');
const joystickKnob = document.getElementById('joystick-knob');
const joystickZone = document.getElementById('joystick-zone');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06080d);
scene.fog = new THREE.Fog(0x080a10, 16, 42);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 90);
const player = { x: 0, z: 0, yaw: 0, pitch: 0, height: 1.62, radius: 0.33, speed: 2.6, run: 1.32 };

const rootGroup = new THREE.Group();
scene.add(rootGroup);
const areaGroup = new THREE.Group();
const dynamicGroup = new THREE.Group();
rootGroup.add(areaGroup);
rootGroup.add(dynamicGroup);

const hemi = new THREE.HemisphereLight(0xbdd2ff, 0x2f2419, 0.7);
scene.add(hemi);
const dirLight = new THREE.DirectionalLight(0xfff0da, 0.9);
dirLight.position.set(6, 10, 5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
dirLight.shadow.camera.left = -18;
dirLight.shadow.camera.right = 18;
dirLight.shadow.camera.top = 18;
dirLight.shadow.camera.bottom = -18;
scene.add(dirLight);

const state = {
  area: 'lobby',
  day: 1,
  phaseLabel: '昼勤務',
  step: 'talk_okami',
  hudHidden: false,
  menuOpen: false,
  dialogueQueue: [],
  checkpoint: null,
  chase: null,
  slotMode: null,
  guide: null,
  lastDoorId: null,
  doorCooldownUntil: 0,
  inputLockUntil: 0,
  questFlags: {},
  ended: false
};

const input = {
  keys: Object.create(null),
  lookDragging: false,
  lookId: null,
  joyId: null,
  joyX: 0,
  joyY: 0,
  pointerX: 0,
  pointerY: 0,
  mouseDrag: false,
  interactQueued: false
};

const colliders = [];
const doors = [];
const npcs = [];
const items = [];
const areaAnchors = {};
const graph = {
  home: { town: 12 },
  town: { home: 12, lobby: 18 },
  lobby: { town: 18, corridor: 12, kitchen: 8, archive: 9 },
  kitchen: { lobby: 8 },
  corridor: { lobby: 12, room201: 6, room202: 7, bath: 12, north: 13 },
  room201: { corridor: 6 },
  room202: { corridor: 7 },
  bath: { corridor: 12 },
  archive: { lobby: 9, detached: 14 },
  north: { corridor: 13, detached: 8 },
  detached: { north: 8, archive: 14 }
};

const areaLabels = {
  home: '自宅', town: '田舎町', lobby: '帳場', kitchen: '厨房', corridor: '客室廊下', room201: '201号室', room202: '202号室', bath: '浴場前', archive: '宿帳庫', north: '北廊下', detached: '離れ通路'
};

const stepDefs = {
  start_note: { day: 1, phase: '出勤前', text: '机の読み物で今日の予定を確認する', sub: '机へ', targetArea: 'home', targetPos: { x: -1.7, z: -1.8 }, trigger: { type: 'item', id: 'scheduleNote' } },
  leave_home: { day: 1, phase: '出勤前', text: '玄関から外へ出る', sub: '玄関へ', targetArea: 'home', targetPos: { x: 4.4, z: 1.1 }, trigger: { type: 'door', id: 'homeToTown' } },
  walk_to_ryokan: { day: 1, phase: '出勤前', text: '田舎町を歩いて旅館へ向かう', sub: '旅館入口へ', targetArea: 'town', targetPos: { x: 12.7, z: 4.2 }, trigger: { type: 'door', id: 'townToLobby' } },
  talk_okami: { day: 1, phase: '昼勤務', text: '女将に話しかける', sub: '帳場へ', targetArea: 'lobby', targetPos: { x: 0, z: -2 }, trigger: { type: 'npc', id: 'okami' } },
  get_tray: { day: 1, phase: '昼勤務', text: '厨房でお茶の盆を受け取る', sub: '厨房へ', targetArea: 'kitchen', targetPos: { x: 0, z: -1 }, trigger: { type: 'item', id: 'tray' } },
  deliver_201: { day: 1, phase: '昼勤務', text: '201号室の客にお茶を届ける', sub: '201号室へ', targetArea: 'room201', targetPos: { x: 0, z: -1.8 }, trigger: { type: 'npc', id: 'guest201' } },
  report_okami: { day: 1, phase: '昼勤務', text: '帳場へ戻って女将に報告する', sub: '帳場へ', targetArea: 'lobby', targetPos: { x: 0, z: -2 }, trigger: { type: 'npc', id: 'okami' } },
  stock_amenities: { day: 1, phase: '昼勤務', text: '帳場横の戸棚から客用備品袋を受け取る', sub: '帳場の戸棚へ', targetArea: 'lobby', targetPos: { x: -5.6, z: 4.2 }, trigger: { type: 'item', id: 'amenityBag' } },
  place_amenities: { day: 1, phase: '昼勤務', text: '客室廊下の備品箱へ客用備品を補充する', sub: '客室廊下へ', targetArea: 'corridor', targetPos: { x: -6.3, z: 2.4 }, trigger: { type: 'item', id: 'amenityBox' } },
  arrange_slippers: { day: 1, phase: '昼勤務', text: '客室廊下入口の下駄箱前でスリッパを揃える', sub: '客室廊下へ', targetArea: 'corridor', targetPos: { x: -9.4, z: -3.2 }, trigger: { type: 'item', id: 'slipperRack' } },
  restock_towels: { day: 1, phase: '昼勤務', text: '浴場前の棚に替えタオルを補充する', sub: '浴場前へ', targetArea: 'bath', targetPos: { x: 2.5, z: 2.6 }, trigger: { type: 'item', id: 'towelShelf' } },
  answer_phone: { day: 1, phase: '夕方', text: '浴場前の黒電話に出る', sub: '浴場前へ', targetArea: 'bath', targetPos: { x: 2.5, z: -2.5 }, trigger: { type: 'item', id: 'phone' } },
  inspect_archive: { day: 1, phase: '深夜調査', text: '宿帳庫で青い宿帳を探す', sub: '宿帳庫へ', targetArea: 'archive', targetPos: { x: 0, z: -3 }, trigger: { type: 'item', id: 'blueLedger' } },
  escape_archive: { day: 1, phase: '深夜追跡', text: '誘導員から逃げて帳場へ戻る', sub: '帳場へ', targetArea: 'lobby', targetPos: { x: 0, z: -2 }, trigger: { type: 'npc', id: 'okami' } },
  sleep_day1: { day: 1, phase: '帰宅', text: '布団で眠って体を休める', sub: '布団へ', targetArea: 'home', targetPos: { x: -0.2, z: -0.9 }, trigger: { type: 'item', id: 'futonBed' } },
  leave_home_day2: { day: 2, phase: '出勤前', text: '玄関から外へ出る', sub: '玄関へ', targetArea: 'home', targetPos: { x: 4.4, z: 1.1 }, trigger: { type: 'door', id: 'homeToTown' } },
  commute_day2: { day: 2, phase: '出勤前', text: '田舎町を歩いて旅館へ向かう', sub: '旅館入口へ', targetArea: 'town', targetPos: { x: 12.7, z: 4.2 }, trigger: { type: 'door', id: 'townToLobby' } },
  talk_maid: { day: 2, phase: '昼勤務', text: '廊下で仲居に昨夜のことを聞く', sub: '客室廊下へ', targetArea: 'corridor', targetPos: { x: 0, z: 0 }, trigger: { type: 'npc', id: 'maid' } },
  get_breakfast202: { day: 2, phase: '昼勤務', text: '厨房で202号室の朝食膳を受け取る', sub: '厨房へ', targetArea: 'kitchen', targetPos: { x: 0, z: -1 }, trigger: { type: 'item', id: 'breakfastTray' } },
  deliver_202: { day: 2, phase: '昼勤務', text: '202号室へ朝食を運ぶ', sub: '202号室へ', targetArea: 'room202', targetPos: { x: 0, z: -1.8 }, trigger: { type: 'npc', id: 'guest202' } },
  collect_lost_item: { day: 2, phase: '昼勤務', text: '廊下に落ちた鍵束を回収する', sub: '客室廊下へ', targetArea: 'corridor', targetPos: { x: 3.1, z: 1.2 }, trigger: { type: 'item', id: 'lostKey' } },
  inspect_register: { day: 2, phase: '夕方', text: '帳場で宿帳を照合する', sub: '帳場へ', targetArea: 'lobby', targetPos: { x: 1.2, z: -4.2 }, trigger: { type: 'item', id: 'registerBook' } },
  inspect_north: { day: 2, phase: '夕方', text: '北廊下の閉ざされた札を調べる', sub: '北廊下へ', targetArea: 'north', targetPos: { x: 0, z: -2.5 }, trigger: { type: 'item', id: 'sealTag' } },
  inspect_detached: { day: 2, phase: '深夜調査', text: '離れ通路の祠を調べる', sub: '離れ通路へ', targetArea: 'detached', targetPos: { x: 0, z: -3 }, trigger: { type: 'item', id: 'altar' } },
  escape_detached: { day: 2, phase: '深夜追跡', text: '誘導員から逃げて帳場へ戻る', sub: '帳場へ', targetArea: 'lobby', targetPos: { x: 0, z: -2 }, trigger: { type: 'npc', id: 'okami' } },
  finale: { day: 2, phase: '終幕', text: '女将に宿帳のことを問いただす', sub: '帳場へ', targetArea: 'lobby', targetPos: { x: 0, z: -2 }, trigger: { type: 'npc', id: 'okami' } }
};

const storyNodes = {
  home_note: [
    ['主人公', `今日から、山あいの古い旅館で住み込みの仕事が始まる。
寮ではなく、自宅から数日通うことになった。`, 'hero'],
    ['主人公', `女将からの手紙。
「昼前までに帳場へ。北廊下には夜まで近づかないこと」`, 'hero']
  ],
  okami_intro: [
    ['女将', `よう来たね。ここは人手が足りていない。
今夜から帳場の手伝いをしてもらう。`, 'okami'],
    ['女将', `まずは厨房へ行って、201号室へお茶の盆を届けておくれ。
戻ったら備品袋、下駄箱、浴場前の替えタオルまでまとめて頼むよ。`, 'okami']
  ],
  tray: [
    ['料理番', `女将さんから聞いてるよ。
盆を持ったら、こぼさないようにまっすぐ201へ。`, 'chef']
  ],
  guest201: [
    ['201号室の客', `……遅かったな。
今朝からこの宿、変な音がする。壁の向こうを誰か歩いてる。`, 'guest'],
    ['201号室の客', `さっきも、赤と白の旗を持った男が廊下の先に立っていた。
宿の人間なら妙な格好だ。`, 'guest']
  ],
  report_okami: [
    ['女将', `客の話は気にしなくていい。
古い建物だから、音はいろいろ響くものさ。`, 'okami'],
    ['女将', `その前に、帳場横の戸棚から客用備品を持って廊下の備品箱へ。
入口のスリッパも揃えておくれ。最後に浴場前の棚へ替えタオルだ。`, 'okami']
  ],
  amenityBag: [
    ['主人公', `歯ブラシ、髭剃り、巾着入りの茶葉。
客用備品袋を戸棚から受け取った。`, 'hero']
  ],
  amenityBox: [
    ['主人公', `廊下の備品箱へ客用備品を補充した。
一番下の段に、見覚えのない古い札が一枚混ざっている。`, 'hero']
  ],
  slippers: [
    ['主人公', `乱れていたスリッパを番号順に並べ直した。
一足だけ、濡れた足跡がついたまま乾いていない。`, 'hero']
  ],
  towel: [
    ['主人公', `替えタオルを棚へ積み直した。
湿った匂いの中で、遠くから黒電話のベルが一度だけ鳴った。`, 'hero']
  ],
  phone: [
    ['黒電話', `――……カタン。
受話器の向こうから、誰かの息だけが聞こえる。`, 'phone'],
    ['低い声', `宿帳を、見るな。……いや、見ろ。
北の札より先に、帳場の奥を確かめろ。`, 'phone']
  ],
  villager: [
    ['町の住民', `あの旅館に行くのかい。朝は静かでいい宿に見えるだろう。
でも夜になると、北側の窓だけ誰もいないのに明かりが点くんだ。`, 'villager'],
    ['町の住民', `赤と白の旗を振る誘導員の噂、聞いたことはないか。
火事の夜からずっと、道を間違えた人を連れていくって話さ。`, 'villager']
  ],
  blueLedger: [
    ['主人公', `青い宿帳だ。
同じ名前が、年を跨いで何度も記されている。`, 'hero'],
    ['主人公', `ページの端に、赤いインクで「誘導員に従うな」とある。`, 'hero']
  ],
  escape_archive: [
    ['女将', `見たのかい。
それなら、今夜のうちに家へ戻って休みな。`, 'okami'],
    ['女将', `明日になったら、廊下の仲居にだけ話を聞いておくれ。
他の客には悟られないように。`, 'okami']
  ],
  sleep_day1: [
    ['主人公', `布団へ倒れこむ。
提灯の残像と、赤白の旗が瞼の裏に焼きついている。`, 'hero'],
    ['主人公', `……翌朝。
またあの旅館へ向かわなければならない。`, 'hero']
  ],
  maid: [
    ['仲居', `昨夜、帳場の灯りが消えたあと……北廊下の奥で、旗が擦れる音がしました。`, 'maid'],
    ['仲居', `昔の火事で死んだ誘導員の噂、聞いたことありますか。
道を誤らせる男です。`, 'maid']
  ],
  breakfast202: [
    ['料理番', `202の客は朝にうるさい。粥と焼き魚、味噌汁をこぼさず運んでくれ。`, 'chef']
  ],
  guest202: [
    ['202号室の客', `昨夜の二時過ぎ、誰かが廊下を走っていた。
だが足音は一人分じゃなかった。`, 'guest'],
    ['202号室の客', `朝になっても、部屋の外に濡れた旗の繊維が落ちていた。`, 'guest']
  ],
  lostKey: [
    ['主人公', `廊下で小さな鍵束を拾った。
裏に「離れ 予備」と刻まれている。`, 'hero']
  ],
  registerCheck: [
    ['主人公', `宿帳の宿泊数を数え直す。201と202しか使っていないはずなのに、203の朝食数まで記されている。`, 'hero'],
    ['主人公', `今朝チェックインした記録の末尾に、自分の名前がもう一度書かれていた。`, 'hero']
  ],
  sealTag: [
    ['主人公', `閉ざされた札の裏に、細い鍵が隠されている。
札そのものは焦げた匂いがする。`, 'hero']
  ],
  altar: [
    ['主人公', `離れの祠の下に、宿帳の切れ端と写真がある。
女将と、見覚えのない誘導員の写真だ。`, 'hero'],
    ['主人公', `足音。……また来る。`, 'hero']
  ],
  finale: [
    ['女将', `あれは追う者ではなく、連れていく者だよ。
昔この宿で、客を避難させるはずだった男さ。`, 'okami'],
    ['女将', `火事の夜、誰も救えなかった。
だから今も、間違った道へ客を導こうとする。`, 'okami'],
    ['女将', `……宿帳は預かっておく。
続きは、明日の夜に。`, 'okami']
  ]
};

const faceTextures = {
  okami: makeFaceTexture('#f0d7c6', '#201515', '#7b2932', 'okami'),
  maid: makeFaceTexture('#efd5c2', '#1e2228', '#63543f', 'maid'),
  guest: makeFaceTexture('#e8d0bc', '#16191d', '#4d4d4d', 'guest'),
  guide: makeFaceTexture('#d5dce5', '#4b0d0d', '#98a4b4', 'guide'),
  chef: makeFaceTexture('#ebdccb', '#1a1a1a', '#ffffff', 'chef'),
  villager: makeFaceTexture('#e4ccb6', '#1d1f22', '#6c7d52', 'villager'),
  hero: makeFaceTexture('#e7d0bc', '#1d1d1d', '#303030', 'hero'),
  phone: makeFaceTexture('#0f1216', '#d7d7d7', '#0f1216', 'phone')
};

function makeFaceTexture(skin, eye, accent, type) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = skin;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = eye;
  if (type === 'guide') {
    g.fillRect(84, 110, 20, 12);
    g.fillRect(152, 110, 20, 12);
    g.fillStyle = '#7a0e12';
    g.fillRect(96, 156, 64, 8);
  } else {
    g.fillRect(86, 100, 18, 10);
    g.fillRect(152, 100, 18, 10);
    g.fillStyle = '#8b544d';
    g.fillRect(106, 152, 44, 6);
  }
  g.fillStyle = accent;
  if (type === 'okami') {
    g.fillRect(44, 42, 168, 34);
  } else if (type === 'maid') {
    g.fillRect(36, 28, 184, 42);
  } else if (type === 'guest') {
    g.fillRect(28, 30, 200, 36);
  } else if (type === 'guide') {
    g.fillRect(54, 10, 148, 44);
    g.fillStyle = '#ffffff';
    g.fillRect(112, 58, 32, 22);
  } else if (type === 'chef') {
    g.fillRect(58, 18, 140, 30);
    g.fillStyle = '#ffffff';
    g.fillRect(74, 0, 108, 34);
  } else if (type === 'villager') {
    g.fillRect(30, 28, 196, 40);
    g.fillStyle = '#d7c2a4';
    g.fillRect(96, 176, 64, 12);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const materials = {
  wood: new THREE.MeshStandardMaterial({ map: makeWoodTexture(512, 512), roughness: 0.88 }),
  darkWood: new THREE.MeshStandardMaterial({ map: makeWoodTexture(512, 512, true), roughness: 0.92 }),
  shoji: new THREE.MeshStandardMaterial({ map: makeShojiTexture(512, 512), roughness: 0.98 }),
  tatami: new THREE.MeshStandardMaterial({ map: makeTatamiTexture(512, 512), roughness: 1 }),
  tile: new THREE.MeshStandardMaterial({ map: makeTileTexture(512, 512), roughness: 0.95 }),
  carpet: new THREE.MeshStandardMaterial({ map: makeCarpetTexture(512, 512), roughness: 1 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x6e9660, roughness: 1 }),
  bark: new THREE.MeshStandardMaterial({ color: 0x5a402f, roughness: 1 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x3f6b40, roughness: 1 }),
  wallWarm: new THREE.MeshStandardMaterial({ color: 0xdac7a2, roughness: 1 }),
  wallRose: new THREE.MeshStandardMaterial({ color: 0xb78587, roughness: 1 }),
  wallDark: new THREE.MeshStandardMaterial({ color: 0x3a2d23, roughness: 1 }),
  black: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc9a96e, roughness: 0.45, metalness: 0.4 }),
  paper: new THREE.MeshStandardMaterial({ color: 0xf6f0df, roughness: 1 })
};

function makeWoodTexture(w, h, dark){
  const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d');
  const base=dark? '#4a3729':'#7a5b42';
  const hi=dark? '#5c4837':'#946f52';
  const lo=dark? '#37271d':'#654c39';
  g.fillStyle=base; g.fillRect(0,0,w,h);
  for(let i=0;i<260;i++){
    g.fillStyle = i%3===0? hi: lo;
    const y = Math.random()*h;
    g.fillRect(0,y,w,Math.random()*2+1);
  }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(2,2); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
function makeShojiTexture(w,h){
  const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d');
  g.fillStyle='#f1ebdc'; g.fillRect(0,0,w,h);
  g.strokeStyle='#5c3d23'; g.lineWidth=10;
  for(let x=0;x<=w;x+=w/4){ g.beginPath(); g.moveTo(x,0); g.lineTo(x,h); g.stroke(); }
  for(let y=0;y<=h;y+=h/4){ g.beginPath(); g.moveTo(0,y); g.lineTo(w,y); g.stroke(); }
  const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace; return tex;
}
function makeTatamiTexture(w,h){
  const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d');
  g.fillStyle='#8a8c6a'; g.fillRect(0,0,w,h);
  for(let i=0;i<600;i++){
    g.strokeStyle = i%2? 'rgba(85,92,62,.5)' : 'rgba(137,144,106,.38)';
    g.beginPath(); const x=Math.random()*w; g.moveTo(x,0); g.lineTo(x+Math.random()*20-10,h); g.stroke();
  }
  const tex=new THREE.CanvasTexture(c); tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.repeat.set(2,2); tex.colorSpace=THREE.SRGBColorSpace; return tex;
}
function makeTileTexture(w,h){
  const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d');
  g.fillStyle='#6e6f72'; g.fillRect(0,0,w,h); g.strokeStyle='rgba(255,255,255,.08)';
  for(let x=0;x<=w;x+=64){g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();}
  for(let y=0;y<=h;y+=64){g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke();}
  const tex=new THREE.CanvasTexture(c); tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.repeat.set(4,4); tex.colorSpace=THREE.SRGBColorSpace; return tex;
}
function makeCarpetTexture(w,h){
  const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d');
  g.fillStyle='#3b1c1c'; g.fillRect(0,0,w,h);
  for(let i=0;i<1000;i++){ g.fillStyle = i%2?'rgba(120,40,40,.18)':'rgba(50,12,12,.18)'; g.fillRect(Math.random()*w, Math.random()*h, 2, 2);}  
  const tex=new THREE.CanvasTexture(c); tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.repeat.set(3,3); tex.colorSpace=THREE.SRGBColorSpace; return tex;
}

function clearArray(arr){ arr.length = 0; }
function disposeHierarchy(obj){ obj.traverse(child => { if (child.geometry) child.geometry.dispose?.(); }); }

function addCollider(x1,z1,x2,z2){ colliders.push({ x1: Math.min(x1,x2), z1: Math.min(z1,z2), x2: Math.max(x1,x2), z2: Math.max(z1,z2) }); }
function addBoxCollider(x,z,w,d){ addCollider(x - w/2, z - d/2, x + w/2, z + d/2); }

function createFloor(width, depth, material, y){
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.2, depth), material);
  mesh.position.set(0, y || -0.1, 0);
  mesh.receiveShadow = true;
  areaGroup.add(mesh);
  return mesh;
}
function createCeiling(width, depth, color){
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.16, depth), new THREE.MeshStandardMaterial({ color: color || 0xf3eee4, roughness: 1 }));
  mesh.position.set(0, 3.24, 0);
  mesh.receiveShadow = true;
  areaGroup.add(mesh);
  return mesh;
}
function wallSegment(x, z, w, h, d, mat){
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || materials.wallWarm);
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  areaGroup.add(mesh);
  addBoxCollider(x, z, w, d);
  return mesh;
}
function addLamp(x,z,intensity,color){
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), new THREE.MeshBasicMaterial({ color: color || 0xffdda6 }));
  bulb.position.set(x, 2.65, z); areaGroup.add(bulb);
  const p = new THREE.PointLight(color || 0xffd69a, intensity || 0.9, 11, 2.1);
  p.position.set(x, 2.5, z); p.castShadow = false; areaGroup.add(p);
}
function doorModel(x,z,axis,label,color){
  const g = new THREE.Group();
  const frameMat = materials.darkWood;
  const panelMat = new THREE.MeshStandardMaterial({ color: color || 0xe8dcc2, roughness: 0.95 });
  const signMat = new THREE.MeshStandardMaterial({ color: 0x1a100d, roughness: 1 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.9, 0.05), signMat);
  const signText = makeLabelPlane(label || '扉', 1.0, 0.3);
  signText.position.set(0, 0, 0.03);
  sign.add(signText);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.3, 0.18), frameMat);
  const right = left.clone();
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.12, 0.18), frameMat);
  left.position.set(-0.73, 1.15, 0); right.position.set(0.73, 1.15, 0); top.position.set(0, 2.24, 0);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.34, 2.08, 0.12), panelMat);
  panel.position.set(0, 1.04, 0);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), materials.brass);
  knob.position.set(0.52, 1.08, 0.09);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.04), new THREE.MeshStandardMaterial({ color: 0x2d2d31, roughness: 0.5 }));
  plate.position.set(0.52, 1.08, 0.06);
  sign.position.set(0, 2.8, 0.03);
  g.add(left,right,top,panel,plate,knob,sign);
  if (axis === 'x') g.rotation.y = Math.PI / 2;
  g.position.set(x,0,z);
  g.traverse(m => { if (m.isMesh){ m.castShadow = true; m.receiveShadow = true; } });
  areaGroup.add(g);
  return g;
}
function makeLabelPlane(text, scaleX, scaleY){
  const c=document.createElement('canvas'); c.width=512; c.height=256; const g=c.getContext('2d');
  g.fillStyle='#f4f0e2'; g.fillRect(0,0,512,256);
  g.fillStyle='#140d0c'; g.font='bold 92px sans-serif'; g.textAlign='center'; g.textBaseline='middle'; g.fillText(text,256,128);
  const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace;
  const mat=new THREE.MeshBasicMaterial({ map:tex, transparent:false });
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(scaleX, scaleY), mat);
  return mesh;
}

function receptionDesk(){
  const g=new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.2, 1.2), materials.darkWood);
  base.position.set(0,0.6,0); base.castShadow = true; base.receiveShadow = true;
  const top = new THREE.Mesh(new THREE.BoxGeometry(4.7,0.12,1.35), materials.wood);
  top.position.set(0,1.26,0); top.castShadow = true; top.receiveShadow = true;
  g.add(base,top);
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,0.08,18), materials.brass);
  bell.position.set(-1.4,1.36,0); g.add(bell);
  const ledger = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.08,0.6), new THREE.MeshStandardMaterial({ color: 0x27495d, roughness: 0.8 }));
  ledger.position.set(1.1,1.34,0.05); g.add(ledger);
  g.position.set(0,0,-4.3); areaGroup.add(g);
  addBoxCollider(0,-3.4,4.8,1.45);
}
function bathCurtain(){
  const g = new THREE.Group();
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,3,12), materials.brass);
  rod.rotation.z = Math.PI / 2; rod.position.set(0,2.4,0); g.add(rod);
  for(let i=0;i<6;i++){
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.42,1.9,0.06), new THREE.MeshStandardMaterial({ color: i%2?0x1e4c8f:0xf4f5f7, roughness: 1 }));
    cloth.position.set(-1.1 + i*0.44,1.42,0); cloth.castShadow = true; cloth.receiveShadow = true; g.add(cloth);
  }
  g.position.set(0,0,-2.7); areaGroup.add(g);
}
function archiveShelves(){
  for(let row=0; row<2; row++){
    const shelf = new THREE.Group();
    const side1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.3, 2.8), materials.darkWood);
    const side2 = side1.clone();
    const boards=[];
    for(let i=0;i<4;i++){
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.2,0.08,2.8), materials.darkWood);
      board.position.set(0,0.34 + i*0.56,0); boards.push(board); shelf.add(board);
    }
    side1.position.set(-1.04,1.15,0); side2.position.set(1.04,1.15,0); shelf.add(side1, side2);
    for(let i=0;i<18;i++){
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.16 + Math.random()*0.08, 0.34 + Math.random()*0.2, 0.28), new THREE.MeshStandardMaterial({ color: [0x2f4b62,0x755544,0x63613d,0x473a57][i%4], roughness: 0.9 }));
      b.position.set(-0.82 + (i%9)*0.2, 0.54 + Math.floor(i/9)*0.56, -1 + (i%3)*0.95); shelf.add(b);
    }
    shelf.position.set(row===0?-2.6:2.6,0,-0.5); shelf.rotation.y = row===0? 0 : 0; areaGroup.add(shelf);
    addBoxCollider(shelf.position.x, shelf.position.z, 2.25, 3.0);
  }
}
function makeCharacter(type, costume){
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xf1d5c3, roughness: 0.82 });
  const clothing = new THREE.MeshStandardMaterial({ color: costume || 0x374c7a, roughness: 0.92 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.95 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x0d0f16, roughness: 0.82 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 22, 18), skin);
  head.position.y = 1.72; head.castShadow = true;
  const facePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.34,0.34), new THREE.MeshBasicMaterial({ map: faceTextures[type], transparent:false }));
  facePlane.position.set(0,1.71,0.19); g.add(facePlane);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.09,0.12,12), skin); neck.position.y = 1.44; neck.castShadow = true;
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.26,0.32,0.62,14), clothing); chest.position.y = 1.05; chest.castShadow = true; chest.scale.z = 0.86;
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.26,0.24,14), clothing); hips.position.y = 0.63; hips.castShadow = true; hips.scale.z = 0.9;
  const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.1,12,12), clothing); shoulderL.position.set(-0.34,1.24,0);
  const shoulderR = shoulderL.clone(); shoulderR.position.x = 0.34;
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.07,0.58,12), clothing); armL.position.set(-0.42,0.98,0); armL.rotation.z = 0.08; armL.castShadow = true;
  const armR = armL.clone(); armR.position.x = 0.42; armR.rotation.z = -0.08;
  const handL = new THREE.Mesh(new THREE.SphereGeometry(0.085,12,12), skin); handL.position.set(-0.44,0.66,0.02); handL.castShadow = true;
  const handR = handL.clone(); handR.position.x = 0.44;
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.1,0.72,12), dark); legL.position.set(-0.15,0.15,0); legL.castShadow = true;
  const legR = legL.clone(); legR.position.x = 0.15;
  const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.12,0.38), shoeMat); shoeL.position.set(-0.15,-0.24,0.05); shoeL.castShadow = true;
  const shoeR = shoeL.clone(); shoeR.position.x = 0.15;
  g.add(head, neck, chest, hips, shoulderL, shoulderR, armL, armR, handL, handR, legL, legR, shoeL, shoeR);
  if (type === 'okami') {
    const kimono = new THREE.Mesh(new THREE.CylinderGeometry(0.48,0.34,1.26,14,1), new THREE.MeshStandardMaterial({ color: 0x6c3d43, roughness: 0.95 }));
    kimono.position.y = 0.72; kimono.castShadow = true; g.add(kimono);
    const obi = new THREE.Mesh(new THREE.BoxGeometry(0.72,0.16,0.24), new THREE.MeshStandardMaterial({ color: 0x3b2226, roughness: 0.9 }));
    obi.position.y = 0.74; obi.castShadow = true; g.add(obi);
  }
  if (type === 'maid') {
    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.54,0.72,0.06), new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 1 }));
    apron.position.set(0,0.93,0.17); apron.castShadow = true; g.add(apron);
  }
  if (type === 'guide') {
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.27,18,14), new THREE.MeshStandardMaterial({ color: 0xf5f6f7, roughness: 0.4 }));
    helmet.position.y = 2.0; helmet.scale.y = 0.8; helmet.castShadow = true; g.add(helmet);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24,0.29,0.05,20), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.45 }));
    brim.position.y = 1.9; g.add(brim);
    const flagPoleL = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.72,8), new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.6 }));
    flagPoleL.position.set(-0.55,0.88,0.02); flagPoleL.rotation.z = 0.1; g.add(flagPoleL);
    const flagL = new THREE.Mesh(new THREE.BoxGeometry(0.28,0.22,0.02), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
    flagL.position.set(-0.43,1.03,0.02); g.add(flagL);
    const flagPoleR = flagPoleL.clone(); flagPoleR.position.x = 0.55; flagPoleR.rotation.z = -0.1; g.add(flagPoleR);
    const flagR = new THREE.Mesh(new THREE.BoxGeometry(0.28,0.22,0.02), new THREE.MeshStandardMaterial({ color: 0xc23b3b, roughness: 0.9 }));
    flagR.position.set(0.43,1.03,0.02); g.add(flagR);
  }
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.48, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.29; g.add(shadow);
  return g;
}

function addNPC(id, name, faceType, costume, x, z, rot, onInteract){
  const npc = { id, name, x, z, rot: rot || 0, onInteract, faceType };
  npc.group = makeCharacter(faceType, costume);
  npc.group.position.set(x, 0.28, z);
  npc.group.rotation.y = rot || 0;
  dynamicGroup.add(npc.group);
  npcs.push(npc);
  return npc;
}
function addItem(id, label, x, z, mesh, onInteract){
  mesh.position.set(x, mesh.position.y, z);
  dynamicGroup.add(mesh);
  items.push({ id, label, x, z, mesh, onInteract });
}
function addDoor(id, label, x, z, radius, toArea, toSpawn, axis, color){
  doorModel(x, z, axis, label, color);
  doors.push({ id, label, x, z, radius: radius || 1.18, toArea, toSpawn });
}

function addTree(x, z, scale){
  const s = scale || 1;
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14*s, 0.18*s, 1.4*s, 10), materials.bark);
  trunk.position.y = 0.7*s; trunk.castShadow = true; trunk.receiveShadow = true; g.add(trunk);
  const crown1 = new THREE.Mesh(new THREE.SphereGeometry(0.72*s, 14, 12), materials.leaf);
  crown1.position.set(0, 1.7*s, 0); crown1.castShadow = true; crown1.receiveShadow = true; g.add(crown1);
  const crown2 = new THREE.Mesh(new THREE.SphereGeometry(0.56*s, 14, 12), materials.leaf);
  crown2.position.set(0.3*s, 2.0*s, 0.15*s); crown2.castShadow = true; crown2.receiveShadow = true; g.add(crown2);
  g.position.set(x, 0, z);
  areaGroup.add(g);
  addBoxCollider(x, z, 0.9*s, 0.9*s);
}

function buildArea(areaId){
  areaGroup.clear(); dynamicGroup.clear(); clearArray(colliders); clearArray(doors); clearArray(npcs); clearArray(items);
  areaLabelEl.textContent = areaLabels[areaId];
  phaseLabelEl.textContent = stepDefs[state.step].phase;
  dayLabelEl.textContent = 'DAY ' + stepDefs[state.step].day;
  state.day = stepDefs[state.step].day;
  state.phaseLabel = stepDefs[state.step].phase;
  scene.background = new THREE.Color(0x06080d);
  hemi.intensity = 0.7;
  dirLight.intensity = 0.9;
  dirLight.position.set(6, 10, 5);
  scene.fog.color.set(0x080a10);
  scene.fog.near = 16; scene.fog.far = 42;
  if (areaId === 'home') buildHome();
  else if (areaId === 'town') buildTown();
  else if (areaId === 'lobby') buildLobby();
  else if (areaId === 'kitchen') buildKitchen();
  else if (areaId === 'corridor') buildCorridor();
  else if (areaId === 'room201') buildRoom201();
  else if (areaId === 'room202') buildRoom202();
  else if (areaId === 'bath') buildBath();
  else if (areaId === 'archive') buildArchive();
  else if (areaId === 'north') buildNorth();
  else if (areaId === 'detached') buildDetached();
}


function buildHome(){
  const night = state.step === 'sleep_day1';
  scene.fog.color.set(night ? 0x070910 : 0x0b0d12);
  scene.fog.near = 14; scene.fog.far = 34;
  createFloor(10, 8, materials.wood, -0.1);
  createCeiling(10, 8, night ? 0xd7d2cb : 0xece7dd);
  wallSegment(0,-3.95,10,3.2,0.14,materials.wallWarm); wallSegment(0,3.95,10,3.2,0.14,materials.wallWarm); wallSegment(-4.95,0,0.14,3.2,8,materials.wallDark); wallSegment(4.95,0,0.14,3.2,8,materials.wallDark);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.8,0.82,0.8), materials.darkWood); desk.position.set(-2.0,0.41,-2.2); desk.castShadow = desk.receiveShadow = true; areaGroup.add(desk); addBoxCollider(-2.0,-2.2,1.8,0.8);
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.8,1.8,0.5), materials.darkWood); shelf.position.set(-4.1,0.9,2.8); shelf.castShadow = shelf.receiveShadow = true; areaGroup.add(shelf); addBoxCollider(-4.1,2.8,0.8,0.5);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.54,0.42,0.24), new THREE.MeshStandardMaterial({ color: 0x41474f, roughness: 0.92 })); bag.position.set(-1.8,0.9,-2.05); areaGroup.add(bag);
  const futon = new THREE.Mesh(new THREE.BoxGeometry(2.6,0.22,2.6), new THREE.MeshStandardMaterial({ color: 0xf0eee8, roughness: 1 })); futon.position.set(0.8,0.02,0.9); areaGroup.add(futon); addBoxCollider(0.8,0.9,2.6,2.6);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.72,0.16,0.34), materials.paper); pillow.position.set(0.1,0.15,-0.02); areaGroup.add(pillow);
  const doorMat = new THREE.Mesh(new THREE.BoxGeometry(1.1,0.02,0.8), materials.carpet); doorMat.position.set(4.1,-0.08,1.0); areaGroup.add(doorMat);
  addLamp(-2.6,-0.4, night ? 0.4 : 0.7); addLamp(2.6,0.2, night ? 0.34 : 0.58);
  const noteMesh = new THREE.Mesh(new THREE.BoxGeometry(0.42,0.02,0.28), materials.paper); noteMesh.position.y = 0.84;
  if (state.step === 'start_note') addItem('scheduleNote','手紙',-2.0,-2.2,noteMesh,itemInteract);
  if (state.step === 'sleep_day1') {
    const futonTrigger = new THREE.Mesh(new THREE.BoxGeometry(2.2,0.04,2.0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.01 }));
    futonTrigger.position.y = 0.05;
    addItem('futonBed','布団',0.8,0.9,futonTrigger,itemInteract);
  }
  addDoor('homeToTown','外へ出る',4.36,1.0,1.1,'town',{x:-8.3,z:0,yaw:-Math.PI/2},'x',0xe7d9be);
  const homeLabel = makeLabelPlane('自宅', 1.4, 0.42); homeLabel.position.set(0,2.45,-3.84); areaGroup.add(homeLabel);
}

function buildTown(){
  scene.background = new THREE.Color(0xaecdf0);
  hemi.intensity = 1.12;
  dirLight.intensity = 1.35;
  dirLight.position.set(-8, 14, 6);
  scene.fog.color.set(0xb7d3ee);
  scene.fog.near = 34;
  scene.fog.far = 82;

  createFloor(40, 24, materials.grass, -0.11);
  const road = new THREE.Mesh(new THREE.BoxGeometry(32, 0.03, 5.4), new THREE.MeshStandardMaterial({ color: 0x7d736a, roughness: 1 }));
  road.position.set(1.5, -0.06, 0);
  road.receiveShadow = true;
  areaGroup.add(road);
  const shoulderA = new THREE.Mesh(new THREE.BoxGeometry(32, 0.02, 0.55), new THREE.MeshStandardMaterial({ color: 0xcbb48a, roughness: 1 }));
  shoulderA.position.set(1.5, -0.07, -2.95);
  areaGroup.add(shoulderA);
  const shoulderB = shoulderA.clone(); shoulderB.position.z = 2.95; areaGroup.add(shoulderB);

  addCollider(-19.8, -11.6, 19.8, -9.4);
  addCollider(-19.8, 9.4, 19.8, 11.6);
  addCollider(-19.8, -11.6, -17.4, 11.6);
  addCollider(17.4, -11.6, 19.8, 11.6);

  const mountainMat = new THREE.MeshStandardMaterial({ color: 0x5e6f67, roughness: 1 });
  for (const [x,z,s] of [[-10,-12,6],[2,-13,7],[14,-12.5,5.8],[-4,12.5,5.6],[11,13,6.6]]) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(s, 6.2, 5), mountainMat);
    m.position.set(x, 2.2, z); m.rotation.y = Math.PI * 0.25; m.castShadow = true; m.receiveShadow = true; areaGroup.add(m);
  }

  const house = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.6, 3.8), new THREE.MeshStandardMaterial({ color: 0xcab89b, roughness: 1 }));
  body.position.y = 1.3; body.castShadow = true; body.receiveShadow = true; house.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.8, 1.8, 4), new THREE.MeshStandardMaterial({ color: 0x5f4b40, roughness: 1 }));
  roof.position.y = 3.0; roof.rotation.y = Math.PI * 0.25; roof.castShadow = true; roof.receiveShadow = true; house.add(roof);
  house.position.set(-12.4, 0, 0);
  areaGroup.add(house);
  addBoxCollider(-12.4, 0, 5.1, 4.0);

  const inn = new THREE.Group();
  const main = new THREE.Mesh(new THREE.BoxGeometry(7.8, 3.0, 6.2), new THREE.MeshStandardMaterial({ color: 0xd7c6aa, roughness: 1 }));
  main.position.set(0,1.5,0); main.castShadow = true; main.receiveShadow = true; inn.add(main);
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.6, 3.8), new THREE.MeshStandardMaterial({ color: 0xd2c1a4, roughness: 1 }));
  wingL.position.set(-4.8,1.3,1.0); wingL.castShadow = true; wingL.receiveShadow = true; inn.add(wingL);
  const wingR = wingL.clone(); wingR.position.set(4.8,1.3,1.0); inn.add(wingR);
  const roofMain = new THREE.Mesh(new THREE.ConeGeometry(5.8, 2.2, 4), new THREE.MeshStandardMaterial({ color: 0x514134, roughness: 1 }));
  roofMain.position.set(0,3.5,0); roofMain.rotation.y = Math.PI * 0.25; roofMain.castShadow = true; roofMain.receiveShadow = true; inn.add(roofMain);
  const roofWingL = new THREE.Mesh(new THREE.ConeGeometry(2.8, 1.5, 4), new THREE.MeshStandardMaterial({ color: 0x5a493c, roughness: 1 }));
  roofWingL.position.set(-4.8,2.9,1.0); roofWingL.rotation.y = Math.PI * 0.25; roofWingL.castShadow = true; roofWingL.receiveShadow = true; inn.add(roofWingL);
  const roofWingR = roofWingL.clone(); roofWingR.position.set(4.8,2.9,1.0); inn.add(roofWingR);
  const porch = new THREE.Mesh(new THREE.BoxGeometry(3.8,0.18,1.9), materials.darkWood); porch.position.set(0,0.18,4.0); porch.castShadow = true; porch.receiveShadow = true; inn.add(porch);
  const step = new THREE.Mesh(new THREE.BoxGeometry(4.6,0.16,0.9), new THREE.MeshStandardMaterial({ color: 0x857462, roughness: 1 })); step.position.set(0,0.08,5.2); step.receiveShadow = true; inn.add(step);
  const doorFrameL = new THREE.Mesh(new THREE.BoxGeometry(0.16,2.2,0.22), materials.darkWood);
  doorFrameL.position.set(-1.02,1.1,3.13); doorFrameL.castShadow = true; doorFrameL.receiveShadow = true; inn.add(doorFrameL);
  const doorFrameR = doorFrameL.clone(); doorFrameR.position.x = 1.02; inn.add(doorFrameR);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.28,0.24,0.28), materials.darkWood); lintel.position.set(0,2.3,3.06); lintel.castShadow = true; lintel.receiveShadow = true; inn.add(lintel);
  const doorL = new THREE.Mesh(new THREE.BoxGeometry(0.86,2.02,0.11), new THREE.MeshStandardMaterial({ color: 0xeee6d7, roughness: 0.95 }));
  doorL.position.set(-0.46,1.02,3.14); doorL.castShadow = true; doorL.receiveShadow = true; inn.add(doorL);
  const doorR = doorL.clone(); doorR.position.x = 0.46; inn.add(doorR);
  const handleL = new THREE.Mesh(new THREE.SphereGeometry(0.04,10,10), materials.brass); handleL.position.set(-0.1,1.02,3.21); inn.add(handleL);
  const handleR = handleL.clone(); handleR.position.x = 0.1; inn.add(handleR);
  const noren = new THREE.Mesh(new THREE.BoxGeometry(2.1,0.02,0.9), new THREE.MeshStandardMaterial({ color: 0x25496e, roughness: 1 })); noren.position.set(0,2.02,3.42); inn.add(noren);
  const lanternL = new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.26,0.58,16), new THREE.MeshStandardMaterial({ color: 0xf8f1df, emissive: 0x7a5314, emissiveIntensity: 0.18, roughness: 0.8 }));
  lanternL.position.set(-1.7,1.9,3.55); lanternL.castShadow = true; lanternL.receiveShadow = true; inn.add(lanternL);
  const lanternR = lanternL.clone(); lanternR.position.set(1.7,1.9,3.55); inn.add(lanternR);
  const windowMat = new THREE.MeshStandardMaterial({ map: makeShojiTexture(320,320), roughness: 1 });
  for (const x of [-2.6,2.6,-5.0,5.0]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.4,1.2,0.08), windowMat); win.position.set(x,1.5,3.18); win.castShadow = true; win.receiveShadow = true; inn.add(win);
  }
  const nameBoard = makeLabelPlane('宵宿旅館', 2.2, 0.5); nameBoard.position.set(0,2.9,3.28); inn.add(nameBoard);
  inn.position.set(12.7,0,0); inn.traverse(m => { if (m.isMesh){ m.castShadow = true; m.receiveShadow = true; } });
  areaGroup.add(inn);
  addBoxCollider(8.9,0,3.2,6.6);
  addBoxCollider(16.5,0,3.2,6.6);
  addBoxCollider(12.7,-2.45,7.4,1.25);
  addBoxCollider(10.45,2.65,2.9,1.15);
  addBoxCollider(14.95,2.65,2.9,1.15);

  const gravel = new THREE.Mesh(new THREE.BoxGeometry(4.8,0.04,6.0), new THREE.MeshStandardMaterial({ color: 0xb5a387, roughness: 1 }));
  gravel.position.set(12.7,-0.05,0); gravel.receiveShadow = true; areaGroup.add(gravel);
  const path = new THREE.Mesh(new THREE.BoxGeometry(10,0.03,2.5), new THREE.MeshStandardMaterial({ color: 0x9c8a73, roughness: 1 }));
  path.position.set(8.0,-0.04,0); path.receiveShadow = true; areaGroup.add(path);
  const sideFenceMat = new THREE.MeshStandardMaterial({ color: 0x6e5a49, roughness: 1 });
  for (const z of [-6.8, 6.8]) {
    const fence = new THREE.Mesh(new THREE.BoxGeometry(18, 0.9, 0.12), sideFenceMat);
    fence.position.set(4.8, 0.45, z); fence.castShadow = true; fence.receiveShadow = true; areaGroup.add(fence);
  }

  for (let x = -16; x <= 16; x += 3.6) {
    addTree(x, -8.8 + ((x % 2) ? 0.4 : -0.4), 1 + (Math.abs(x) % 3) * 0.05);
    addTree(x + 0.9, 8.8 + ((x % 2) ? -0.25 : 0.25), 0.94);
  }
  addTree(-4.0, -7.4, 1.1); addTree(-1.0, 7.4, 1.05); addTree(5.8, -7.2, 1.08); addTree(9.2, 7.2, 1.0); addTree(15.5, -7.1, 1.0);

  addLamp(-6.0, 0, 0.28, 0xfff2d4);
  addLamp(1.8, 0, 0.24, 0xfff2d4);
  addLamp(9.2, 0, 0.24, 0xfff2d4);
  addLamp(12.7, 2.4, 0.42, 0xffecbf);

  addDoor('townToHome','自宅',-9.1,0,1.2,'home',{x:3.4,z:1.0,yaw:Math.PI/2},'x',0xc4c0b5);
  addDoor('townToLobby','旅館入口',12.7,4.1,1.85,'lobby',{x:0,z:4.8,yaw:Math.PI},undefined,0xc9b07a);
  addNPC('villager','町の住民','villager',0x607b4d,-2.6,-1.2,Math.PI/2,npcInteract);
}

function buildLobby(){
  createFloor(16, 14, materials.tatami, -0.1);
  createCeiling(16, 14, 0xf0eadc);
  wallSegment(0, -6.95, 16, 3.2, 0.14, materials.wallWarm);
  wallSegment(0, 6.95, 16, 3.2, 0.14, materials.wallWarm);
  wallSegment(-7.95, 0, 0.14, 3.2, 14, materials.darkWood);
  wallSegment(7.95, 0, 0.14, 3.2, 14, materials.darkWood);
  receptionDesk();
  addLamp(-2.4, -0.4, 0.85); addLamp(2.4, -0.4, 0.85);
  const sign = makeLabelPlane('帳場', 1.4, 0.45); sign.position.set(0, 2.5, -6.85); areaGroup.add(sign);
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.3,1.8,0.6), materials.darkWood);
  cabinet.position.set(-6.2,0.9,4.4); cabinet.castShadow = cabinet.receiveShadow = true; areaGroup.add(cabinet); addBoxCollider(-5.2,3.4,1.3,0.6);
  const blackPhone = new THREE.Mesh(new THREE.BoxGeometry(0.4,0.14,0.28), materials.black);
  blackPhone.position.set(2.2,1.36,-4.35); areaGroup.add(blackPhone);
  const amenityCab = new THREE.Mesh(new THREE.BoxGeometry(0.72,0.4,0.46), new THREE.MeshStandardMaterial({ color: 0x8f7555, roughness: 0.9 })); amenityCab.position.y = 1.28;
  if (state.step === 'stock_amenities') addItem('amenityBag','客用備品袋',-5.2,3.42, amenityCab, itemInteract);
  const registerBook = new THREE.Mesh(new THREE.BoxGeometry(0.78,0.08,0.54), new THREE.MeshStandardMaterial({ color: 0x31546b, roughness: 0.82 }));
  registerBook.position.y = 1.36;
  if (state.step === 'inspect_register') addItem('registerBook','宿帳',1.1,-4.25, registerBook, itemInteract);
  addDoor('lobbyToCorridor', '客室廊下', 7.32, 0, 1.35, 'corridor', { x: -7.6, z: 0, yaw: 0 });
  addDoor('lobbyToKitchen', '厨房', -7.32, 2.6, 1.2, 'kitchen', { x: 5.0, z: -1.2, yaw: Math.PI });
  addDoor('lobbyToArchive', '宿帳庫', -7.32, -2.6, 1.2, 'archive', { x: 5.1, z: 0, yaw: Math.PI });
  addNPC('okami', '女将', 'okami', 0x6d3d44, 0, -3.0, Math.PI, npcInteract);
}

function buildKitchen(){
  createFloor(11, 9, materials.tile, -0.1);
  createCeiling(11, 9, 0xece7dd);
  wallSegment(0,-4.45,11,3.2,0.14,materials.wallDark); wallSegment(0,4.45,11,3.2,0.14,materials.wallDark); wallSegment(-5.45,0,0.14,3.2,9,materials.wallDark); wallSegment(5.45,0,0.14,3.2,9,materials.wallDark);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3.8,0.92,1.3), materials.darkWood); counter.position.set(0,0.46,-2.3); counter.castShadow = counter.receiveShadow = true; areaGroup.add(counter); addBoxCollider(0,-2.3,3.8,1.3);
  const stove = new THREE.Mesh(new THREE.BoxGeometry(1.6,0.92,0.8), new THREE.MeshStandardMaterial({ color: 0x54565d, roughness: 0.5 })); stove.position.set(-3.7,0.46,2.5); areaGroup.add(stove); addBoxCollider(-3.7,2.5,1.6,0.8);
  addLamp(0,0,0.9); addLamp(3.2,-1.4,0.7);
  addDoor('kitchenToLobby','帳場',5.0,-1.2,1.2,'lobby',{x:-4.8,z:2.2,yaw:0},'x');
  addNPC('chef','料理番','chef',0xffffff,1.8,-1.2,-Math.PI/2,npcInteract);
  const teaTray = new THREE.Mesh(new THREE.BoxGeometry(0.86,0.08,0.56), new THREE.MeshStandardMaterial({ color: 0x7a4e2f, roughness: 0.85 }));
  teaTray.position.y = 0.94;
  const teapot = new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.16,0.18,18), new THREE.MeshStandardMaterial({ color: 0xdfddd7, roughness: 0.55 }));
  teapot.position.set(0.1,0.12,0); teaTray.add(teapot);
  const cup1 = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,0.08,18), materials.paper); cup1.position.set(-0.18,0.08,-0.1); teaTray.add(cup1);
  const cup2 = cup1.clone(); cup2.position.z = 0.1; teaTray.add(cup2);
  addItem('tray','お茶の盆',0.2,-2.25,teaTray,itemInteract);

  const breakfastTray = new THREE.Mesh(new THREE.BoxGeometry(1.0,0.08,0.66), new THREE.MeshStandardMaterial({ color: 0x77482b, roughness: 0.82 }));
  breakfastTray.position.y = 0.94;
  const rice = new THREE.Mesh(new THREE.CylinderGeometry(0.11,0.11,0.08,18), materials.paper); rice.position.set(-0.16,0.08,-0.08); breakfastTray.add(rice);
  const soup = new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.14,0.12,18), new THREE.MeshStandardMaterial({ color: 0x6d3224, roughness: 0.85 })); soup.position.set(0.14,0.1,-0.08); breakfastTray.add(soup);
  const fish = new THREE.Mesh(new THREE.BoxGeometry(0.24,0.05,0.12), new THREE.MeshStandardMaterial({ color: 0xcbaa64, roughness: 0.9 })); fish.position.set(-0.02,0.09,0.14); breakfastTray.add(fish);
  if (state.step === 'get_breakfast202') addItem('breakfastTray','202号室の朝食膳',-1.55,-2.18,breakfastTray,itemInteract);
}

function buildCorridor(){
  createFloor(24, 9.6, materials.wood, -0.1);
  createCeiling(24, 9.6, 0xe7dcc9);
  wallSegment(0,-4.75,24,3.2,0.14,materials.darkWood); wallSegment(0,4.75,24,3.2,0.14,materials.darkWood); wallSegment(-11.95,0,0.14,3.2,9.6,materials.wallDark); wallSegment(11.95,0,0.14,3.2,9.6,materials.wallDark);
  for(let i=-10;i<=10;i+=4){ addLamp(i,0,0.72,0xffd7a6); }
  for(let z of [-3.4,3.4]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(23.6,0.9,0.18), materials.darkWood); rail.position.set(0,0.45,z); rail.castShadow = rail.receiveShadow = true; areaGroup.add(rail); addBoxCollider(0,z,23.6,0.18);
  }
  addDoor('corridorToLobby','帳場',-11.34,0,1.2,'lobby',{x:7.1,z:0,yaw:Math.PI},'x');
  addDoor('corridorTo201','201',0,-4.58,1.2,'room201',{x:0,z:4.0,yaw:Math.PI},null,0xf0e7d1);
  addDoor('corridorTo202','202',4.8,-4.58,1.2,'room202',{x:0,z:4.0,yaw:Math.PI},null,0xeaddcd);
  addDoor('corridorToBath','浴場',7.7,4.58,1.2,'bath',{x:-3.6,z:0,yaw:0},null,0xd7ecef);
  addDoor('corridorToNorth','北廊下',11.34,0,1.2,'north',{x:-3.7,z:0,yaw:0},'x',0xc3b28a);
  const placard = makeLabelPlane('客室廊下', 1.8, 0.45); placard.position.set(-8.4,2.4,-4.6); areaGroup.add(placard);
  const amenityBox = new THREE.Mesh(new THREE.BoxGeometry(0.88,0.7,0.64), materials.darkWood); amenityBox.position.set(-6.1,0.35,2.4); amenityBox.castShadow = amenityBox.receiveShadow = true; areaGroup.add(amenityBox); addBoxCollider(-6.1,2.4,0.88,0.64);
  const slipperRack = new THREE.Group();
  const rackBase = new THREE.Mesh(new THREE.BoxGeometry(1.7,0.55,0.36), materials.darkWood); rackBase.position.set(0,0.28,0); slipperRack.add(rackBase);
  for (const [sx,sz] of [[-0.45,-0.06],[0,0.04],[0.45,-0.02]]) { const pair = new THREE.Mesh(new THREE.BoxGeometry(0.28,0.08,0.16), new THREE.MeshStandardMaterial({ color: 0xe8e0ce, roughness: 1 })); pair.position.set(sx,0.38,sz); slipperRack.add(pair); }
  slipperRack.position.set(-9.3,0,-3.25); slipperRack.traverse(m=>{ if(m.isMesh){ m.castShadow = m.receiveShadow = true; } }); areaGroup.add(slipperRack); addBoxCollider(-9.3,-3.25,1.7,0.36);
  if (state.step === 'place_amenities') addItem('amenityBox','備品箱',-6.1,2.4, new THREE.Mesh(new THREE.BoxGeometry(0.48,0.18,0.32), new THREE.MeshStandardMaterial({ color: 0xe1d4be, roughness: 1 })), itemInteract);
  if (state.step === 'arrange_slippers') addItem('slipperRack','下駄箱前',-9.3,-3.25, new THREE.Mesh(new THREE.BoxGeometry(0.6,0.1,0.3), new THREE.MeshStandardMaterial({ color: 0xf4efe5, roughness: 1 })), itemInteract);
  if (state.step === 'collect_lost_item') {
    const lostKey = new THREE.Mesh(new THREE.TorusGeometry(0.14,0.03,8,20), materials.brass);
    lostKey.rotation.x = Math.PI/2; lostKey.position.y = 0.06;
    addItem('lostKey','鍵束',3.2,1.25,lostKey,itemInteract);
  }
  addNPC('maid','仲居','maid',0x575a79,4.6,1.2,Math.PI,npcInteract);
}

function buildRoom201(){
  createFloor(9, 9, materials.tatami, -0.1);
  createCeiling(9, 9, 0xf2ece1);
  wallSegment(0,-4.45,9,3.2,0.14,materials.wallWarm); wallSegment(0,4.45,9,3.2,0.14,materials.wallWarm); wallSegment(-4.45,0,0.14,3.2,9,materials.wallDark); wallSegment(4.45,0,0.14,3.2,9,materials.wallDark);
  const alcove = new THREE.Mesh(new THREE.BoxGeometry(1.6,2.5,0.4), materials.darkWood); alcove.position.set(-3.2,1.25,-3.6); areaGroup.add(alcove); addBoxCollider(-3.2,-3.6,1.6,0.4);
  const futon = new THREE.Mesh(new THREE.BoxGeometry(2.2,0.26,3.0), new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 1 })); futon.position.set(1.7,0.03,-1.2); areaGroup.add(futon); addBoxCollider(1.7,-1.2,2.2,3.0);
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.2,0.38,1.2), materials.darkWood); table.position.set(-0.2,0.19,0.8); areaGroup.add(table); addBoxCollider(-0.2,0.8,1.2,1.2);
  addLamp(0,0,0.8); addDoor('room201ToCorridor','客室廊下',0,4.18,1.1,'corridor',{x:0,z:-1.8,yaw:0},null,0xf0e7d1);
  addNPC('guest201','201号室の客','guest',0x423d52,-1.6,-1.2,Math.PI/2,npcInteract);
}



function buildRoom202(){
  createFloor(9, 9, materials.tatami, -0.1);
  createCeiling(9, 9, 0xf2ece1);
  wallSegment(0,-4.45,9,3.2,0.14,materials.wallWarm); wallSegment(0,4.45,9,3.2,0.14,materials.wallWarm); wallSegment(-4.45,0,0.14,3.2,9,materials.wallDark); wallSegment(4.45,0,0.14,3.2,9,materials.wallDark);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.18,1.9,2.8), materials.shoji); screen.position.set(0.4,0.95,-2.2); areaGroup.add(screen); addBoxCollider(0.4,-2.2,0.18,2.8);
  const futon = new THREE.Mesh(new THREE.BoxGeometry(2.4,0.26,2.8), new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 1 })); futon.position.set(1.7,0.03,-0.6); areaGroup.add(futon); addBoxCollider(1.7,-0.6,2.4,2.8);
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.3,0.38,1.0), materials.darkWood); table.position.set(-0.4,0.19,1.0); areaGroup.add(table); addBoxCollider(-0.4,1.0,1.3,1.0);
  addLamp(0,0,0.8);
  addDoor('room202ToCorridor','客室廊下',0,4.18,1.1,'corridor',{x:4.8,z:-1.2,yaw:0},null,0xeadfcb);
  addNPC('guest202','202号室の客','guest',0x5c5f6a,-1.4,-1.0,Math.PI/2,npcInteract);
}

function buildBath(){
  createFloor(10, 8, materials.tile, -0.1);
  createCeiling(10, 8, 0xe9ecef);
  wallSegment(0,-3.95,10,3.2,0.14,materials.wallRose); wallSegment(0,3.95,10,3.2,0.14,materials.wallRose); wallSegment(-4.95,0,0.14,3.2,8,materials.wallRose); wallSegment(4.95,0,0.14,3.2,8,materials.wallRose);
  bathCurtain();
  const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2,0.42,0.6), materials.darkWood); bench.position.set(2.2,0.21,2.8); areaGroup.add(bench); addBoxCollider(2.2,2.8,2.2,0.6);
  const shelfBody = new THREE.Mesh(new THREE.BoxGeometry(1.5,1.4,0.42), materials.darkWood); shelfBody.position.set(2.35,0.7,2.45); shelfBody.castShadow = shelfBody.receiveShadow = true; areaGroup.add(shelfBody); addBoxCollider(2.35,2.45,1.5,0.42);
  for (const sy of [0.48,0.94]) { const plank = new THREE.Mesh(new THREE.BoxGeometry(1.44,0.05,0.5), materials.wood); plank.position.set(2.35,sy,2.45); areaGroup.add(plank); }
  for (const [tx,ty,tz] of [[1.95,1.15,2.47],[2.35,1.15,2.47],[2.75,1.15,2.47],[2.05,0.69,2.47],[2.45,0.69,2.47],[2.85,0.69,2.47]]) { const towel = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.16,0.24), new THREE.MeshStandardMaterial({ color: 0xf1f3f6, roughness: 1 })); towel.position.set(tx,ty,tz); areaGroup.add(towel); }
  if (state.step === 'restock_towels') addItem('towelShelf','替えタオル棚',2.35,2.45, new THREE.Mesh(new THREE.BoxGeometry(0.54,0.22,0.26), new THREE.MeshStandardMaterial({ color: 0xf1f3f6, roughness: 1 })), itemInteract);
  addLamp(-2.3,0,0.7,0xffe6bc); addLamp(2.3,0,0.7,0xffe6bc);
  addDoor('bathToCorridor','客室廊下',-4.35,0,1.2,'corridor',{x:6.2,z:1.8,yaw:Math.PI},'x',0xddeff3);
  const phoneTable = new THREE.Mesh(new THREE.BoxGeometry(0.9,0.52,0.58), materials.darkWood); phoneTable.position.set(2.5,0.26,-2.5); areaGroup.add(phoneTable); addBoxCollider(2.5,-2.5,0.9,0.58);
  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.46,0.14,0.32), materials.black); phone.position.set(2.5,0.61,-2.5); areaGroup.add(phone);
  addItem('phone','黒電話',2.5,-2.5, phone, itemInteract);
}

function buildArchive(){
  createFloor(14, 12, materials.tile, -0.1);
  createCeiling(14, 12, 0xdad8d6);
  wallSegment(0,-5.95,14,3.2,0.14,materials.wallDark); wallSegment(0,5.95,14,3.2,0.14,materials.wallDark); wallSegment(-6.95,0,0.14,3.2,12,materials.wallDark); wallSegment(6.95,0,0.14,3.2,12,materials.wallDark);
  archiveShelves();
  addLamp(-2.6,0,0.6,0xffe0b4); addLamp(2.6,0,0.6,0xffe0b4);
  addDoor('archiveToLobby','帳場',6.25,0,1.15,'lobby',{x:-5.6,z:-2.2,yaw:0},'x',0xb7b39b);
  addDoor('archiveToDetached','離れ通路',0,-5.25,1.15,'detached',{x:0,z:4.6,yaw:Math.PI},null,0x9689a6);
  const ledger = new THREE.Mesh(new THREE.BoxGeometry(0.72,0.16,0.48), new THREE.MeshStandardMaterial({ color: 0x225688, roughness: 0.85 }));
  ledger.position.y = 1.16;
  addItem('blueLedger','青い宿帳',0,1.8, ledger, itemInteract);
}

function buildNorth(){
  createFloor(11, 7, materials.carpet, -0.1);
  createCeiling(11, 7, 0xd7cab5);
  wallSegment(0,-3.45,11,3.2,0.14,materials.wallDark); wallSegment(0,3.45,11,3.2,0.14,materials.wallDark); wallSegment(-5.45,0,0.14,3.2,7,materials.wallDark); wallSegment(5.45,0,0.14,3.2,7,materials.wallDark);
  addLamp(-2,0,0.45,0xffc388); addLamp(2.4,0,0.45,0xffc388);
  addDoor('northToCorridor','客室廊下',-4.85,0,1.1,'corridor',{x:8.1,z:0,yaw:Math.PI},'x',0xbda67e);
  addDoor('northToDetached','離れ通路',4.85,0,1.1,'detached',{x:-3.8,z:0,yaw:0},'x',0xa89676);
  const rope = new THREE.Mesh(new THREE.BoxGeometry(2.4,0.06,0.06), new THREE.MeshStandardMaterial({ color: 0x8f5c3d, roughness: 1 })); rope.position.set(0,1.4,-1.8); rope.rotation.z = 0.25; areaGroup.add(rope);
  const seal = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.36,0.02), new THREE.MeshStandardMaterial({ color: 0xf7f1df, roughness: 1 })); seal.position.set(0,1.15,-1.78); areaGroup.add(seal);
  addItem('sealTag','閉ざされた札',0,-1.8, seal, itemInteract);
}

function buildDetached(){
  createFloor(16, 10, materials.wood, -0.1);
  createCeiling(16, 10, 0x1d2235);
  scene.fog.color.set(0x0c1019); scene.fog.near = 10; scene.fog.far = 28;
  wallSegment(0,-4.95,16,3.2,0.14,materials.wallDark); wallSegment(0,4.95,16,3.2,0.14,materials.wallDark); wallSegment(-7.95,0,0.14,3.2,10,materials.wallDark); wallSegment(7.95,0,0.14,3.2,10,materials.wallDark);
  for(let i=-5;i<=5;i+=5) addLamp(i,0,0.32,0x6e88aa);
  addDoor('detachedToNorth','北廊下',-7.25,0,1.15,'north',{x:5.2,z:0,yaw:Math.PI},'x',0xa89676);
  addDoor('detachedToArchive','宿帳庫',0,4.25,1.15,'archive',{x:0,z:-4.2,yaw:0},null,0x9689a6);
  const shrine = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.2,0.44,0.8), materials.darkWood); base.position.y = 0.22; shrine.add(base);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.84,1.0,0.44), materials.darkWood); body.position.y = 0.92; shrine.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.3,0.16,0.8), materials.wood); roof.position.y = 1.48; shrine.add(roof);
  shrine.position.set(0,0,-3.2); shrine.traverse(m => { if (m.isMesh){ m.castShadow = true; m.receiveShadow = true; }}); areaGroup.add(shrine); addBoxCollider(0,-2.6,1.3,0.8);
  addItem('altar','祠',0,-3.2, shrine, itemInteract);
}

function npcInteract(entity){
  if (entity.id === 'okami') {
    if (state.step === 'talk_okami') {
      showDialogue(storyNodes.okami_intro, () => setStep('get_tray'));
    } else if (state.step === 'report_okami') {
      showDialogue(storyNodes.report_okami, () => setStep('stock_amenities'));
    } else if (state.step === 'escape_archive') {
      showDialogue(storyNodes.escape_archive, () => openReturnHome());
    } else if (state.step === 'escape_detached') {
      showDialogue(storyNodes.finale, () => { setStep('finale'); state.ended = true; endingEl.classList.remove('hidden'); saveToSlot(1, true); });
    } else if (state.step === 'finale') {
      showDialogue(storyNodes.finale, () => { endingEl.classList.remove('hidden'); saveToSlot(1, true); });
    }
  } else if (entity.id === 'guest201' && state.step === 'deliver_201') {
    showDialogue(storyNodes.guest201, () => setStep('report_okami'));
  } else if (entity.id === 'maid' && state.step === 'talk_maid') {
    showDialogue(storyNodes.maid, () => setStep('get_breakfast202'));
  } else if (entity.id === 'guest202' && state.step === 'deliver_202') {
    showDialogue(storyNodes.guest202, () => setStep('collect_lost_item'));
  } else if (entity.id === 'chef' && state.step === 'get_tray') {
    showDialogue(storyNodes.tray, ()=>{});
  } else if (entity.id === 'villager') {
    showDialogue(storyNodes.villager, ()=>{});
  }
}

function itemInteract(entity){
  if (entity.id === 'scheduleNote' && state.step === 'start_note') {
    showDialogue(storyNodes.home_note, () => setStep('leave_home'));
  } else if (entity.id === 'tray' && state.step === 'get_tray') {
    dynamicGroup.remove(entity.mesh);
    removeItem(entity.id);
    state.questFlags.hasTray = true;
    showDialogue(storyNodes.tray, () => setStep('deliver_201'));
  } else if (entity.id === 'amenityBag' && state.step === 'stock_amenities') {
    state.questFlags.hasAmenityBag = true;
    showDialogue(storyNodes.amenityBag, () => setStep('place_amenities'));
  } else if (entity.id === 'amenityBox' && state.step === 'place_amenities') {
    state.questFlags.placedAmenities = true;
    showDialogue(storyNodes.amenityBox, () => setStep('arrange_slippers'));
  } else if (entity.id === 'slipperRack' && state.step === 'arrange_slippers') {
    state.questFlags.arrangedSlippers = true;
    showDialogue(storyNodes.slippers, () => setStep('restock_towels'));
  } else if (entity.id === 'towelShelf' && state.step === 'restock_towels') {
    state.questFlags.restockedTowels = true;
    showDialogue(storyNodes.towel, () => setStep('answer_phone'));
  } else if (entity.id === 'phone' && state.step === 'answer_phone') {
    showDialogue(storyNodes.phone, () => setStep('inspect_archive'));
  } else if (entity.id === 'blueLedger' && state.step === 'inspect_archive') {
    dynamicGroup.remove(entity.mesh);
    removeItem(entity.id);
    state.questFlags.hasLedger = true;
    showDialogue(storyNodes.blueLedger, () => {
      startChase('archive', { x: 0, z: 0 }, 'escape_archive');
      setStep('escape_archive');
    });
  } else if (entity.id === 'breakfastTray' && state.step === 'get_breakfast202') {
    showDialogue(storyNodes.breakfast202, () => setStep('deliver_202'));
  } else if (entity.id === 'lostKey' && state.step === 'collect_lost_item') {
    showDialogue(storyNodes.lostKey, () => setStep('inspect_register'));
  } else if (entity.id === 'registerBook' && state.step === 'inspect_register') {
    showDialogue(storyNodes.registerCheck, () => setStep('inspect_north'));
  } else if (entity.id === 'sealTag' && state.step === 'inspect_north') {
    showDialogue(storyNodes.sealTag, () => setStep('inspect_detached'));
  } else if (entity.id === 'futonBed' && state.step === 'sleep_day1') {
    showDialogue(storyNodes.sleep_day1, () => {
      state.area = 'home';
      buildArea(state.area);
      player.x = 3.2; player.z = 1.0; player.yaw = Math.PI / 2; player.pitch = 0;
      resetInput();
      setStep('leave_home_day2');
    });
  } else if (entity.id === 'altar' && state.step === 'inspect_detached') {
    showDialogue(storyNodes.altar, () => {
      startChase('detached', { x: 0, z: 0 }, 'escape_detached');
      setStep('escape_detached');
    });
  }
}

function removeItem(id){
  const idx = items.findIndex(it => it.id === id);
  if (idx >= 0) items.splice(idx,1);
}

function showDialogue(list, done){
  state.menuOpen = true;
  state.dialogueQueue = list.map(row => ({ name: row[0], text: row[1], face: row[2] }));
  dialogueOverlay.classList.remove('hidden');
  dialogueOverlay.dataset.done = done ? '1' : '';
  dialogueOverlay._done = done || null;
  advanceDialogue();
}
function advanceDialogue(){
  if (!state.dialogueQueue.length) {
    dialogueOverlay.classList.add('hidden');
    state.menuOpen = false;
    const done = dialogueOverlay._done;
    dialogueOverlay._done = null;
    if (done) done();
    return;
  }
  const row = state.dialogueQueue.shift();
  dialogueNameEl.textContent = row.name;
  dialogueTextEl.textContent = row.text;
  portraitEl.innerHTML = '';
  portraitEl.appendChild(makePortrait(row.face || 'hero'));
}
function makePortrait(face){
  const wrap = document.createElement('div');
  wrap.style.width = '100%'; wrap.style.height = '100%'; wrap.style.display = 'grid'; wrap.style.placeItems = 'center';
  const card = document.createElement('div');
  card.style.width = '82%'; card.style.aspectRatio = '0.68'; card.style.borderRadius = '18px';
  card.style.background = `linear-gradient(180deg, rgba(255,255,255,.14), rgba(0,0,0,.16)), url(${faceTextures[face].image.toDataURL()}) center/cover no-repeat`;
  card.style.border = '1px solid rgba(255,255,255,.12)';
  wrap.appendChild(card);
  return wrap;
}
dialogueOverlay.addEventListener('pointerdown', advanceDialogue);
dialogueOverlay.addEventListener('touchstart', function(e){ e.preventDefault(); advanceDialogue(); }, { passive:false });

function currentStep(){ return stepDefs[state.step]; }
function setStep(id){
  state.step = id;
  const def = currentStep();
  dayLabelEl.textContent = 'DAY ' + def.day;
  phaseLabelEl.textContent = def.phase;
  saveToSlot(1, true);
}

function getChaseCheckpoint(areaId, linkedStep){
  if (areaId === 'archive') {
    return { area: 'archive', x: 3.4, z: 2.2, yaw: Math.PI * 0.9, step: linkedStep, guideSpawn: { x: -3.4, z: -1.4 } };
  }
  if (areaId === 'detached') {
    return { area: 'detached', x: 0, z: 2.2, yaw: Math.PI, step: linkedStep, guideSpawn: { x: 0, z: -2.8 } };
  }
  return { area: areaId, x: player.x, z: player.z, yaw: player.yaw, step: linkedStep, guideSpawn: { x: 0, z: 0 } };
}
function startChase(areaId, guidePos, linkedStep){
  const cp = getChaseCheckpoint(areaId, linkedStep);
  state.checkpoint = { area: cp.area, x: cp.x, z: cp.z, yaw: cp.yaw, step: linkedStep, guideSpawn: cp.guideSpawn };
  player.x = cp.x;
  player.z = cp.z;
  player.yaw = cp.yaw;
  player.pitch = 0;
  state.inputLockUntil = performance.now() + 900;
  state.doorCooldownUntil = performance.now() + 1200;
  resetInput();
  state.chase = { active: true, speed: 2.35, graceUntil: performance.now() + 2200 };
  spawnGuide(cp.guideSpawn.x, cp.guideSpawn.z);
}
function stopChase(){
  state.chase = null;
  if (state.guide) { dynamicGroup.remove(state.guide.group); state.guide = null; }
}
function openReturnHome(){
  state.menuOpen = true;
  resetInput();
  returnHomeEl.classList.remove('hidden');
}
function goHomeNow(){
  returnHomeEl.classList.add('hidden');
  state.menuOpen = false;
  state.area = 'home';
  buildArea(state.area);
  player.x = 2.4; player.z = 1.4; player.yaw = Math.PI / 2; player.pitch = 0;
  resetInput();
  state.inputLockUntil = performance.now() + 500;
  state.doorCooldownUntil = performance.now() + 900;
  setStep('sleep_day1');
}
function spawnGuide(x,z){
  if (state.guide) dynamicGroup.remove(state.guide.group);
  const group = makeCharacter('guide', 0x2f4d7d);
  group.position.set(x,0.28,z);
  dynamicGroup.add(group);
  state.guide = { group, x, z, yaw: 0 };
}
function triggerGameOver(){
  state.menuOpen = true;
  resetInput();
  gameOverEl.classList.remove('hidden');
}
function retryFromCheckpoint(){
  gameOverEl.classList.add('hidden');
  state.menuOpen = false;
  state.ended = false;
  if (!state.checkpoint) {
    beginNewGame();
    return;
  }
  stopChase();
  state.area = state.checkpoint.area;
  buildArea(state.area);
  player.x = state.checkpoint.x;
  player.z = state.checkpoint.z;
  player.yaw = state.checkpoint.yaw;
  player.pitch = 0;
  resetInput();
  state.inputLockUntil = performance.now() + 1000;
  state.doorCooldownUntil = performance.now() + 1400;
  setStep(state.checkpoint.step);
  if (state.step === 'escape_archive') {
    state.chase = { active: true, speed: 2.35, graceUntil: performance.now() + 2200 };
    const gs = state.checkpoint.guideSpawn || {x:-3.4,z:-1.4};
    spawnGuide(gs.x, gs.z);
  }
  if (state.step === 'escape_detached') {
    state.chase = { active: true, speed: 2.35, graceUntil: performance.now() + 2200 };
    const gs = state.checkpoint.guideSpawn || {x:0,z:-2.8};
    spawnGuide(gs.x, gs.z);
  }
}

function interact(){
  if (state.menuOpen) return;
  if (!dialogueOverlay.classList.contains('hidden')) return;
  const target = getNearestInteractable();
  if (!target) return;
  if (target.type === 'door') {
    useDoor(target.entity);
  } else if (target.type === 'npc') {
    target.entity.onInteract(target.entity);
  } else if (target.type === 'item') {
    target.entity.onInteract(target.entity);
  }
}

function getNearestInteractable(){
  let best = null; let bestScore = Infinity;
  const def = currentStep();
  const trigger = def && def.trigger ? def.trigger : null;
  const facing = { x: -Math.sin(player.yaw), z: -Math.cos(player.yaw) };
  const all = [];
  doors.forEach(d => all.push({ type: 'door', entity: d, x: d.x, z: d.z, label: d.label }));
  npcs.forEach(n => all.push({ type: 'npc', entity: n, x: n.x, z: n.z, label: n.name }));
  items.forEach(i => all.push({ type: 'item', entity: i, x: i.x, z: i.z, label: i.label }));
  for (const obj of all) {
    const dx = obj.x - player.x, dz = obj.z - player.z;
    const dist = Math.hypot(dx, dz);
    const isCurrentTarget = !!(trigger && trigger.type === obj.type && trigger.id === obj.entity.id);
    const maxDist = obj.type === 'door' ? 2.4 : (isCurrentTarget ? 4.1 : 3.0);
    if (dist > maxDist) continue;
    const dir = dist > 0.001 ? ((dx * facing.x + dz * facing.z) / dist) : 1;
    const minDir = obj.type === 'door' ? 0.08 : (isCurrentTarget ? -0.55 : -0.18);
    if (dir < minDir && dist > 1.2) continue;
    const score = dist - (isCurrentTarget ? 0.75 : 0);
    if (score < bestScore) { bestScore = score; best = obj; }
  }
  return best;
}
function useDoor(door){
  const now = performance.now();
  if (now < state.doorCooldownUntil || now < state.inputLockUntil) return;
  if (state.lastDoorId === door.id) return;
  if (state.step === 'start_note' && door.id === 'homeToTown') {
    showDialogue([['主人公', '机の手紙を確認してから出よう。', 'hero']], ()=>{});
    return;
  }
  const leavingArea = state.area;
  const chaseSucceeded = !!(state.chase && ((state.step === 'escape_archive' && leavingArea === 'archive' && door.toArea !== 'archive') || (state.step === 'escape_detached' && leavingArea === 'detached' && door.toArea !== 'detached')));
  state.lastDoorId = door.id;
  state.doorCooldownUntil = now + 1600;
  state.inputLockUntil = now + 950;
  resetInput();
  if (chaseSucceeded) {
    stopChase();
    state.checkpoint = null;
    gameOverEl.classList.add('hidden');
  }
  returnHomeEl.classList.add('hidden');
  state.area = door.toArea;
  buildArea(state.area);
  player.x = door.toSpawn.x;
  player.z = door.toSpawn.z;
  player.yaw = door.toSpawn.yaw || 0;
  player.pitch = 0;
  if (chaseSucceeded) {
    if (state.step === 'escape_archive') {
      openReturnHome();
      return;
    } else if (state.step === 'escape_detached') setStep('finale');
  }
  if (door.id === 'homeToTown' && state.step === 'leave_home') setStep('walk_to_ryokan');
  else if (door.id === 'townToLobby' && state.step === 'walk_to_ryokan') setStep('talk_okami');
  else if (door.id === 'homeToTown' && state.step === 'leave_home_day2') setStep('commute_day2');
  else if (door.id === 'townToLobby' && state.step === 'commute_day2') setStep('talk_maid');
}


function updatePrompt(){
  const now = performance.now();
  const obj = getNearestInteractable();
  if (!obj || state.menuOpen || !dialogueOverlay.classList.contains('hidden') || now < state.inputLockUntil) {
    promptEl.classList.remove('show');
    return;
  }
  const kind = obj.type === 'door' ? '移動' : (obj.type === 'npc' ? '話す' : '調べる');
  promptEl.textContent = 'E / ACT : ' + obj.label + ' / ' + kind;
  promptEl.classList.add('show');
}

function updateObjectiveDistance(){
  const def = currentStep();
  const approx = calculateDistanceToObjective();
  distanceLabelEl.textContent = def.sub + ' 約' + Math.max(1, Math.round(approx)) + 'm';
}
function calculateDistanceToObjective(){
  const def = currentStep();
  if (state.area === def.targetArea) return Math.hypot(player.x - def.targetPos.x, player.z - def.targetPos.z);
  const route = shortestAreaDistance(state.area, def.targetArea);
  return route + 6;
}
function shortestAreaDistance(from, to){
  if (from === to) return 0;
  const dist = {}; const done = {};
  Object.keys(graph).forEach(k => dist[k] = Infinity);
  dist[from] = 0;
  while (true) {
    let current = null, currentDist = Infinity;
    Object.keys(dist).forEach(k => { if (!done[k] && dist[k] < currentDist) { current = k; currentDist = dist[k]; } });
    if (!current) break;
    if (current === to) break;
    done[current] = true;
    const edges = graph[current] || {};
    Object.keys(edges).forEach(next => { dist[next] = Math.min(dist[next], dist[current] + edges[next]); });
  }
  return dist[to] === Infinity ? 99 : dist[to];
}

function updateMinimap(){
  minimapCtx.clearRect(0,0,minimap.width,minimap.height);
  minimapCtx.fillStyle = 'rgba(8,10,18,.86)';
  roundRect(minimapCtx, 0,0,minimap.width,minimap.height,22); minimapCtx.fill();
  minimapCtx.fillStyle = '#a79b84'; minimapCtx.font = '12px sans-serif'; minimapCtx.fillText('館内導線', 14, 18);
  const nodes = {
    home:[18,30], town:[60,30], lobby:[104,30], kitchen:[104,72], corridor:[156,30], room201:[204,12], room202:[204,48], bath:[252,14], archive:[156,72], north:[204,86], detached:[252,72]
  };
  minimapCtx.strokeStyle='rgba(255,255,255,.14)'; minimapCtx.lineWidth=2;
  Object.keys(graph).forEach(k=>{ Object.keys(graph[k]).forEach(to=>{ if(k<to){ const a=nodes[k], b=nodes[to]; minimapCtx.beginPath(); minimapCtx.moveTo(a[0],a[1]); minimapCtx.lineTo(b[0],b[1]); minimapCtx.stroke(); } }); });
  Object.keys(nodes).forEach(k=>{
    const [x,y]=nodes[k];
    minimapCtx.fillStyle = k===state.area ? '#d4bb7a' : (k===currentStep().targetArea ? '#91aaf3' : '#2b3348');
    roundRect(minimapCtx, x-28, y-12, 56, 24, 6); minimapCtx.fill();
    minimapCtx.fillStyle = '#f1ede5'; minimapCtx.font = '11px sans-serif'; minimapCtx.textAlign='center'; minimapCtx.textBaseline='middle';
    minimapCtx.fillText(areaLabels[k], x, y);
  });
  minimapCtx.textAlign='start'; minimapCtx.textBaseline='alphabetic';
}
function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

function setCamera(){
  camera.position.set(player.x, player.height, player.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
}

function movePlayer(dt){
  if (state.menuOpen || !dialogueOverlay.classList.contains('hidden')) return;
  const moveX = input.joyX + ((input.keys.KeyD?1:0) - (input.keys.KeyA?1:0));
  const moveY = input.joyY + ((input.keys.KeyW?1:0) - (input.keys.KeyS?1:0));
  const len = Math.hypot(moveX, moveY);
  if (len < 0.01) return;
  const nx = moveX / Math.max(1, len);
  const nz = moveY / Math.max(1, len);
  const speed = player.speed * (input.keys.ShiftLeft ? player.run : 1) * dt;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const dx = (cos * nx - sin * nz) * speed;
  const dz = (-sin * nx - cos * nz) * speed;
  attemptMove(player.x + dx, player.z + dz);
}
function attemptMove(nx, nz){
  const r = player.radius;
  for (const c of colliders) {
    if (nx + r > c.x1 && nx - r < c.x2 && nz + r > c.z1 && nz - r < c.z2) {
      // try slide X only
      const clearX = !(nx + r > c.x1 && nx - r < c.x2 && player.z + r > c.z1 && player.z - r < c.z2);
      const clearZ = !(player.x + r > c.x1 && player.x - r < c.x2 && nz + r > c.z1 && nz - r < c.z2);
      if (clearX) { player.x = nx; return; }
      if (clearZ) { player.z = nz; return; }
      return;
    }
  }
  player.x = nx; player.z = nz;
}

function updateChase(dt){
  if (!state.chase || !state.guide || state.menuOpen || !dialogueOverlay.classList.contains('hidden')) return;
  const gx = state.guide.group.position.x, gz = state.guide.group.position.z;
  const dx = player.x - gx, dz = player.z - gz;
  const dist = Math.hypot(dx,dz);
  if (performance.now() > state.chase.graceUntil && dist < 0.96) {
    triggerGameOver();
    return;
  }
  const move = Math.min(state.chase.speed * dt, dist * 0.92);
  state.guide.group.position.x += (dx / Math.max(.001, dist)) * move;
  state.guide.group.position.z += (dz / Math.max(.001, dist)) * move;
  state.guide.group.rotation.y = Math.atan2(dx, dz);
}

function updateDoorLatch(){
  if (!state.lastDoorId) return;
  const door = doors.find(d => d.id === state.lastDoorId);
  if (!door) { state.lastDoorId = null; return; }
  const dist = Math.hypot(player.x - door.x, player.z - door.z);
  if (dist > door.radius + 1.2 && performance.now() > state.doorCooldownUntil) state.lastDoorId = null;
}

function update(){
  updateDoorLatch();
  updatePrompt();
  updateObjectiveDistance();
  updateMinimap();
  if (state.hudHidden) {
    hud.style.display = 'none';
    joystickZone.style.display = 'none';
    actBtn.style.display = 'none';
    lookZone.style.display = 'none';
  } else {
    hud.style.display = '';
    joystickZone.style.display = '';
    actBtn.style.display = '';
    lookZone.style.display = '';
  }
}

let lastTime = performance.now();
function animate(now){
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  movePlayer(dt);
  updateChase(dt);
  setCamera();
  update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function slotKey(slot){ return SAVE_PREFIX + String(slot); }
function serializeState(){
  return {
    area: state.area,
    areaLabel: areaLabels[state.area] || state.area,
    step: state.step,
    x: player.x,
    z: player.z,
    yaw: player.yaw,
    pitch: player.pitch,
    hudHidden: state.hudHidden,
    questFlags: state.questFlags,
    ended: state.ended,
    checkpoint: state.checkpoint,
    chaseStep: state.chase ? state.step : null
  };
}
function saveToSlot(slot, silent){
  const data = serializeState();
  if (state.chase && state.checkpoint) {
    data.area = state.checkpoint.area;
    data.areaLabel = areaLabels[data.area] || data.area;
    data.x = state.checkpoint.x;
    data.z = state.checkpoint.z;
    data.yaw = state.checkpoint.yaw;
    data.pitch = 0;
  }
  localStorage.setItem(slotKey(slot), JSON.stringify(data));
  if (!silent) window.alert('SLOT ' + slot + ' に保存しました');
}
function loadFromSlot(slot, silent){
  const raw = localStorage.getItem(slotKey(slot));
  if (!raw) { if (!silent) window.alert('SLOT ' + slot + ' は空です'); return false; }
  try {
    const data = JSON.parse(raw);
    stopChase();
    gameOverEl.classList.add('hidden');
    endingEl.classList.add('hidden');
    returnHomeEl.classList.add('hidden');
    state.menuOpen = false;
    menuOverlay.classList.add('hidden');
    if (slotOverlay) slotOverlay.classList.add('hidden');
    state.area = data.area || 'lobby';
    state.step = data.step || 'talk_okami';
    state.hudHidden = !!data.hudHidden;
    state.questFlags = data.questFlags || {};
    state.ended = !!data.ended;
    state.checkpoint = data.checkpoint || null;
    buildArea(state.area);
    player.x = typeof data.x === 'number' ? data.x : 0;
    player.z = typeof data.z === 'number' ? data.z : 0;
    player.yaw = typeof data.yaw === 'number' ? data.yaw : 0;
    player.pitch = typeof data.pitch === 'number' ? data.pitch : 0;
    resetInput();
    state.inputLockUntil = performance.now() + 400;
    state.doorCooldownUntil = performance.now() + 600;
    if (data.chaseStep === 'escape_archive' && state.checkpoint) {
      state.step = 'escape_archive';
      const gs=(state.checkpoint.guideSpawn)||{x:-3.4,z:-1.4};
      state.chase={active:true,speed:2.35,graceUntil:performance.now()+2400};
      spawnGuide(gs.x,gs.z);
    } else if (data.chaseStep === 'escape_detached' && state.checkpoint) {
      state.step = 'escape_detached';
      const gs=(state.checkpoint.guideSpawn)||{x:0,z:-2.8};
      state.chase={active:true,speed:2.35,graceUntil:performance.now()+2400};
      spawnGuide(gs.x,gs.z);
    }
    if (state.ended) endingEl.classList.remove('hidden');
    setStep(state.step);
    if (!silent) window.alert('SLOT ' + slot + ' を読み込みました');
    return true;
  } catch (e) {
    console.error(e);
    if (!silent) window.alert('SLOT ' + slot + ' の読み込みに失敗しました');
    return false;
  }
}
function slotSummary(slot){
  const raw = localStorage.getItem(slotKey(slot));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
function openSlotOverlay(mode){
  state.slotMode = mode;
  slotTitleEl.textContent = mode === 'save' ? 'SAVE' : 'LOAD';
  slotNoteEl.textContent = mode === 'save' ? '保存先のスロットを選んでください。' : '読み込むスロットを選んでください。';
  slotListEl.innerHTML = '';
  for (let i=1;i<=3;i++) {
    const data = slotSummary(i);
    const btn = document.createElement('button');
    btn.className = 'slot-btn';
    if (data) {
      const label = (data.areaLabel || areaLabels[data.area] || data.area || '不明') + ' / ' + ((stepDefs[data.step] && stepDefs[data.step].sub) || data.step || '進行中');
      btn.innerHTML = '<strong>SLOT ' + i + '</strong><span>' + label + '</span>';
    } else {
      btn.innerHTML = '<strong>SLOT ' + i + '</strong><span>空き</span>';
    }
    btn.dataset.slot = String(i);
    slotListEl.appendChild(btn);
  }
  slotOverlay.classList.remove('hidden');
}
function closeSlotOverlay(){
  state.slotMode = null;
  slotOverlay.classList.add('hidden');
}

function resetInput(){
  input.joyX = 0; input.joyY = 0; input.keys = Object.create(null);
  input.joyId = null; input.lookId = null; input.lookDragging = false; input.mouseDrag = false;
  centerJoystick();
}

function setupControls(){
  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', function(e){
    if (e.code === 'KeyE') { interact(); e.preventDefault(); return; }
    if (e.code === 'Escape') { toggleMenu(); e.preventDefault(); return; }
    input.keys[e.code] = true;
  });
  document.addEventListener('keyup', function(e){ input.keys[e.code] = false; });
  actBtn.addEventListener('pointerdown', function(e){ e.preventDefault(); interact(); });
  menuBtn.addEventListener('click', toggleMenu);
  menuOverlay.addEventListener('click', function(e){
    const btn = e.target.closest('button'); if (!btn) return;
    const act = btn.dataset.action;
    if (act === 'close') toggleMenu(false);
    else if (act === 'save') { toggleMenu(false); openSlotOverlay('save'); }
    else if (act === 'load') { toggleMenu(false); openSlotOverlay('load'); }
    else if (act === 'hud') { state.hudHidden = !state.hudHidden; toggleMenu(false); saveToSlot(1, true); }
    else if (act === 'title') { stopChase(); gameOverEl.classList.add('hidden'); location.href = 'index.html'; }
  });
  gameOverEl.addEventListener('click', function(e){
    const btn = e.target.closest('button'); if (!btn) return;
    if (btn.dataset.go === 'retry') { gameOverEl.classList.add('hidden'); retryFromCheckpoint(); }
    else location.href = 'index.html';
  });
  slotOverlay.addEventListener('click', function(e){
    const closeBtn = e.target.closest('[data-slot-close]');
    if (closeBtn || e.target === slotOverlay) { closeSlotOverlay(); return; }
    const btn = e.target.closest('[data-slot]');
    if (!btn) return;
    const slot = Number(btn.dataset.slot || '0');
    if (!slot) return;
    if (state.slotMode === 'save') { saveToSlot(slot, false); closeSlotOverlay(); }
    else if (state.slotMode === 'load') { loadFromSlot(slot, false); closeSlotOverlay(); }
  });
  endingEl.addEventListener('click', function(e){ if (e.target.closest('button')) location.href = 'index.html'; });
  returnHomeEl.addEventListener('click', function(e){
    if (e.target === returnHomeEl || e.target.closest('[data-return-home]')) goHomeNow();
  });

  joystickZone.addEventListener('pointerdown', startJoy);
  window.addEventListener('pointermove', moveJoy);
  window.addEventListener('pointerup', endJoy);
  lookZone.addEventListener('pointerdown', startLook);
  canvas.addEventListener('pointerdown', function(e){
    if (state.menuOpen) return;
    if (e.clientX > window.innerWidth * 0.38) {
      input.lookId = e.pointerId;
      input.lookDragging = true;
      input.pointerX = e.clientX;
      input.pointerY = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
    }
  });
  window.addEventListener('pointermove', moveLook);
  window.addEventListener('pointerup', endLook);
  canvas.addEventListener('mousedown', function(e){ if (e.clientX > window.innerWidth * .38) { input.mouseDrag = true; input.pointerX = e.clientX; input.pointerY = e.clientY; } });
  window.addEventListener('mousemove', function(e){ if (!input.mouseDrag || state.menuOpen) return; const dx = e.clientX - input.pointerX; const dy = e.clientY - input.pointerY; input.pointerX = e.clientX; input.pointerY = e.clientY; rotateLook(dx,dy); });
  window.addEventListener('mouseup', function(){ input.mouseDrag = false; });
  document.addEventListener('gesturestart', preventer, {passive:false});
  document.addEventListener('dblclick', preventer, {passive:false});
}
function preventer(e){ e.preventDefault(); }
function startJoy(e){ if(state.menuOpen) return; input.joyId = e.pointerId; updateJoy(e); joystickZone.setPointerCapture?.(e.pointerId); }
function moveJoy(e){ if(e.pointerId !== input.joyId) return; updateJoy(e); }
function endJoy(e){ if(e.pointerId !== input.joyId) return; input.joyId = null; input.joyX = 0; input.joyY = 0; centerJoystick(); }
function updateJoy(e){
  const rect = joystickBase.getBoundingClientRect();
  const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
  const dx = e.clientX - cx, dy = e.clientY - cy;
  const max = rect.width * 0.3; const len = Math.hypot(dx,dy); const clamped = Math.min(max, len || 0.001);
  const nx = dx / (len || 1), ny = dy / (len || 1);
  const x = nx * clamped, y = ny * clamped;
  joystickKnob.style.transform = `translate(${x}px, ${y}px)`;
  input.joyX = x / max;
  input.joyY = -(y / max);
}
function centerJoystick(){ joystickKnob.style.transform = 'translate(0px, 0px)'; }
function startLook(e){ if(state.menuOpen) return; input.lookId = e.pointerId; input.lookDragging = true; input.pointerX = e.clientX; input.pointerY = e.clientY; lookZone.setPointerCapture?.(e.pointerId); }
function moveLook(e){ if(!input.lookDragging || e.pointerId !== input.lookId || state.menuOpen) return; const dx = e.clientX - input.pointerX; const dy = e.clientY - input.pointerY; input.pointerX = e.clientX; input.pointerY = e.clientY; rotateLook(dx,dy); }
function endLook(e){ if(e.pointerId !== input.lookId) return; input.lookDragging = false; input.lookId = null; }
function rotateLook(dx,dy){ player.yaw -= dx * 0.0088; player.pitch -= dy * 0.0064; player.pitch = Math.max(-1.05, Math.min(1.05, player.pitch)); }
function toggleMenu(force){
  const open = typeof force === 'boolean' ? force : !state.menuOpen;
  state.menuOpen = open;
  menuOverlay.classList.toggle('hidden', !open);
  if (open) resetInput();
}
function onResize(){ renderer.setSize(window.innerWidth, window.innerHeight, false); camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); }


function beginNewGame(){
  state.area = 'home';
  state.day = 1;
  state.phaseLabel = '昼勤務';
  state.step = 'start_note';
  state.hudHidden = false;
  state.menuOpen = false;
  state.dialogueQueue = [];
  state.checkpoint = null;
  state.chase = null;
  state.guide = null;
  state.slotMode = null;
  state.lastDoorId = null;
  state.doorCooldownUntil = 0;
  state.inputLockUntil = 0;
  state.questFlags = {};
  state.ended = false;
  gameOverEl.classList.add('hidden');
  endingEl.classList.add('hidden');
  returnHomeEl.classList.add('hidden');
  dialogueOverlay.classList.add('hidden');
  menuOverlay.classList.add('hidden');
  stopChase();
  buildArea('home');
  player.x = 2.6; player.z = 1.4; player.yaw = Math.PI / 2; player.pitch = 0;
  resetInput();
  setStep('start_note');
}

function init(){
  setupControls();
  const params = new URLSearchParams(location.search);
  const slotParam = Number(params.get('slot') || '0');
  if (params.get('new') === '1') {
    beginNewGame();
    history.replaceState(null, '', 'play.html');
  } else if (slotParam >= 1 && slotParam <= 3) {
    const ok = loadFromSlot(slotParam, true);
    if (!ok) beginNewGame();
    history.replaceState(null, '', 'play.html');
  } else {
    beginNewGame();
  }
  requestAnimationFrame(animate);
}

init();

})();
