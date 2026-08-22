
const {app,BrowserWindow,ipcMain,globalShortcut,screen,desktopCapturer}=require('electron');
const path=require('path');
const fs=require('fs');
const sharp=require('sharp');
const {createWorker}=require('tesseract.js');

let win=null,overlay=null,ocrWorker=null,ocrWorkerPromise=null,region=null;
let stopRequested=false;
let mainHiddenForCapture=false;
let ocrBusy=false;
let batchInProgress=false;
let manualVerifyTail=Promise.resolve();
const activeVerifyWindows=new Set();

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
  // MM88 preset
  state.endpoint='https://api.mm88code.com/codes/use-code-public';
  state.method='POST';
  state.bodyMode='json';
  state.usernameField='username';
  state.codeField='code';
  state.headers={'content-type':'application/json','accept':'application/json'};
  state.extraBody={};
  state.concurrency=0; // 0 = gửi toàn bộ cặp đồng thời
  state.timeoutMs=10000;
  state.stopOnChallenge=false;
  state.ocrScale=1;
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

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

const MM88_URL='https://mm88code.com/';

function closeVerifyWindow(bw){
  if(!bw)return;
  activeVerifyWindows.delete(bw);
  try{if(!bw.isDestroyed())bw.destroy()}catch{}
}

async function pageState(bw){
  if(!bw || bw.isDestroyed())return{ready:false,closed:true};
  try{
    return await bw.webContents.executeJavaScript(`(()=>{
      const vis=e=>!!e && !!(e.offsetWidth||e.offsetHeight||e.getClientRects().length) && !e.disabled;
      const all=[...document.querySelectorAll('input,textarea')].filter(vis);
      const textInputs=all.filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const lower=e=>((e.name||'')+' '+(e.id||'')+' '+(e.placeholder||'')+' '+(e.getAttribute('aria-label')||'')).toLowerCase();
      const user=document.querySelector('input[name="username"],textarea[name="username"],#username')
        ||textInputs.find(e=>/user|account|tài khoản|tai khoan/.test(lower(e)))||textInputs[0]||null;
      const code=document.querySelector('input[name="code"],textarea[name="code"],#code')
        ||textInputs.find(e=>/code|mã|ma code/.test(lower(e)))||textInputs.find(e=>e!==user)||null;
      const ts=document.querySelector('input[name="cf-turnstile-response"],textarea[name="cf-turnstile-response"]');
      const verified=!!ts && String(ts.value||'').length>20;
      const hasTurnstile=!!document.querySelector('.cf-turnstile,iframe[src*="challenges.cloudflare.com"],iframe[title*="Cloudflare" i]');
      const body=(document.body?.innerText||'').replace(/\s+/g,' ').slice(0,5000);
      return {ready:!!user&&!!code,verified,hasTurnstile,body};
    })()` ,true);
  }catch(e){return{ready:false,error:e.message};}
}

async function fillPair(bw,account,code){
  if(!bw || bw.isDestroyed())return false;
  try{
    return await bw.webContents.executeJavaScript(`(()=>{
      const account=${JSON.stringify(account)}, code=${JSON.stringify(code)};
      const vis=e=>!!e && !!(e.offsetWidth||e.offsetHeight||e.getClientRects().length) && !e.disabled;
      const all=[...document.querySelectorAll('input,textarea')].filter(vis);
      const textInputs=all.filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const lower=e=>((e.name||'')+' '+(e.id||'')+' '+(e.placeholder||'')+' '+(e.getAttribute('aria-label')||'')).toLowerCase();
      const user=document.querySelector('input[name="username"],textarea[name="username"],#username')
        ||textInputs.find(e=>/user|account|tài khoản|tai khoan/.test(lower(e)))||textInputs[0]||null;
      const codeEl=document.querySelector('input[name="code"],textarea[name="code"],#code')
        ||textInputs.find(e=>/code|mã|ma code/.test(lower(e)))||textInputs.find(e=>e!==user)||null;
      const set=(el,val)=>{
        if(!el)return;
        const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
        const d=Object.getOwnPropertyDescriptor(proto,'value');
        if(d?.set)d.set.call(el,val); else el.value=val;
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
      };
      set(user,account); set(codeEl,code);
      return !!user&&!!codeEl;
    })()`,true);
  }catch{return false;}
}

async function clickSubmit(bw){
  if(!bw || bw.isDestroyed())return false;
  try{
    return await bw.webContents.executeJavaScript(`(()=>{
      const vis=e=>!!e && !!(e.offsetWidth||e.offsetHeight||e.getClientRects().length) && !e.disabled;
      const buttons=[...document.querySelectorAll('button,input[type=submit]')].filter(vis);
      const txt=e=>((e.innerText||e.value||'')+' '+(e.getAttribute('aria-label')||'')).trim();
      const b=buttons.find(e=>/kiểm tra ngay|kiem tra ngay|nhận code|nhan code|sử dụng|su dung|submit|gửi|gui/i.test(txt(e)))
        ||buttons.find(e=>(e.type||'').toLowerCase()==='submit')||buttons[0];
      if(!b)return false;
      b.click(); return true;
    })()`,true);
  }catch{return false;}
}

function classifyPageText(body){
  const t=String(body||'').toLowerCase();
  if(/sử dụng code thành công|su dung code thanh cong|đã cộng|da cong/.test(t))return{done:true,ok:true,status:'THÀNH CÔNG'};
  if(/mã code không tồn tại|ma code khong ton tai|đã hết hạn|da het han/.test(t))return{done:true,ok:false,status:'CODE KHÔNG HỢP LỆ/HẾT HẠN'};
  if(/rate_limit_exceeded|vượt quá giới hạn|vuot qua gioi han/.test(t))return{done:true,ok:false,status:'RATE LIMIT'};
  if(/lỗi dữ liệu không hợp lệ|loi du lieu khong hop le/.test(t))return{done:true,ok:false,status:'DỮ LIỆU KHÔNG HỢP LỆ'};
  return{done:false};
}

async function waitForForm(bw,timeout=15000){
  const until=Date.now()+timeout;
  while(Date.now()<until && !stopRequested && bw && !bw.isDestroyed()){
    const st=await pageState(bw);
    if(st.ready)return st;
    await sleep(250);
  }
  return null;
}

async function waitForVerificationOrShow(bw,account,code,index){
  // Turnstile runs normally inside the real MM88 page. The tool does not
  // export, replay, generate, or submit the token outside that page.
  const autoUntil=Date.now()+6500;
  while(Date.now()<autoUntil && !stopRequested && !bw.isDestroyed()){
    const st=await pageState(bw);
    if(st.verified)return{verified:true,manual:false};
    await sleep(200);
  }
  if(stopRequested || bw.isDestroyed())return{verified:false,stopped:true};

  // All sessions remain active in parallel. Only sessions that actually need
  // a human interaction are presented one-by-one to avoid focus fighting.
  let releaseTurn;
  const previousTurn=manualVerifyTail;
  manualVerifyTail=new Promise(r=>{releaseTurn=r});
  await previousTurn;

  try{
    if(stopRequested || bw.isDestroyed())return{verified:false,stopped:true};

    const recheck=await pageState(bw);
    if(recheck.verified)return{verified:true,manual:false};

    log(`Cặp #${index} cần xác minh trực tiếp trên MM88: ${account} / ${code}.`);
    try{
      bw.show();
      bw.focus();
      bw.setAlwaysOnTop(true,'floating');
      setTimeout(()=>{try{if(!bw.isDestroyed())bw.setAlwaysOnTop(false)}catch{}},1200);
    }catch{}

    const manualUntil=Date.now()+120000;
    while(Date.now()<manualUntil && !stopRequested && !bw.isDestroyed()){
      const st=await pageState(bw);
      if(st.verified){
        try{bw.hide()}catch{}
        return{verified:true,manual:true};
      }
      await sleep(250);
    }
    return{verified:false,timeout:!stopRequested};
  }finally{
    try{releaseTurn()}catch{}
  }
}

async function waitForResult(bw,timeout=12000){
  const until=Date.now()+timeout;
  while(Date.now()<until && !stopRequested && bw && !bw.isDestroyed()){
    const st=await pageState(bw);
    const c=classifyPageText(st.body);
    if(c.done)return{...c,preview:String(st.body||'').slice(0,260)};
    await sleep(250);
  }
  return{done:false,ok:false,status:stopRequested?'ĐÃ DỪNG':'ĐÃ GỬI / CHỜ PHẢN HỒI',preview:''};
}

async function sendOne(account,code,index=1){
  if(stopRequested)return{account,code,ok:false,status:'ĐÃ DỪNG'};

  const bw=new BrowserWindow({
    width:520,height:760,show:false,autoHideMenuBar:true,
    title:`MM88 xác minh #${index} - Code By Thánh Nữ`,
    webPreferences:{
      contextIsolation:true,nodeIntegration:false,
      backgroundThrottling:false,
      partition:'persist:code-by-thanh-nu-mm88'
    }
  });
  activeVerifyWindows.add(bw);
  bw.on('closed',()=>activeVerifyWindows.delete(bw));
  bw.webContents.setWindowOpenHandler(()=>({action:'deny'}));

  try{
    await bw.loadURL(MM88_URL);
    const form=await waitForForm(bw,15000);
    if(!form)return{account,code,ok:false,status:'KHÔNG TÌM THẤY FORM',preview:'MM88 chưa tải được ô tài khoản/code.'};

    const filled=await fillPair(bw,account,code);
    if(!filled)return{account,code,ok:false,status:'KHÔNG ĐIỀN ĐƯỢC FORM'};

    const vr=await waitForVerificationOrShow(bw,account,code,index);
    if(!vr.verified){
      return{account,code,ok:false,status:vr.stopped?'ĐÃ DỪNG':'CẦN XÁC MINH',preview:vr.timeout?'Hết 120 giây chờ xác minh.':''};
    }

    // Re-fill after verification in case the page re-rendered the form.
    await fillPair(bw,account,code);
    const clicked=await clickSubmit(bw);
    if(!clicked)return{account,code,ok:false,status:'KHÔNG TÌM THẤY NÚT GỬI'};

    const rr=await waitForResult(bw,12000);
    return{account,code,ok:!!rr.ok,status:rr.status,preview:rr.preview||''};
  }catch(e){
    return{account,code,ok:false,status:'LỖI BROWSER',preview:e.message};
  }finally{
    closeVerifyWindow(bw);
  }
}

async function runBatch(accounts,codes){
  if(batchInProgress)throw new Error('Batch trước vẫn đang chạy');
  batchInProgress=true;
  stopRequested=false;
  accounts=(accounts||[]).map(x=>String(x).trim()).filter(Boolean);
  codes=(codes||[]).map(x=>String(x).trim().toUpperCase()).filter(x=>/^[A-Z0-9]{6}$/.test(x));
  const limit=Math.min(accounts.length,codes.length);
  const jobs=[];
  for(let i=0;i<limit;i++)jobs.push({account:accounts[i],code:codes[i],index:i+1});

  const out=new Array(jobs.length);
  let done=0;
  emitProgress(0,jobs.length);
  log(`F2 batch: mở ${jobs.length} phiên MM88 song song; Turnstile chạy theo luồng xác minh bình thường của trang.`);
  if(accounts.length!==codes.length)log(`Ghép 1-1 theo thứ tự • dùng ${jobs.length} cặp (acc=${accounts.length}, code=${codes.length}).`);

  try{
    await Promise.all(jobs.map(async(j,idx)=>{
      if(stopRequested){
        out[idx]={account:j.account,code:j.code,ok:false,status:'ĐÃ DỪNG'};
      }else{
        out[idx]=await sendOne(j.account,j.code,j.index);
      }
      done++;
      win?.webContents.send('result',out[idx]);
      emitProgress(done,jobs.length);
    }));

    state.results=out.filter(Boolean);
    state.updatedAt=Date.now();
    save();
    log(stopRequested?`Đã dừng • ${done}/${jobs.length}`:`Hoàn thành ${done}/${jobs.length}`);
    return state.results;
  }finally{
    batchInProgress=false;
  }
}

async function stopBatch(){
  stopRequested=true;
  for(const bw of [...activeVerifyWindows])closeVerifyWindow(bw);
  log('Đã nhận lệnh STOP và đóng các cửa sổ xác minh.');
  return{ok:true};
}

async function getOcr(){
  if(ocrWorker)return ocrWorker;
  if(ocrWorkerPromise)return ocrWorkerPromise;

  ocrWorkerPromise=(async()=>{
    log('Khởi tạo OCR local...');
    const worker=await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      tessedit_pageseg_mode:'11',
      preserve_interword_spaces:'1',
      user_defined_dpi:'150'
    });
    ocrWorker=worker;
    log('OCR sẵn sàng.');
    return worker;
  })();

  try{
    return await ocrWorkerPromise;
  }finally{
    ocrWorkerPromise=null;
  }
}


async function hideMainForCapture(delayMs=140){
  if(!win || win.isDestroyed())return false;
  try{
    const wasVisible=win.isVisible();
    if(wasVisible){
      mainHiddenForCapture=true;
      win.hide();
      await sleep(delayMs);
    }
    return wasVisible;
  }catch{
    return false;
  }
}

function restoreMainAfterCapture(){
  if(!mainHiddenForCapture || !win || win.isDestroyed())return;
  try{
    mainHiddenForCapture=false;
    win.show();
    win.focus();
  }catch{}
}

async function pickRegion(){
  if(batchInProgress){
    log('F1 bị bỏ qua vì batch đang chạy. Bấm STOP hoặc chờ batch kết thúc.');
    return false;
  }
  if(ocrBusy){
    log('F1 bị bỏ qua vì OCR đang chạy.');
    return false;
  }
  if(overlay){
    try{overlay.focus()}catch{}
    return true;
  }

  await hideMainForCapture(140);
  try{
    const d=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    overlay=new BrowserWindow({
      x:d.bounds.x,y:d.bounds.y,width:d.bounds.width,height:d.bounds.height,
      transparent:true,frame:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,
      webPreferences:{nodeIntegration:true,contextIsolation:false}
    });

    overlay.on('closed',()=>{
      overlay=null;
      setTimeout(()=>restoreMainAfterCapture(),80);
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

    await overlay.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
    return true;
  }catch(e){
    log('Không mở được lớp chọn vùng OCR: '+e.message);
    try{if(overlay && !overlay.isDestroyed())overlay.destroy()}catch{}
    overlay=null;
    restoreMainAfterCapture();
    return false;
  }
}
async function captureRegion(){
  const displays=screen.getAllDisplays();
  let d=displays.find(x=>String(x.id)===String(region?.displayId));
  if(!d) d=screen.getDisplayNearestPoint({x:Math.round(region.x),y:Math.round(region.y)});

  const sf=Number(d.scaleFactor)||1;
  const targetW=Math.max(1,Math.round(d.bounds.width*sf));
  const targetH=Math.max(1,Math.round(d.bounds.height*sf));

  const sources=await desktopCapturer.getSources({
    types:['screen'],
    thumbnailSize:{width:targetW,height:targetH},
    fetchWindowIcons:false
  });

  let source=sources.find(s=>String(s.display_id)===String(d.id));
  if(!source && sources.length===1)source=sources[0];
  if(!source){
    throw new Error('Không xác định được đúng màn hình OCR. Hãy bấm F1 và chọn lại vùng trên màn hình cần quét.');
  }
  if(source.thumbnail.isEmpty())throw new Error('Không chụp được màn hình bằng Electron desktopCapturer');

  const size=source.thumbnail.getSize();
  const sx=size.width / d.bounds.width;
  const sy=size.height / d.bounds.height;

  let left=Math.round((region.x-d.bounds.x)*sx);
  let top=Math.round((region.y-d.bounds.y)*sy);
  left=Math.max(0,Math.min(size.width-1,left));
  top=Math.max(0,Math.min(size.height-1,top));

  let width=Math.max(1,Math.round(region.width*sx));
  let height=Math.max(1,Math.round(region.height*sy));
  width=Math.min(width,size.width-left);
  height=Math.min(height,size.height-top);

  if(width<2 || height<2)throw new Error('Vùng OCR nằm ngoài màn hình. Hãy bấm F1 chọn lại vùng.');

  return {
    img:source.thumbnail.toPNG(),
    left,top,width,height
  };
}

async function runOcr(){
  if(batchInProgress)return{ok:false,error:'Batch trước đang chạy. Bấm STOP hoặc chờ xong rồi F2 lại.'};
  if(ocrBusy)return{ok:false,error:'OCR đang chạy, bỏ qua lần F2 này.'};
  if(!region)return{ok:false,error:'Chưa chọn vùng OCR'};

  ocrBusy=true;
  const t0=Date.now();

  try{
  // Quan trọng: desktopCapturer chụp đúng những gì đang hiển thị trên màn hình.
  // Nếu cửa sổ tool đang đè lên vùng OCR thì OCR sẽ đọc chính giao diện tool.
  // Vì vậy tạm ẩn tool trước khi chụp, rồi hiện lại ngay sau khi có screenshot.
  const wasVisible=await hideMainForCapture(140);
  let shot;
  try{
    shot=await captureRegion();
  }finally{
    if(wasVisible)restoreMainAfterCapture();
  }

  const scale=Math.max(1,Math.min(2,Number(state.ocrScale)||1.5));

  const crop=await sharp(shot.img)
    .extract({
      left:shot.left,
      top:shot.top,
      width:shot.width,
      height:shot.height
    })
    .grayscale()
    .normalize()
    .resize({width:Math.max(1,Math.round(shot.width*scale))})
    .png()
    .toBuffer();

  const w=await getOcr();
  const r=await w.recognize(crop);
  const raw=(r.data.text||'').toUpperCase();

  let codes=raw.split(/\r?\n/)
    .map(x=>x.replace(/[^A-Z0-9]/g,''))
    .filter(x=>x.length===6);

  if(!codes.length) codes=raw.match(/\b[A-Z0-9]{6}\b/g)||[];

  state.batch=codes;
  state.updatedAt=Date.now();
  state.ocrRegion=region;
  save();

  return{ok:true,codes,ms:Date.now()-t0,raw};
  }finally{
    ocrBusy=false;
  }
}

function createWin(){
  win=new BrowserWindow({
    width:1300,height:860,minWidth:1080,minHeight:720,
    title:'Code By Thánh Nữ v0.5.9',
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false}
  });
  win.loadFile('renderer.html');
}

app.whenReady().then(async()=>{
  load();
  createWin();

  const f1ok=globalShortcut.register('F1',pickRegion);
  const f2ok=globalShortcut.register('F2',async()=>{
    const r=await runOcr().catch(e=>({ok:false,error:e.message}));
    win?.webContents.send('ocr',r);
  });

  win.webContents.once('did-finish-load',()=>{
    if(!f1ok)log('Không đăng ký được phím F1. Có ứng dụng khác đang chiếm phím.');
    if(!f2ok)log('Không đăng ký được phím F2. Có ứng dụng khác đang chiếm phím.');
  });

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
  else restoreMainAfterCapture();
  win?.webContents.send('region',r);
});
ipcMain.on('region-cancel',()=>{
  if(overlay)overlay.close();
  else restoreMainAfterCapture();
});

ipcMain.handle('state',()=>({...state,region}));
ipcMain.handle('save',(_,x)=>{
  state={...state,...x,updatedAt:Date.now()};
  if(region)state.ocrRegion=region;
  save();
  return{ok:true};
});
ipcMain.handle('pick',()=>pickRegion());
ipcMain.handle('ocr',()=>runOcr().catch(e=>({ok:false,error:e.message})));
ipcMain.handle('run',(_,accounts,codes)=>runBatch(accounts,codes));
ipcMain.handle('stop',()=>stopBatch());
ipcMain.handle('test',(_,account,code)=>sendOne(account,code,1));
