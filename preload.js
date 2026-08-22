
const{contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('api',{
 state:()=>ipcRenderer.invoke('state'),
 save:x=>ipcRenderer.invoke('save',x),
 pick:()=>ipcRenderer.invoke('pick'),
 ocr:()=>ipcRenderer.invoke('ocr'),
 run:(a,c)=>ipcRenderer.invoke('run',a,c),
 stop:()=>ipcRenderer.invoke('stop'),
 test:(a,c)=>ipcRenderer.invoke('test',a,c),
 onLog:fn=>ipcRenderer.on('log',(_,v)=>fn(v)),
 onResult:fn=>ipcRenderer.on('result',(_,v)=>fn(v)),
 onOcr:fn=>ipcRenderer.on('ocr',(_,v)=>fn(v)),
 onRegion:fn=>ipcRenderer.on('region',(_,v)=>fn(v)),
 onProgress:fn=>ipcRenderer.on('progress',(_,v)=>fn(v))
});
