
const $=x=>document.getElementById(x);
const lines=t=>t.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);

function counts(){
  $('ac').textContent=lines($('accounts').value).length+' acc';
  $('cc').textContent=lines($('codes').value).length+' code';
}
$('accounts').oninput=counts;
$('codes').oninput=counts;

function log(x){
  $('log').textContent+=x+'\n';
  $('log').scrollTop=$('log').scrollHeight;
}

function cfg(){
  return{
    endpoint:'https://api.mm88code.com/codes/use-code-public',
    method:'POST',
    bodyMode:'json',
    usernameField:'username',
    codeField:'code',
    headers:{'content-type':'application/json','accept':'application/json'},
    extraBody:{},
    concurrency:1,
    timeoutMs:10000,
    stopOnChallenge:true,
    ocrScale:1,
    accounts:lines($('accounts').value),
    batch:lines($('codes').value).map(x=>x.toUpperCase()).filter(x=>/^[A-Z0-9]{6}$/.test(x))
  };
}


$('pick').onclick=()=>api.pick();

function showOcr(r){
  if(!r?.ok){log('OCR lỗi: '+(r?.error||''));return}
  $('codes').value=(r.codes||[]).join('\n');
  $('ms').textContent=r.ms+' ms';
  counts();
  log(`OCR ${r.codes.length} code trong ${r.ms} ms`);
}
$('ocr').onclick=async()=>showOcr(await api.ocr());
api.onOcr(showOcr);

api.onRegion(r=>{
  $('regionInfo').textContent=`Vùng OCR: x=${r.x}, y=${r.y}, w=${r.width}, h=${r.height}`;
  log(`Đã lưu vùng OCR x=${r.x}, y=${r.y}, w=${r.width}, h=${r.height}`);
});
api.onLog(log);

function safe(s){return String(s??'').replace(/[<>&]/g,'')}
function addResult(r){
  const tr=document.createElement('tr');
  tr.innerHTML=`<td>${safe(r.account)}</td><td>${safe(r.code)}</td><td>${safe(r.http||'')}</td><td>${safe(r.status||'')}</td><td>${safe(r.preview||'')}</td>`;
  $('rows').appendChild(tr);
}
api.onResult(addResult);

api.onProgress(p=>{
  const total=p.total||0,done=p.done||0;
  const pct=total?Math.min(100,Math.round(done*100/total)):0;
  $('bar').style.width=pct+'%';
  $('progressText').textContent=`${done}/${total}`;
  if(p.stopped)$('status').textContent='Đang dừng...';
});

$('clear').onclick=()=>{
  $('rows').innerHTML='';
  $('log').textContent='';
  $('bar').style.width='0';
  $('progressText').textContent='0/0';
};


$('run').onclick=async()=>{
  const c=cfg();
  if(!c.accounts.length||!c.batch.length){$('status').textContent='Cần tài khoản và code 6 ký tự';return}
  const rawCodeCount=lines($('codes').value).length;
  if(c.batch.length!==rawCodeCount){
    log(`Đã bỏ ${rawCodeCount-c.batch.length} dòng code không đúng 6 ký tự.`);
    $('codes').value=c.batch.join('\n');
    counts();
  }
  await api.save(c);
  $('rows').innerHTML='';
  $('bar').style.width='0';
  const totalPairs=Math.min(c.accounts.length,c.batch.length);
  $('progressText').textContent=`0/${totalPairs}`;
  $('status').textContent='Đang chạy nền 1-1...';
  const out=await api.run(c.accounts,c.batch);
  $('status').textContent=`Kết thúc 1-1 • ${out.length} cặp`;
};

$('stop').onclick=async()=>{
  $('status').textContent='Đang dừng...';
  await api.stop();
};

(async()=>{
  const s=await api.state();
  $('accounts').value=(s.accounts||[]).join('\n');
  $('codes').value=(s.batch||[]).join('\n');
  if(s.region){
    const rr=s.region;
    $('regionInfo').textContent=`Vùng OCR: x=${rr.x}, y=${rr.y}, w=${rr.width}, h=${rr.height}`;
  }
  counts();
})();
