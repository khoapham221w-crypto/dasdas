
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
  let h={},e={};
  try{h=JSON.parse($('headers').value||'{}')}catch{log('Headers JSON không hợp lệ, dùng {}')}
  try{e=JSON.parse($('extra').value||'{}')}catch{log('Extra body JSON không hợp lệ, dùng {}')}
  return{
    endpoint:$('endpoint').value.trim(),
    method:$('method').value,
    bodyMode:$('bodyMode').value,
    usernameField:$('uf').value.trim(),
    codeField:$('cf').value.trim(),
    headers:h,
    extraBody:e,
    concurrency:+$('conc').value||5,
    timeoutMs:+$('timeout').value||10000,
    stopOnChallenge:$('stopChallenge').checked,
    ocrScale:+$('ocrScale').value||1.5,
    accounts:lines($('accounts').value),
    batch:lines($('codes').value)
  };
}

$('save').onclick=async()=>{
  await api.save(cfg());
  $('status').textContent='Đã lưu cấu hình';
};

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

$('test').onclick=async()=>{
  await api.save(cfg());
  const a=lines($('accounts').value)[0],c=lines($('codes').value)[0];
  if(!a||!c){$('status').textContent='Cần ít nhất 1 acc và 1 code';return}
  $('status').textContent='Đang test...';
  const r=await api.test(a,c);
  addResult(r);
  $('status').textContent=r.status;
};

$('run').onclick=async()=>{
  const c=cfg();
  if(!c.endpoint){$('status').textContent='Chưa nhập Endpoint';return}
  if(!c.accounts.length||!c.batch.length){$('status').textContent='Cần tài khoản và code';return}
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
  $('endpoint').value=s.endpoint||'';
  $('method').value=s.method||'POST';
  $('bodyMode').value=s.bodyMode||'json';
  $('uf').value=s.usernameField||'username';
  $('cf').value=s.codeField||'code';
  $('conc').value=s.concurrency||5;
  $('timeout').value=s.timeoutMs||10000;
  $('stopChallenge').checked=s.stopOnChallenge!==false;
  $('ocrScale').value=String(s.ocrScale||1.5);
  $('headers').value=JSON.stringify(s.headers||{'content-type':'application/json'},null,2);
  $('extra').value=JSON.stringify(s.extraBody||{},null,2);
  $('accounts').value=(s.accounts||[]).join('\n');
  $('codes').value=(s.batch||[]).join('\n');
  if(s.region){
    const r=s.region;
    $('regionInfo').textContent=`Vùng OCR: x=${r.x}, y=${r.y}, w=${r.width}, h=${r.height}`;
  }
  counts();
})();
