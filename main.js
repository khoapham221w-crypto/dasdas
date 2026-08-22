
const {app,BrowserWindow,ipcMain,globalShortcut,screen}=require('electron');
const path=require('path');
const fs=require('fs');
const axios=require('axios');
const screenshot=require('screenshot-desktop');
const sharp=require('sharp');
const {createWorker}=require('tesseract.js');

let win=null,overlay=null,ocrWorker=null,region=null;
let stopRequested=false;
const activeControllers=new Set();

const dir=path.join(app.getPath('userData'),'thanhnu-api');
const file=path.join(dir,'state.json');

let state={
  accounts:[],
  batch:[],
  endpoint:'',
  method:'POST',
  bodyMode:'json', // json | form | query
  usernameField:'username',
  codeField:'code',
  headers:{'content-type':'application/json'},
  extraBody:{},
  concurrency:5,
  timeoutMs:10000,
  stopOnChallenge:true,
  ocrRegion:null,
  ocrScale:1.5,
  results:[],
  updatedAt:Date.now()
};

function save(){
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(file,JSON.stringify(state,null,2),'utf8');
}
function load(){
  try{
    if(fs.existsSync(file)){
      state={...state,...JSON.parse(fs.readFileSync(file,'utf8'))};
    }
  }catch{}
  region=state.ocrRegion||null;
}
function log(x){
  if(win)win.webContents.send('log',`[${new Date().toLocaleTimeString()}] ${x}`);
}
function emitProgress(done,total){
  if(win)win.webContents.send('progress',{done,total,stopped:stopRequested});
}

function textPreview(data){
  try{
    const s=typeof data==='string'?data:JSON.stringify(data);
    return String(s||'').replace(/\s+/g,' ').slice(0,260);
  }catch{return '';}
}

function cloudflareSignals(status,headers,data){
  const h=headers||{};
  const server=String(h.server||h.Server||'').toLowerCase();
  const cfRay=String(h['cf-ray']||h['CF-RAY']||'');
  const body=typeof data==='string'?data:JSON.stringify(data||{});
  const bodySignal=/turnstile|cf-turnstile|challenges\.cloudflare\.com|cf_clearance|challenge-platform|verify you are human|checking your browser|just a moment/i.test(body);
  const headerSignal=server.includes('cloudflare') || !!cfRay;
  const suspiciousStatus=[403,429,503].includes(Number(status));
  return {
    challenge: bodySignal || (headerSignal && suspiciousStatus),
    bodySignal,headerSignal,suspiciousStatus
  };
}

function buildRequest(account,code){
  const body={...state.extraBody,[state.usernameField]:account,[state.codeField]:code};
  const headers={...(state.headers||{})};
  const method=String(state.method||'POST').toUpperCase();
  const mode=state.bodyMode||'json';

  const cfg={
    url:state.endpoint,
    method,
    timeout:Number(state.timeoutMs)||10000,
    validateStatus:()=>true,
    headers
  };

  if(method==='GET' || method==='DELETE' || mode==='query'){
    cfg.params=body;
  }else if(mode==='form'){
    const form=new URLSearchParams();
    for(const [k,v] of Object.entries(body)){
      if(v!==undefined && v!==null) form.append(k,String(v));
    }
    cfg.data=form.toString();
    if(!Object.keys(headers).some(k=>k.toLowerCase()==='content-type')){
      cfg.headers['content-type']='application/x-www-form-urlencoded';
    }
  }else{
    cfg.data=body;
    if(!Object.keys(headers).some(k=>k.toLowerCase()==='content-type')){
      cfg.headers['content-type']='application/json';
    }
  }
  return cfg;
}

async function sendOne(account,code){
  if(stopRequested) return {account,code,ok:false,status:'ĐÃ DỪNG'};
  if(!state.endpoint) return {account,code,ok:false,status:'Chưa cấu hình endpoint'};

  const controller=new AbortController();
  activeControllers.add(controller);
  const cfg=buildRequest(account,code);
  cfg.signal=controller.signal;

  try{
    const r=await axios(cfg);
    const sig=cloudflareSignals(r.status,r.headers,r.data);

    if(sig.challenge){
      if(state.stopOnChallenge){
        stopRequested=true;
        for(const c of activeControllers){
          if(c!==controller){ try{c.abort()}catch{} }
        }
      }
      return {
        account,code,ok:false,http:r.status,status:'CẦN XÁC MINH',
        challenge:true,preview:textPreview(r.data)
      };
    }

    const ok=r.status>=200&&r.status<300;
    return {
      account,code,ok,http:r.status,
      status:ok?'Đã gửi':'HTTP '+r.status,
      preview:textPreview(r.data)
    };
  }catch(e){
    if(e?.code==='ERR_CANCELED' || controller.signal.aborted){
      return {account,code,ok:false,status:'ĐÃ DỪNG',preview:'Request đã hủy'};
    }
    return {account,code,ok:false,status:'Lỗi request',preview:e.message};
  }finally{
    activeControllers.delete(controller);
  }
}

async function runBatch(accounts,codes){
  stopRequested=false;
  const jobs=[];
  for(const account of accounts){
    for(const code of codes) jobs.push({account,code});
  }

  const out=[];
  let cursor=0,done=0;
  const n=Math.max(1,Math.min(20,Number(state.concurrency)||5));
  emitProgress(0,jobs.length);
  log(`Bắt đầu ${jobs.length} request • concurrency ${n}`);

  async function workerFn(){
    while(true){
      if(stopRequested) break;
      const idx=cursor++;
      if(idx>=jobs.length) break;
      const j=jobs[idx];
      const r=await sendOne(j.account,j.code);
      out[idx]=r;
      done++;
      if(win)win.webContents.send('result',r);
      emitProgress(done,jobs.length);

      if(r.challenge){
        log(`Website yêu cầu xác minh tại ${j.account} / ${j.code}.`);
        if(state.stopOnChallenge){
          log('Đã dừng toàn bộ batch để tránh tiếp tục gửi request.');
          break;
        }
      }
    }
  }

  await Promise.all(Array.from({length:n},workerFn));
  state.results=out.filter(Boolean);
  state.updatedAt=Date.now();
  save();
  log(stopRequested?`Đã dừng • hoàn thành ${done}/${jobs.length}`:`Hoàn thành ${done}/${jobs.length}`);
  return state.results;
}

async function stopBatch(){
  stopRequested=true;
  for(const c of activeControllers){
    try{c.abort()}catch{}
  }
  log('Đã nhận lệnh STOP.');
  return {ok:true};
}

async function getOcr(){
  if(ocrWorker)return ocrWorker;
  log('Khởi tạo OCR local...');
  ocrWorker=await createWorker('eng');
  await ocrWorker.setParameters({
    tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    tessedit_pageseg_mode:'11',
    preserve_interword_spaces:'1',
    user_defined_dpi:'150'
  });
  log('OCR sẵn sàng.');
  return ocrWorker;
}

function pickRegion(){
  if(overlay){overlay.focus();return}
  const d=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  overlay=new BrowserWindow({
    x:d.bounds.x,y:d.bounds.y,width:d.bounds.width,height:d.bounds.height,
    transparent:true,frame:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,
    webPreferences:{nodeIntegration:true,contextIsolation:false}
  });
  const ox=d.bounds.x,oy=d.bounds.y;
  const html=`<body style="margin:0;background:rgba(0,0,0,.25);cursor:crosshair;overflow:hidden">
  <div style="position:fixed;top:18px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:10px 16px;border-radius:10px;font:700 16px Segoe UI">Kéo chuột khoanh vùng chứa nhiều code • ESC để hủy</div>
  <div id=b style="position:absolute;border:3px solid #22d3ee;background:rgba(34,211,238,.12);display:none"></div>
  <script>
  const{ipcRenderer}=require('electron');
  const OX=${ox},OY=${oy};
  let sx=0,sy=0,on=false,b=document.getElementById('b');
  onmousedown=e=>{on=true;sx=e.clientX;sy=e.clientY;b.style.display='block'};
  onmousemove=e=>{
    if(!on)return;
    let x=Math.min(sx,e.clientX),y=Math.min(sy,e.clientY),w=Math.abs(e.clientX-sx),h=Math.abs(e.clientY-sy);
    Object.assign(b.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'})
  };
  onmouseup=e=>{
    if(!on)return;on=false;
    let x=Math.min(sx,e.clientX),y=Math.min(sy,e.clientY),width=Math.abs(e.clientX-sx),height=Math.abs(e.clientY-sy);
    if(width>20&&height>20)ipcRenderer.send('region-picked',{x:x+OX,y:y+OY,width,height,displayId:${JSON.stringify(d.id)}})
  };
  onkeydown=e=>{if(e.key==='Escape')ipcRenderer.send('region-cancel')};
  </script>`;
  overlay.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
  overlay.on('closed',()=>overlay=null);
}

async function captureRegion(){
  // screenshot-desktop mặc định chụp primary display. Nếu vùng thuộc display khác,
  // thử truyền screen id; nếu backend không hỗ trợ thì fallback primary.
  let img;
  try{
    if(region?.displayId!==undefined && region?.displayId!==null){
      img=await screenshot({format:'png',screen:String(region.displayId)});
    }
  }catch{}
  if(!img) img=await screenshot({format:'png'});
  return img;
}

async function runOcr(){
  if(!region)return{ok:false,error:'Chưa chọn vùng OCR'};
  const t0=Date.now();
  const img=await captureRegion();

  // Nếu screenshot là đúng display đang chọn thì tọa độ crop phải tương đối display.
  const d=screen.getAllDisplays().find(x=>String(x.id)===String(region.displayId));
  const left=Math.max(0,Math.round(region.x-(d?.bounds?.x||0)));
  const top=Math.max(0,Math.round(region.y-(d?.bounds?.y||0)));
  const scale=Math.max(1,Math.min(2,Number(state.ocrScale)||1.5));

  const crop=await sharp(img)
    .extract({
      left,
      top,
      width:Math.max(1,Math.round(region.width)),
      height:Math.max(1,Math.round(region.height))
    })
    .grayscale()
    .normalize()
    .resize({width:Math.max(1,Math.round(region.width*scale))})
    .png()
    .toBuffer();

  const w=await getOcr();
  const r=await w.recognize(crop);
  const raw=(r.data.text||'').toUpperCase();

  let codes=raw.split(/\r?\n/)
    .map(x=>x.replace(/[^A-Z0-9]/g,''))
    .filter(x=>x.length>=4&&x.length<=12);

  if(!codes.length) codes=raw.match(/[A-Z0-9]{4,12}/g)||[];
  codes=[...new Set(codes)];

  state.batch=codes;
  state.updatedAt=Date.now();
  state.ocrRegion=region;
  save();

  return{ok:true,codes,ms:Date.now()-t0,raw};
}

function createWin(){
  win=new BrowserWindow({
    width:1300,height:860,minWidth:1080,minHeight:720,
    title:'Thánh Nữ v0.5',
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false}
  });
  win.loadFile('renderer.html');
}

app.whenReady().then(async()=>{
  load();
  createWin();
  globalShortcut.register('F1',pickRegion);
  globalShortcut.register('F2',async()=>{
    const r=await runOcr().catch(e=>({ok:false,error:e.message}));
    win?.webContents.send('ocr',r);
  });
  // Warm OCR in background so first F2 is less painful.
  setTimeout(()=>getOcr().catch(e=>log('OCR init lỗi: '+e.message)),500);
});

app.on('will-quit',async()=>{
  globalShortcut.unregisterAll();
  await stopBatch();
  if(ocrWorker)try{await ocrWorker.terminate()}catch{}
});

ipcMain.on('region-picked',(_,r)=>{
  region=r;
  state.ocrRegion=r;
  save();
  if(overlay)overlay.close();
  win?.webContents.send('region',r);
});
ipcMain.on('region-cancel',()=>{if(overlay)overlay.close()});

ipcMain.handle('state',()=>({...state,region}));
ipcMain.handle('save',(_,x)=>{
  state={...state,...x,updatedAt:Date.now()};
  if(region)state.ocrRegion=region;
  save();
  return{ok:true};
});
ipcMain.handle('pick',()=>{pickRegion();return true});
ipcMain.handle('ocr',()=>runOcr().catch(e=>({ok:false,error:e.message})));
ipcMain.handle('run',(_,accounts,codes)=>runBatch(accounts,codes));
ipcMain.handle('stop',()=>stopBatch());
ipcMain.handle('test',(_,account,code)=>sendOne(account,code));
