/* CLS Generator Operations: all records are saved in this browser (localStorage) */
(function(){
"use strict";
const GENS=["Generator 1","Generator 2","Generator 3"];
const GENS_ALL=[...GENS,"All generators"];
const AREAS=["Generator 1","Generator 2","Generator 3","Generator hall","Power channel (cables)","Exhaust pipe","Outdoor fan","Fuel tanks","Water compressor"];
const BIG=40, SMALL=20;

/* ---------- Date helpers ---------- */
const DAY=86400000;
function parseD(s){if(!s)return null;const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)}
function iso(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function today(){const t=new Date();return new Date(t.getFullYear(),t.getMonth(),t.getDate())}
function diff(a,b){return Math.round((b-a)/DAY)}
function addDays(d,n){return new Date(d.getTime()+n*DAY)}
function addMonths(d,n){const r=new Date(d);r.setMonth(r.getMonth()+n);return r}
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fd(s){const d=typeof s==="string"?parseD(s):s;if(!d)return "—";return d.getDate()+" "+MON[d.getMonth()]+" "+d.getFullYear()}
function fds(d){return d.getDate()+" "+MON[d.getMonth()]}
function rel(d){const n=diff(today(),d);if(n===0)return "today";if(n===1)return "tomorrow";if(n===-1)return "yesterday";return n>0?"in "+n+" days":Math.abs(n)+" days ago"}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}

/* ---------- Data store ---------- */
const COLS=["fuel","spares","filterChanges","filterOrders","problems","replacements","painting","uniforms","staff","tasks"];
const data={}; COLS.forEach(c=>data[c]=[]);
let db=null, mode="local";
const LS="cls-gen-dashboard-v1";
function loadLocal(){try{const raw=localStorage.getItem(LS);if(raw){const o=JSON.parse(raw);COLS.forEach(c=>{if(Array.isArray(o[c]))data[c]=o[c]})}}catch(e){}}
function saveLocal(){try{localStorage.setItem(LS,JSON.stringify(data))}catch(e){}}
async function saveRec(col,rec){
  const id=rec.id||uid(); const body={...rec}; delete body.id;
  if(db){ try{ await db.collection(col).doc(id).set(body); }catch(e){ toast(e&&e.code==="invalid_argument"?"You have view-only access to this dashboard.":"Could not save. Check your connection and try again."); return false;} }
  else{ const arr=data[col]; const i=arr.findIndex(r=>r.id===id); if(i>=0)arr[i]={id,...body}; else arr.push({id,...body}); saveLocal(); render(); }
  return true;
}
async function delRec(col,id){
  if(db){ try{ await db.collection(col).doc(id).delete(); }catch(e){ toast("Could not delete. Try again."); } }
  else{ data[col]=data[col].filter(r=>r.id!==id); saveLocal(); render(); }
}
let renderQueued=false;
function queueRender(){ if(renderQueued)return; renderQueued=true; requestAnimationFrame(()=>{renderQueued=false;render()}); }
function setSync(on,txt){document.getElementById("syncDot").className="dot"+(on?" on":"");document.getElementById("syncLbl").textContent=txt}

/* Adds the Head of Technical and the Network and Upstream Internet department to the reporting line once */
const ORG_V="cls-gen-org-v2";
function migrateOrg(){
  try{if(localStorage.getItem(ORG_V))return}catch(e){}
  const head="Abdulghani Saeed";
  if(!data.staff.some(s=>s.role===HEAD_ROLE)) data.staff.push({id:uid(),name:head,role:HEAD_ROLE,dept:DEPT_TECH,reportsTo:"",order:0});
  data.staff.filter(s=>s.role==="CLS Manager"&&!s.reportsTo).forEach(s=>s.reportsTo=head);
  if(!data.staff.some(s=>s.role==="Network Manager")) data.staff.push({id:uid(),name:"Network Manager (vacant)",role:"Network Manager",dept:DEPT_NET,reportsTo:head,order:10});
  saveLocal(); try{localStorage.setItem(ORG_V,"1")}catch(e){}
}
function initStore(){
  loadLocal(); migrateOrg(); render(); setSync(true,"Saved in this browser");
}
/* Saves a text file to the device (CSV exports and backups) */
const downloads={save({filename,data,type}){
  const url=URL.createObjectURL(new Blob([data],{type:type||"text/csv;charset=utf-8"}));
  const a=document.createElement("a"); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}};

/* ---------- Backup and restore ---------- */
function backupData(){
  downloads.save({filename:`cls-generator-backup-${iso(today())}.json`,data:JSON.stringify(data,null,2),type:"application/json"});
  toast("Backup saved");
}
function restoreData(file){
  const fr=new FileReader();
  fr.onload=()=>{
    let o=null; try{o=JSON.parse(fr.result)}catch(e){}
    if(!o||typeof o!=="object"||!COLS.some(c=>Array.isArray(o[c]))){toast("That file is not a CLS generator backup.");return;}
    const n=COLS.reduce((s,c)=>s+(Array.isArray(o[c])?o[c].length:0),0);
    openModal(`<header><h4>Restore this backup?</h4></header><div class="body"><p>The backup holds ${n} records. Restoring replaces everything saved in this browser now.</p></div>
     <footer><button class="btn ghost" data-close>Keep current data</button><button class="btn" id="yesRestore">Restore backup</button></footer>`);
    document.getElementById("yesRestore").addEventListener("click",()=>{
      COLS.forEach(c=>{data[c]=Array.isArray(o[c])?o[c].map(r=>({...r,id:r.id||uid()})):[]});
      saveLocal(); closeModal(); render(); toast("Backup restored");
    });
  };
  fr.readAsText(file);
}

/* ---------- Module definitions ---------- */
const staffNames=()=>data.staff.map(s=>s.name).sort();
const HEAD_ROLE="Head of Technical", DEPT_CLS="CLS Generators", DEPT_NET="Network and Upstream Internet", DEPT_TECH="Technical";
const ROLES=[HEAD_ROLE,"CLS Manager","Mechanic","Gen Operator","Network Manager","Other"];
const DEPTS=[DEPT_TECH,DEPT_CLS,DEPT_NET];
const deptOf=s=>s.dept||(s.role===HEAD_ROLE?DEPT_TECH:s.role==="Network Manager"?DEPT_NET:DEPT_CLS);
const TABS=[
 {id:"overview",label:"Overview",color:"var(--overview)",icon:"M3 12h4l3 8 4-16 3 8h4"},
 {id:"fuel",label:"Fuel",color:"var(--fuel)",icon:"M3 22h12M4 9h10M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.83a2 2 0 0 0-.59-1.42L18 5"},
 {id:"spares",label:"Spare inventory",color:"var(--spares)",icon:"M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"},
 {id:"filters",label:"Filters",color:"var(--filters)",icon:"M3 4h18l-7 9v6l-4 2v-8z"},
 {id:"problems",label:"Problems & fixes",color:"var(--problems)",icon:"M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"},
 {id:"replaced",label:"Replaced parts",color:"var(--replaced)",icon:"M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"},
 {id:"painting",label:"Anti-corrosion",color:"var(--painting)",icon:"M19 11h-7V4a2 2 0 0 0-4 0v7H4v4a7 7 0 0 0 7 7h2a7 7 0 0 0 7-7v-4z"},
 {id:"uniforms",label:"Uniforms",color:"var(--uniforms)",icon:"M16 3 20 6 18 10 16 9v12H8V9l-2 1-2-4 4-3c1 1.5 2.3 2 4 2s3-.5 4-2z"},
 {id:"staff",label:"Staff & tasks",color:"var(--staff)",icon:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"}
];

const SCHEMAS={
 fuel:{title:"fuel cycle",fields:[
   {k:"order",label:"Fuel ordered",type:"date"},{k:"received",label:"Fuel received",type:"date",req:1},
   {k:"small1",label:"First transfer to small tank",type:"date",hint:"Big tank 40 → 20 (20 in reserve)"},
   {k:"small2",label:"Second transfer to small tank",type:"date",hint:"Big tank empty → order fuel"},
   {k:"barrels",label:"Barrels delivered",type:"number",def:40},{k:"notes",label:"Notes",type:"textarea",full:1}],
   sort:(a,b)=>(b.received||"").localeCompare(a.received||"")},
 spares:{title:"spare part",fields:[
   {k:"item",label:"Item",req:1},{k:"partNo",label:"Part number"},
   {k:"category",label:"Category",type:"select",options:["Filter","Belt","Electrical","Engine","Cooling","Fuel system","Battery","Other"]},
   {k:"generator",label:"For",type:"select",options:GENS_ALL},
   {k:"qty",label:"Quantity in stock",type:"number",def:0},{k:"minQty",label:"Reorder when below",type:"number",def:1},
   {k:"location",label:"Storage location"},{k:"notes",label:"Notes",type:"textarea",full:1}],
   cols:[{k:"item",label:"Item",f:r=>`<b>${esc(r.item)}</b><div class="hint">${esc(r.partNo||"")}</div>`},{k:"category",label:"Category"},{k:"generator",label:"For"},
     {k:"qty",label:"In stock",f:r=>qtyCell(r)},{k:"minQty",label:"Min"},{k:"status",label:"Status",f:r=>stockPill(r)},{k:"location",label:"Location"}],
   sort:(a,b)=>(a.item||"").localeCompare(b.item||"")},
 filterChanges:{title:"filter change",fields:[
   {k:"date",label:"Date changed",type:"date",req:1,def:()=>iso(today())},{k:"generator",label:"Generator",type:"select",options:GENS,req:1},
   {k:"filters",label:"Filters changed",type:"multi",options:["Oil","Fuel","Air","Water separator","Coolant"],full:1},
   {k:"runHours",label:"Run hours",type:"number"},{k:"doneBy",label:"Done by",type:"select",options:staffNames},{k:"notes",label:"Notes",type:"textarea",full:1}],
   cols:[{k:"date",label:"Date",f:r=>fd(r.date)},{k:"generator",label:"Generator"},{k:"filters",label:"Filters",f:r=>(r.filters||[]).map(x=>`<span class="tag">${esc(x)}</span>`).join("")},
     {k:"runHours",label:"Run hours"},{k:"doneBy",label:"Done by"},{k:"notes",label:"Notes",f:r=>`<div class="clip">${esc(r.notes)}</div>`}],
   sort:(a,b)=>(b.date||"").localeCompare(a.date||"")},
 filterOrders:{title:"filter order",fields:[
   {k:"orderDate",label:"Order date",type:"date",req:1,def:()=>iso(today())},{k:"receivedDate",label:"Received date",type:"date"},
   {k:"items",label:"Items ordered",type:"textarea",full:1,hint:"e.g. 6 oil, 6 fuel, 6 air filters"},{k:"supplier",label:"Supplier"},{k:"notes",label:"Notes"}],
   cols:[{k:"orderDate",label:"Ordered",f:r=>fd(r.orderDate)},{k:"receivedDate",label:"Received",f:r=>r.receivedDate?fd(r.receivedDate):`<span class="pill warn">Awaiting</span>`},
     {k:"items",label:"Items",f:r=>`<div class="clip">${esc(r.items)}</div>`},{k:"supplier",label:"Supplier"},{k:"notes",label:"Notes"}],
   sort:(a,b)=>(b.orderDate||"").localeCompare(a.orderDate||"")},
 problems:{title:"problem",fields:[
   {k:"date",label:"Date reported",type:"date",req:1,def:()=>iso(today())},{k:"generator",label:"Generator",type:"select",options:GENS_ALL,req:1},
   {k:"title",label:"Problem",req:1,full:1},{k:"details",label:"What happened",type:"textarea",full:1},
   {k:"cause",label:"Root cause",type:"textarea",full:1},{k:"fix",label:"How it was fixed",type:"textarea",full:1,hint:"Kept as a reference for next time"},
   {k:"status",label:"Status",type:"select",options:["Open","In progress","Fixed"],def:"Open"},{k:"fixedDate",label:"Fixed on",type:"date"},
   {k:"reportedBy",label:"Reported by",type:"select",options:staffNames},{k:"fixedBy",label:"Fixed by",type:"select",options:staffNames}],
   cols:[{k:"date",label:"Date",f:r=>fd(r.date)},{k:"generator",label:"Generator"},{k:"title",label:"Problem",f:r=>`<b>${esc(r.title)}</b><div class="hint clip">${esc(r.details||"")}</div>`},
     {k:"fix",label:"Fix",f:r=>`<div class="clip">${esc(r.fix||"—")}</div>`},{k:"status",label:"Status",f:r=>statusPill(r.status)},{k:"fixedBy",label:"Fixed by"}],
   sort:(a,b)=>(b.date||"").localeCompare(a.date||"")},
 replacements:{title:"replaced part",fields:[
   {k:"date",label:"Date",type:"date",req:1,def:()=>iso(today())},{k:"generator",label:"Generator",type:"select",options:GENS,req:1},
   {k:"faulty",label:"Faulty item",req:1},{k:"partNo",label:"Part number"},{k:"replacedWith",label:"Replaced with"},{k:"qty",label:"Quantity",type:"number",def:1},
   {k:"reason",label:"Reason / fault",type:"textarea",full:1},{k:"doneBy",label:"Done by",type:"select",options:staffNames}],
   cols:[{k:"date",label:"Date",f:r=>fd(r.date)},{k:"generator",label:"Generator"},{k:"faulty",label:"Faulty item",f:r=>`<b>${esc(r.faulty)}</b><div class="hint">${esc(r.partNo||"")}</div>`},
     {k:"replacedWith",label:"Replaced with"},{k:"qty",label:"Qty"},{k:"reason",label:"Reason",f:r=>`<div class="clip">${esc(r.reason)}</div>`},{k:"doneBy",label:"Done by"}],
   sort:(a,b)=>(b.date||"").localeCompare(a.date||"")},
 painting:{title:"painting round",fields:[
   {k:"round",label:"Round",req:1,hint:"e.g. First half 2026"},{k:"startDate",label:"Started",type:"date",def:()=>iso(today())},
   {k:"areas",label:"Areas completed",type:"multi",options:AREAS,full:1},{k:"completedDate",label:"All areas finished on",type:"date"},
   {k:"doneBy",label:"Team / contractor"},{k:"notes",label:"Notes",type:"textarea",full:1}],
   cols:[{k:"round",label:"Round",f:r=>`<b>${esc(r.round)}</b>`},{k:"startDate",label:"Started",f:r=>fd(r.startDate)},{k:"completedDate",label:"Finished",f:r=>r.completedDate?fd(r.completedDate):`<span class="pill warn">In progress</span>`},
     {k:"areas",label:"Progress",f:r=>`${(r.areas||[]).length} of ${AREAS.length}<div class="progress" style="--c:var(--painting);width:120px"><i style="width:${Math.round((r.areas||[]).length/AREAS.length*100)}%"></i></div>`},{k:"doneBy",label:"Team"}],
   sort:(a,b)=>(b.startDate||"").localeCompare(a.startDate||"")},
 uniforms:{title:"uniform order",fields:[
   {k:"orderDate",label:"Order date",type:"date",req:1,def:()=>iso(today())},{k:"staff",label:"Staff member",type:"select",options:staffNames,req:1},
   {k:"items",label:"Items",type:"multi",options:["Coverall","Safety boots","Helmet","Gloves","Ear protection","Reflective vest","T-shirt"],full:1},
   {k:"size",label:"Size"},{k:"qty",label:"Sets",type:"number",def:1},{k:"receivedDate",label:"Received",type:"date"},{k:"notes",label:"Notes"}],
   cols:[{k:"orderDate",label:"Ordered",f:r=>fd(r.orderDate)},{k:"staff",label:"Staff"},{k:"items",label:"Items",f:r=>(r.items||[]).map(x=>`<span class="tag">${esc(x)}</span>`).join("")},
     {k:"size",label:"Size"},{k:"qty",label:"Sets"},{k:"receivedDate",label:"Received",f:r=>r.receivedDate?fd(r.receivedDate):`<span class="pill warn">Awaiting</span>`}],
   sort:(a,b)=>(b.orderDate||"").localeCompare(a.orderDate||"")},
 staff:{title:"staff member",fields:[
   {k:"name",label:"Full name",req:1},{k:"role",label:"Role / title",type:"select",options:ROLES},
   {k:"dept",label:"Department",type:"select",options:DEPTS,def:DEPT_CLS},
   {k:"reportsTo",label:"Reports to",type:"select",options:staffNames},{k:"phone",label:"Phone"},{k:"order",label:"Sort order",type:"number"}],
   sort:(a,b)=>(a.order===0?0:a.order||99)-(b.order===0?0:b.order||99)||(a.name||"").localeCompare(b.name||"")},
 tasks:{title:"task",fields:[
   {k:"title",label:"Task",req:1,full:1},{k:"assignee",label:"Assigned to",type:"select",options:staffNames,req:1},
   {k:"generator",label:"Generator / area",type:"select",options:[...GENS_ALL,"Fuel","Generator hall","Other"]},
   {k:"assigned",label:"Assigned on",type:"date",def:()=>iso(today())},{k:"due",label:"Due date",type:"date"},
   {k:"priority",label:"Priority",type:"select",options:["Low","Normal","High","Urgent"],def:"Normal"},
   {k:"status",label:"Status",type:"select",options:["To do","In progress","Done"],def:"To do"},{k:"completed",label:"Completed on",type:"date"},
   {k:"rating",label:"Performance rating",type:"select",options:["","1","2","3","4","5"],hint:"1 poor, 5 excellent"},{k:"notes",label:"Notes",type:"textarea",full:1}],
   cols:[{k:"title",label:"Task",f:r=>`<b>${esc(r.title)}</b><div class="hint">${esc(r.generator||"")}</div>`},{k:"assignee",label:"Assigned to"},
     {k:"due",label:"Due",f:r=>dueCell(r)},{k:"priority",label:"Priority",f:r=>prioPill(r.priority)},{k:"status",label:"Status",f:r=>statusPill(r.status)},
     {k:"rating",label:"Rating",f:r=>r.rating?`<span class="stars">${"★".repeat(+r.rating)}</span>`:"—"}],
   sort:(a,b)=>((a.status==="Done")-(b.status==="Done"))||(a.due||"9").localeCompare(b.due||"9")}
};

function stockPill(r){const q=+r.qty||0,m=+r.minQty||0;if(q<=0)return `<span class="pill bad">Out of stock</span>`;if(q<m)return `<span class="pill warn">Low</span>`;return `<span class="pill ok">OK</span>`}
function qtyCell(r){return `<span style="display:inline-flex;align-items:center;gap:6px"><button class="icon-btn" data-qty="-1" data-id="${r.id}" aria-label="Decrease">−</button><b style="min-width:22px;text-align:center">${+r.qty||0}</b><button class="icon-btn" data-qty="1" data-id="${r.id}" aria-label="Increase">+</button></span>`}
function statusPill(s){const m={"Open":"bad","In progress":"warn","Fixed":"ok","Done":"ok","To do":"info"};return s?`<span class="pill ${m[s]||"neutral"}">${esc(s)}</span>`:"—"}
function prioPill(p){const m={Urgent:"bad",High:"warn",Normal:"info",Low:"neutral"};return p?`<span class="pill ${m[p]||"neutral"}">${esc(p)}</span>`:"—"}
function dueCell(r){if(!r.due)return "—";const d=parseD(r.due);if(r.status!=="Done"&&d<today())return `<span class="pill bad">${fd(r.due)}</span>`;return fd(r.due)}

/* ---------- Fuel analytics ---------- */
function fuelStats(){
  /* Process: delivery fills the big tank (40). The small tank is still running on the last transfer.
     small1 = first transfer (big 40 -> 20, 20 kept in reserve).
     small2 = second transfer (big 20 -> 0): big tank empty, order fuel while the small tank runs. */
  const cyc=[...data.fuel].filter(c=>c.received).sort((a,b)=>a.received.localeCompare(b.received));
  const spans=[];
  cyc.forEach((c,i)=>{const prev=cyc[i-1];const S1=parseD(c.small1),S2=parseD(c.small2);
    const start=prev&&prev.small2?parseD(prev.small2):null;
    if(S1&&start)spans.push(diff(start,S1)); if(S1&&S2)spans.push(diff(S1,S2));});
  const recent=spans.slice(-8);
  const avg20=recent.length?recent.reduce((a,b)=>a+b,0)/recent.length:14;
  const done=cyc.filter(c=>c.small2).map(c=>({c,days:diff(parseD(c.received),parseD(c.small2))}));
  const avgCycle=done.length?done.slice(-6).reduce((a,b)=>a+b.days,0)/Math.min(6,done.length):avg20*2;
  const perDay=BIG/avgCycle;
  const cur=cyc[cyc.length-1]||null, prev=cyc[cyc.length-2]||null; const t=today();
  const st={cur,avg20,avgCycle,perDay,big:0,small:0,phase:"none",orderDate:null,transferDate:null,runOut:null,cyc,done};
  st.pendingOrder=[...data.fuel].find(c=>c.order&&!c.received)||null;
  if(!cur)return st;
  const R=parseD(cur.received),S1=parseD(cur.small1),S2=parseD(cur.small2);
  const lvl=from=>Math.max(0,SMALL-SMALL*Math.max(0,diff(from,t))/avg20);
  if(!S1){ /* big tank full, small tank on previous transfer */
    const from=prev&&prev.small2?parseD(prev.small2):R;
    st.phase="full";st.big=BIG;st.small=lvl(from);
    st.transferDate=addDays(from,Math.round(avg20));st.orderDate=addDays(from,Math.round(avg20*2));st.runOut=addDays(from,Math.round(avg20*3));
  }else if(!S2){ /* 20 in reserve */
    st.phase="reserve";st.big=BIG-SMALL;st.small=lvl(S1);
    st.orderDate=addDays(S1,Math.round(avg20));st.transferDate=st.orderDate;st.runOut=addDays(S1,Math.round(avg20*2));
  }else{ /* big tank empty, order fuel, small tank running */
    st.phase="empty";st.big=0;st.small=lvl(S2);st.orderDate=S2;st.runOut=addDays(S2,Math.round(avg20));
  }
  st.daysToOrder=diff(t,st.orderDate); st.daysToRunOut=diff(t,st.runOut);
  return st;
}
function tankSVG(level,cap,w,h,label){
  const pct=Math.max(0,Math.min(1,level/cap)); const inner=h-24; const fh=inner*pct; const col=pct<.2?"#DC2626":pct<.45?"#F59E0B":"#D97706";
  const id="g"+Math.random().toString(36).slice(2,7);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}: ${level.toFixed(1)} of ${cap} barrels">
   <defs><clipPath id="${id}"><rect x="4" y="12" width="${w-8}" height="${inner}" rx="${Math.min(22,w/5)}"/></clipPath>
   <linearGradient id="${id}f" x1="0" x2="1"><stop offset="0" stop-color="${col}" stop-opacity=".85"/><stop offset=".5" stop-color="${col}"/><stop offset="1" stop-color="${col}" stop-opacity=".8"/></linearGradient></defs>
   <rect x="4" y="12" width="${w-8}" height="${inner}" rx="${Math.min(22,w/5)}" fill="#F6F7FA" stroke="#D5DAE3" stroke-width="2"/>
   <g clip-path="url(#${id})"><rect x="0" y="${12+inner-fh}" width="${w}" height="${fh}" fill="url(#${id}f)"/>
   ${fh>4?`<rect x="0" y="${12+inner-fh}" width="${w}" height="3" fill="#fff" opacity=".35"/>`:""}</g>
   ${[.25,.5,.75].map(p=>`<line x1="${w-18}" x2="${w-6}" y1="${12+inner*(1-p)}" y2="${12+inner*(1-p)}" stroke="#A3A9B6" stroke-width="1.5"/>`).join("")}
   <rect x="${w/2-10}" y="2" width="20" height="10" rx="3" fill="#D5DAE3"/>
   <text x="${w/2}" y="${12+inner/2+8}" text-anchor="middle" font-family="Outfit,system-ui" font-weight="700" font-size="${w>110?24:18}" fill="${pct>.5?"#fff":"#172033"}">${Math.round(pct*100)}%</text>
  </svg>`;
}
function cycleChart(st){
  const rows=st.done.slice(-10); if(!rows.length)return `<div class="empty">Finished fuel cycles will appear here.</div>`;
  const W=Math.max(560,rows.length*64),H=220,pl=34,pb=38,pt=16; const max=Math.max(35,...rows.map(r=>r.days));
  const bw=(W-pl-10)/rows.length;
  let s=`<svg width="${W}" height="${H}" style="max-width:100%;height:auto" viewBox="0 0 ${W} ${H}" role="img" aria-label="Days each 40-barrel delivery lasted">`;
  [0,10,20,30].forEach(v=>{const y=H-pb-(H-pb-pt)*v/max;s+=`<line x1="${pl}" x2="${W}" y1="${y}" y2="${y}" stroke="#EEF0F4"/><text x="${pl-6}" y="${y+4}" text-anchor="end" font-size="11" fill="#98A0AE">${v}</text>`});
  const avgY=H-pb-(H-pb-pt)*st.avgCycle/max;
  rows.forEach((r,i)=>{const h=(H-pb-pt)*r.days/max,x=pl+i*bw+bw*.18,y=H-pb-h,bwi=bw*.64;
    s+=`<rect x="${x}" y="${y}" width="${bwi}" height="${h}" rx="6" fill="${r.days<st.avgCycle-2?"#F59E0B":"#D97706"}"><title>${fd(r.c.received)} to ${fd(r.c.small2)}: ${r.days} days</title></rect>
    <text x="${x+bwi/2}" y="${y-5}" text-anchor="middle" font-size="12" font-weight="600" fill="#172033">${r.days}</text>
    <text x="${x+bwi/2}" y="${H-pb+16}" text-anchor="middle" font-size="11" fill="#667085">${fds(parseD(r.c.received))}</text>`});
  s+=`<line x1="${pl}" x2="${W}" y1="${avgY}" y2="${avgY}" stroke="#334155" stroke-dasharray="5 4" stroke-width="1.5"/>`;
  return s+"</svg>";
}

/* ---------- Due-date helpers ---------- */
function lastBy(arr,key,filter){return arr.filter(filter||(()=>1)).map(r=>r[key]).filter(Boolean).sort().pop()||null}
function filterDue(){return GENS.map(g=>{const last=lastBy(data.filterChanges,"date",r=>r.generator===g);const next=last?addMonths(parseD(last),1):null;return {g,last,next,days:next?diff(today(),next):null}})}
function filterOrderDue(){const last=lastBy(data.filterOrders,"orderDate");return {last,next:last?addMonths(parseD(last),6):null}}
function paintDue(){const done=data.painting.filter(r=>r.completedDate);const last=lastBy(done,"completedDate");const open=data.painting.find(r=>!r.completedDate);return {last,next:last?addMonths(parseD(last),6):null,open}}
function uniformDue(){const last=lastBy(data.uniforms,"orderDate");return {last,next:last?addMonths(parseD(last),12):null}}
function dueTone(days){if(days==null)return "neutral";if(days<0)return "bad";if(days<=7)return "warn";return "ok"}
function dueText(d){return d?`${fd(d)} (${rel(d)})`:"No record yet"}

/* ---------- Alerts ---------- */
function alerts(){
  const out=[]; const st=fuelStats();
  if(st.pendingOrder) out.push({c:"var(--fuel)",t:"Fuel ordered, waiting for delivery",d:"Ordered "+fd(st.pendingOrder.order),tab:"fuel"});
  else if(st.cur){
    if(st.phase==="empty") out.push({c:"var(--problems)",t:"Big tank is empty — order fuel",d:"Small tank has about "+st.small.toFixed(0)+" barrels left, estimated to run out "+fd(st.runOut)+" ("+rel(st.runOut)+")",tab:"fuel"});
    else if(st.phase==="reserve"&&st.daysToOrder<=3) out.push({c:"var(--fuel)",t:"Last 20 barrels move to the small tank soon",d:"Around "+fd(st.orderDate)+" ("+rel(st.orderDate)+"). The big tank will then be empty, so prepare the fuel order.",tab:"fuel"});
    else if(st.phase==="full"&&diff(today(),st.transferDate)<=2) out.push({c:"var(--fuel)",t:"Small tank needs refilling soon",d:"First transfer from the big tank expected "+fd(st.transferDate),tab:"fuel"});
  }
  filterDue().forEach(f=>{ if(f.days==null) out.push({c:"var(--filters)",t:`${f.g}: no filter change recorded`,d:"Log the last change to start monthly tracking",tab:"filters"});
    else if(f.days<=5) out.push({c:f.days<0?"var(--problems)":"var(--filters)",t:`${f.g} filter change ${f.days<0?"overdue":"due"}`,d:"Due "+fd(f.next)+" ("+rel(f.next)+")",tab:"filters"}); });
  const fo=filterOrderDue(); if(fo.next&&diff(today(),fo.next)<=14) out.push({c:"var(--filters)",t:"Time to order filters",d:"Twice-yearly order due "+fd(fo.next),tab:"filters"});
  const open=data.problems.filter(p=>p.status!=="Fixed"); if(open.length) out.push({c:"var(--problems)",t:`${open.length} open generator problem${open.length>1?"s":""}`,d:open.slice(0,2).map(p=>p.generator+": "+p.title).join("; "),tab:"problems"});
  const low=data.spares.filter(s=>(+s.qty||0)<(+s.minQty||0)||(+s.qty||0)<=0); if(low.length) out.push({c:"var(--spares)",t:`${low.length} spare item${low.length>1?"s":""} low on stock`,d:low.slice(0,3).map(s=>s.item).join(", "),tab:"spares"});
  const pd=paintDue(); if(pd.open) out.push({c:"var(--painting)",t:"Anti-corrosion round in progress",d:`${(pd.open.areas||[]).length} of ${AREAS.length} areas done`,tab:"painting"});
  else if(pd.next&&diff(today(),pd.next)<=21) out.push({c:"var(--painting)",t:"Anti-corrosion painting due",d:"Next round "+fd(pd.next),tab:"painting"});
  const ud=uniformDue(); if(ud.next&&diff(today(),ud.next)<=30) out.push({c:"var(--uniforms)",t:"Yearly uniform order due",d:fd(ud.next),tab:"uniforms"});
  const od=data.tasks.filter(t=>t.status!=="Done"&&t.due&&parseD(t.due)<today()); if(od.length) out.push({c:"var(--staff)",t:`${od.length} overdue task${od.length>1?"s":""}`,d:od.slice(0,2).map(t=>t.assignee+": "+t.title).join("; "),tab:"staff"});
  const dt=data.tasks.filter(t=>t.status!=="Done"&&t.due===iso(today())); if(dt.length) out.push({c:"var(--staff)",t:`${dt.length} task${dt.length>1?"s":""} due today`,d:dt.map(t=>t.title).join("; "),tab:"staff"});
  return out;
}

/* ---------- Rendering ---------- */
let active="overview"; const searchQ={};
function setTab(id){active=id;const t=TABS.find(x=>x.id===id);document.documentElement.style.setProperty("--accent",t.color);render();window.scrollTo({top:0})}
function renderTabs(){
  const counts={problems:data.problems.filter(p=>p.status!=="Fixed").length,staff:data.tasks.filter(t=>t.status!=="Done").length,
    spares:data.spares.filter(s=>(+s.qty||0)<(+s.minQty||0)).length};
  document.getElementById("tabs").innerHTML=TABS.map(t=>`<button class="tab" role="tab" style="--c:${t.color}" aria-selected="${t.id===active}" data-tab="${t.id}">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${t.icon}"/></svg>${t.label}${counts[t.id]?`<span class="n">${counts[t.id]}</span>`:""}</button>`).join("");
}
function head(title,sub,btn){return `<div class="head"><div><h2 class="title">${title}</h2><p class="sub">${sub}</p></div>${btn||""}</div>`}
function stat(k,v,d,c,tab){return `<div class="card stat${tab?" clickable":""}" style="--c:${c}" ${tab?`data-goto="${tab}"`:""}><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`}

function table(col,opts={}){
  const S=SCHEMAS[col]; const q=(searchQ[col]||"").toLowerCase();
  let rows=[...data[col]].sort(S.sort||(()=>0));
  if(opts.filter)rows=rows.filter(opts.filter);
  if(q)rows=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q));
  const cols=S.cols;
  return `<div class="tools"><input class="search" type="search" placeholder="Search ${S.title}s" data-search="${col}" value="${esc(searchQ[col]||"")}">
    <button class="btn" data-add="${col}">+ Add ${S.title}</button>${downloads?`<button class="btn ghost" data-csv="${col}">Export CSV</button>`:""}</div>
    <div class="tablewrap" id="tbl-${col}">${tableBody(col,rows,cols)}</div>`;
}
function tableBody(col,rows,cols){
  if(!rows.length)return `<div class="empty">${searchQ[col]?"No matches. Try a different search.":"Nothing recorded yet. Use “Add "+SCHEMAS[col].title+"” to create the first entry."}</div>`;
  return `<table><thead><tr>${cols.map(c=>`<th>${c.label}</th>`).join("")}<th></th></tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${c.f?c.f(r):esc(r[c.k]==null||r[c.k]===""?"—":r[c.k])}</td>`).join("")}
   <td class="act"><button class="icon-btn" data-edit="${col}" data-id="${r.id}" aria-label="Edit"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
   <button class="icon-btn" data-del="${col}" data-id="${r.id}" aria-label="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button></td></tr>`).join("")}</tbody></table>`;
}

const VIEWS={
 overview(){
  const st=fuelStats(); const al=alerts(); const fdue=filterDue(); const pd=paintDue(); const ud=uniformDue();
  const nextFilter=fdue.filter(f=>f.next).sort((a,b)=>a.next-b.next)[0];
  const openP=data.problems.filter(p=>p.status!=="Fixed").length; const openT=data.tasks.filter(t=>t.status!=="Done").length;
  const low=data.spares.filter(s=>(+s.qty||0)<(+s.minQty||0)).length;
  return head("Good "+(new Date().getHours()<12?"morning":new Date().getHours()<17?"afternoon":"evening")+", Mohamed","Everything that needs attention at the CLS generator site today.")+
  `<div class="grid g4">
   ${stat("Next fuel order",st.orderDate?(st.phase==="empty"?"Order now":fds(st.orderDate)):"—",st.orderDate?(st.phase==="empty"?"Big tank is empty":rel(st.orderDate)+", when big tank empties"):"Add a fuel cycle","var(--fuel)","fuel")}
   ${stat("Next filter change",nextFilter?fds(nextFilter.next):"—",nextFilter?nextFilter.g+", "+rel(nextFilter.next):"No changes logged","var(--filters)","filters")}
   ${stat("Open problems",openP,openP?"Needs follow-up":"All generators OK","var(--problems)","problems")}
   ${stat("Open tasks",openT,data.tasks.filter(t=>t.status!=="Done"&&t.due&&parseD(t.due)<today()).length+" overdue","var(--staff)","staff")}
  </div>
  <div class="grid g2" style="margin-top:14px">
   <div class="card"><h3 style="margin-top:0">Today's attention list</h3>
    ${al.length?`<div class="alerts">${al.map(a=>`<div class="alert" style="--c:${a.c}" data-goto="${a.tab}"><div><div class="ttl">${esc(a.t)}</div><div class="ds">${esc(a.d)}</div></div><span class="go">Open</span></div>`).join("")}</div>`:`<div class="empty">Nothing needs attention right now.</div>`}
   </div>
   <div class="card"><h3 style="margin-top:0">Fuel tanks now</h3>
    <div class="tanks">
     <div class="tank">${tankSVG(st.big,BIG,150,170,"Big tank")}<div class="lbl">Big tank</div><div class="amt">${st.big.toFixed(0)} of ${BIG} barrels${st.phase==="reserve"?" (reserve)":""}</div></div>
     <div class="tank">${tankSVG(st.small,SMALL,100,130,"Small tank")}<div class="lbl">Small tank</div><div class="amt">≈ ${st.small.toFixed(1)} of ${SMALL} barrels</div></div>
    </div>
    <p class="hint" style="text-align:center;margin:10px 0 0">Levels are estimated from your average of ${st.avg20.toFixed(1)} days per 20 barrels.</p>
   </div>
  </div>
  <div class="grid g4" style="margin-top:14px">
   ${stat("Spare items low",low,data.spares.length+" items tracked","var(--spares)","spares")}
   ${stat("Anti-corrosion",pd.open?"In progress":pd.next?fds(pd.next):"—",pd.open?(pd.open.areas||[]).length+" of "+AREAS.length+" areas":pd.next?"Next round "+rel(pd.next):"No rounds logged","var(--painting)","painting")}
   ${stat("Uniform order",ud.next?fds(ud.next):"—",ud.next?"Yearly order "+rel(ud.next):"No orders logged","var(--uniforms)","uniforms")}
   ${stat("Parts replaced",data.replacements.length,"All-time records","var(--replaced)","replaced")}
  </div>`;
 },
 fuel(){
  const st=fuelStats(); const c=st.cur;
  let steps="";
  if(c){const R=c.received,S1=c.small1,S2=c.small2;
    steps=`<div class="timeline">
     ${c.order?`<div class="step done"><div class="b">✓</div><div><div class="t">Fuel ordered</div><div class="s">${fd(c.order)}</div></div></div>`:""}
     <div class="step done"><div class="b">✓</div><div><div class="t">Fuel received, big tank full (40 barrels)</div><div class="s">${fd(R)}. Small tank still running on the last transfer.</div></div></div>
     <div class="step ${S1?"done":"pred"}"><div class="b">${S1?"✓":"2"}</div><div><div class="t">First transfer: 20 barrels to small tank</div><div class="s">${S1?fd(S1)+". Big tank keeps 20 barrels in reserve.":"Expected around "+fd(st.transferDate)}</div></div></div>
     <div class="step ${S2?"done":"pred"}"><div class="b">${S2?"✓":"3"}</div><div><div class="t">Second transfer: last 20 barrels, big tank empty, order fuel</div><div class="s">${S2?fd(S2)+(S1?" ("+diff(parseD(S1),parseD(S2))+" days after first transfer)":""):"Expected around "+fd(st.orderDate)+" ("+rel(st.orderDate)+")"}</div></div></div>
    </div>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      ${!S1?`<button class="btn" data-quick="small1">Record first transfer today</button>`:!S2?`<button class="btn" data-quick="small2">Record second transfer today (big tank empty)</button>`:`<button class="btn" data-add="fuel">+ Record new fuel delivery</button>`}
      <button class="btn ghost" data-edit="fuel" data-id="${c.id}">Edit this cycle</button>
    </div>`;}
  const cols=[{k:"order",label:"Ordered",f:r=>fd(r.order)},{k:"received",label:"Received",f:r=>`<b>${fd(r.received)}</b>`},
    {k:"small1",label:"1st transfer",f:r=>r.small1?fd(r.small1)+`<div class="hint">Big tank 20 left</div>`:`<span class="pill info">Big tank full</span>`},
    {k:"small2",label:"2nd transfer (order)",f:r=>r.small2?fd(r.small2)+(r.small1?`<div class="hint">${diff(parseD(r.small1),parseD(r.small2))} days after 1st</div>`:""):(r.small1?`<span class="pill warn">20 in reserve</span>`:"—")},
    {k:"total",label:"Lasted",f:r=>r.small2?`<b>${diff(parseD(r.received),parseD(r.small2))} days</b>`:"—"},
    {k:"rate",label:"Barrels / day",f:r=>r.small2?((+r.barrels||40)/diff(parseD(r.received),parseD(r.small2))).toFixed(2):"—"},
    {k:"notes",label:"Notes",f:r=>`<div class="clip">${esc(r.notes)}</div>`}];
  SCHEMAS.fuel.cols=cols;
  return head("Fuel tracking","Each delivery fills the 40-barrel big tank. When the small tank runs out, 20 barrels are moved over and 20 stay in reserve. At the second transfer the big tank is empty, so fuel is ordered while the small tank runs.",`<button class="btn" data-add="fuel">+ Record fuel delivery</button>`)+
  `<div class="grid g4">
    ${stat("Next fuel order",st.orderDate?(st.phase==="empty"?"Order now":fds(st.orderDate)):"—",st.orderDate?(st.phase==="empty"?"Small tank runs out "+fds(st.runOut):rel(st.orderDate)):"","var(--fuel)")}
    ${stat("Average delivery lasts",st.avgCycle.toFixed(1)+" days","Last "+Math.min(6,st.done.length)+" cycles","var(--fuel)")}
    ${stat("Days per 20 barrels",st.avg20.toFixed(1),"One small tank","var(--fuel)")}
    ${stat("Consumption",st.perDay.toFixed(2)+" bbl/day","≈ "+Math.round(st.perDay*159)+" litres per day","var(--fuel)")}
  </div>
  <div class="fuelhero" style="margin-top:14px">
    <div class="card"><h3 style="margin-top:0">Tank levels</h3><div class="tanks">
      <div class="tank">${tankSVG(st.big,BIG,150,190,"Big tank")}<div class="lbl">Big tank · 40 bbl</div><div class="amt">${st.big.toFixed(0)} barrels${st.phase==="reserve"?" in reserve":""}</div></div>
      <div class="tank">${tankSVG(st.small,SMALL,100,140,"Small tank")}<div class="lbl">Small tank · 20 bbl</div><div class="amt">≈ ${st.small.toFixed(1)} barrels</div></div></div></div>
    <div class="card"><h3 style="margin-top:0">Current cycle</h3>${c?steps:`<div class="empty">Record your first fuel delivery to start tracking.</div>`}</div>
  </div>
  <div class="card" style="margin-top:14px"><h3 style="margin-top:0">Days from delivery to next fuel order</h3><div class="chart">${cycleChart(st)}</div>
    <div class="legend"><span><i style="background:#D97706"></i>Days, delivery to next order</span><span><i style="background:#F59E0B"></i>Shorter than average</span><span><i style="background:none;border-top:2px dashed #334155;border-radius:0;height:0"></i>Average</span></div></div>
  <h3>Fuel history</h3>${table("fuel")}`;
 },
 spares(){
  const total=data.spares.reduce((a,s)=>a+(+s.qty||0),0); const low=data.spares.filter(s=>(+s.qty||0)<(+s.minQty||0)&&(+s.qty||0)>0).length; const out=data.spares.filter(s=>(+s.qty||0)<=0).length;
  return head("Spare inventory","Parts kept in store for the three generators. Use + and − to update stock as items go in and out.")+
  `<div class="grid g4">${stat("Items tracked",data.spares.length,total+" units in store","var(--spares)")}${stat("Low stock",low,"Below reorder level","var(--spares)")}${stat("Out of stock",out,"Order these first","var(--spares)")}</div><h3>Store</h3>${table("spares")}`;
 },
 filters(){
  const fdue=filterDue(); const fo=filterOrderDue();
  return head("Generator filters","Filters are changed once a month on each generator, and ordered twice a year.")+
  `<div class="grid g2"><div class="card"><h3 style="margin-top:0">Monthly change status</h3>
   ${fdue.map(f=>`<div class="gen"><div><b>${f.g}</b><div class="hint">Last changed ${f.last?fd(f.last):"— not recorded"}</div></div><span class="pill ${dueTone(f.days)}">${f.next?(f.days<0?"Overdue ":"Due ")+fds(f.next):"No record"}</span></div>`).join("")}
   <button class="btn" style="margin-top:12px" data-add="filterChanges">+ Log filter change</button></div>
   <div class="card"><h3 style="margin-top:0">Twice-yearly order</h3>
    <div class="gen"><div><b>Last order</b></div><span>${fo.last?fd(fo.last):"—"}</span></div>
    <div class="gen"><div><b>Next order due</b></div><span class="pill ${fo.next?dueTone(diff(today(),fo.next)-7):"neutral"}">${fo.next?fd(fo.next):"No order logged"}</span></div>
    <div class="gen"><div><b>Changes since last order</b></div><span>${fo.last?data.filterChanges.filter(r=>r.date>=fo.last).length:data.filterChanges.length}</span></div>
    <button class="btn" style="margin-top:12px" data-add="filterOrders">+ Log filter order</button></div></div>
  <h3>Filter change log</h3>${table("filterChanges")}<h3>Filter orders</h3>${table("filterOrders")}`;
 },
 problems(){
  const open=data.problems.filter(p=>p.status==="Open").length, prog=data.problems.filter(p=>p.status==="In progress").length, fixed=data.problems.filter(p=>p.status==="Fixed").length;
  const byGen=GENS.map(g=>`<div class="gen"><b>${g}</b><span>${data.problems.filter(p=>p.generator===g).length} total, ${data.problems.filter(p=>p.generator===g&&p.status!=="Fixed").length} open</span></div>`).join("");
  return head("Problems & fixes","Log every generator problem and how it was solved. Fixed problems become a searchable reference for the next time it happens.")+
  `<div class="grid g4">${stat("Open",open,"Not started","var(--problems)")}${stat("In progress",prog,"Being worked on","var(--problems)")}${stat("Fixed",fixed,"Saved as reference","var(--problems)")}<div class="card">${byGen}</div></div>
  <h3>Problem log</h3>${table("problems")}`;
 },
 replaced(){
  const byGen=GENS.map(g=>stat(g,data.replacements.filter(r=>r.generator===g).length,"Parts replaced","var(--replaced)")).join("");
  return head("Faulty & replaced parts","Which part failed, on which generator, and what replaced it.")+`<div class="grid g4">${byGen}</div><h3>Replacement records</h3>${table("replacements")}`;
 },
 painting(){
  const pd=paintDue(); const cur=pd.open||[...data.painting].sort(SCHEMAS.painting.sort)[0];
  return head("Anti-corrosion painting","Done twice a year, every 6 months, across all nine areas.")+
  `<div class="grid g2"><div class="card"><h3 style="margin-top:0">${cur?esc(cur.round):"No round yet"}</h3>
   ${cur?`<div class="progress" style="--c:var(--painting)"><i style="width:${Math.round((cur.areas||[]).length/AREAS.length*100)}%"></i></div>
   <div class="chips" style="margin-top:12px">${AREAS.map(a=>`<button class="chip ${(cur.areas||[]).includes(a)?"on":""}" style="--accent:var(--painting)" data-area="${esc(a)}" data-id="${cur.id}">${(cur.areas||[]).includes(a)?"✓ ":""}${esc(a)}</button>`).join("")}</div>
   <p class="hint">Tap an area to mark it painted.</p>`:`<button class="btn" data-add="painting">+ Start painting round</button>`}</div>
   <div class="card"><h3 style="margin-top:0">Schedule</h3>
    <div class="gen"><b>Last completed round</b><span>${pd.last?fd(pd.last):"—"}</span></div>
    <div class="gen"><b>Next round due</b><span class="pill ${pd.next?dueTone(diff(today(),pd.next)-14):"neutral"}">${pd.next?fd(pd.next):"Not scheduled"}</span></div>
    <div class="gen"><b>Rounds recorded</b><span>${data.painting.length}</span></div></div></div>
  <h3>Painting rounds</h3>${table("painting")}`;
 },
 uniforms(){
  const ud=uniformDue(); const yr=today().getFullYear();
  const got=new Set(data.uniforms.filter(u=>(u.orderDate||"").startsWith(String(yr))).map(u=>u.staff));
  return head("Staff uniforms","Uniforms are ordered once a year for every generator staff member.")+
  `<div class="grid g2"><div class="card"><h3 style="margin-top:0">${yr} order status</h3>
   ${data.staff.some(s=>deptOf(s)===DEPT_CLS)?[...data.staff].filter(s=>deptOf(s)===DEPT_CLS).sort(SCHEMAS.staff.sort).map(s=>`<div class="gen"><div><b>${esc(s.name)}</b><div class="hint">${esc(s.role||"")}</div></div>${got.has(s.name)?`<span class="pill ok">Ordered</span>`:`<span class="pill neutral">Not yet</span>`}</div>`).join(""):`<div class="empty">Add staff in the Staff & tasks tab.</div>`}</div>
   <div class="card"><h3 style="margin-top:0">Schedule</h3><div class="gen"><b>Last order</b><span>${ud.last?fd(ud.last):"—"}</span></div>
   <div class="gen"><b>Next yearly order</b><span class="pill ${ud.next?dueTone(diff(today(),ud.next)-30):"neutral"}">${ud.next?fd(ud.next):"Not scheduled"}</span></div></div></div>
  <h3>Uniform orders</h3>${table("uniforms")}`;
 },
 staff(){
  const staff=[...data.staff].sort(SCHEMAS.staff.sort);
  const heads=staff.filter(s=>s.role===HEAD_ROLE), cls=staff.filter(s=>s.role!==HEAD_ROLE&&deptOf(s)===DEPT_CLS), net=staff.filter(s=>s.role!==HEAD_ROLE&&deptOf(s)===DEPT_NET);
  const mgr=cls.filter(s=>s.role==="CLS Manager"), mech=cls.filter(s=>s.role==="Mechanic"), ops=cls.filter(s=>!["CLS Manager","Mechanic"].includes(s.role));
  const netMgr=net.filter(s=>s.role==="Network Manager"), netOth=net.filter(s=>s.role!=="Network Manager");
  const tiers=rows=>rows.filter(r=>r.length).map(r=>`<div class="orgrow">${r.map(node).join("")}</div>`).join(`<div class="orgline"></div>`);
  const node=s=>`<div class="orgnode"><b>${esc(s.name)}</b><span>${esc(s.role||"")}</span> <button class="icon-btn" style="width:24px;height:24px;margin-left:4px" data-edit="staff" data-id="${s.id}" aria-label="Edit ${esc(s.name)}">✎</button></div>`;
  const perf=staff.map(s=>{const ts=data.tasks.filter(t=>t.assignee===s.name);const done=ts.filter(t=>t.status==="Done");
    const onTime=done.filter(t=>t.due&&t.completed&&t.completed<=t.due).length; const withDue=done.filter(t=>t.due&&t.completed).length;
    const rated=done.filter(t=>t.rating); const avg=rated.length?rated.reduce((a,t)=>a+ +t.rating,0)/rated.length:null;
    const od=ts.filter(t=>t.status!=="Done"&&t.due&&parseD(t.due)<today()).length;
    return {s,total:ts.length,done:done.length,open:ts.length-done.length,od,onTime:withDue?Math.round(onTime/withDue*100):null,avg}});
  return head("Staff & tasks","Assign work to the generator team, follow it up, and rate how each task was done.",`<button class="btn" data-add="tasks">+ Assign task</button>`)+
  `<div class="grid g2"><div class="card"><h3 style="margin-top:0">Reporting line</h3><div class="org">
   ${heads.length?`<div class="orgrow">${heads.map(node).join("")}</div><div class="orgline"></div>`:""}
   <div class="orgdepts">
    <div class="orgdept"><div class="orgdept-t">${esc(DEPT_CLS)}</div>${tiers([mgr,mech,ops])||`<div class="hint">No staff yet.</div>`}</div>
    <div class="orgdept"><div class="orgdept-t">${esc(DEPT_NET)}</div>${tiers([netMgr,netOth])||`<div class="hint">No staff yet.</div>`}</div>
   </div></div>
   <div style="margin-top:14px"><button class="btn ghost sm" data-add="staff">+ Add staff member</button></div></div>
   <div class="card"><h3 style="margin-top:0">Performance</h3><div class="tablewrap" style="border:0"><table style="min-width:420px"><thead><tr><th>Name</th><th>Open</th><th>Done</th><th>Overdue</th><th>On time</th><th>Rating</th></tr></thead><tbody>
    ${perf.map(p=>`<tr><td><b>${esc(p.s.name)}</b></td><td>${p.open}</td><td>${p.done}</td><td>${p.od?`<span class="pill bad">${p.od}</span>`:"0"}</td><td>${p.onTime==null?"—":p.onTime+"%"}</td><td>${p.avg==null?"—":`<span class="stars">★</span> ${p.avg.toFixed(1)}`}</td></tr>`).join("")||`<tr><td colspan="6" class="empty">No staff yet.</td></tr>`}
   </tbody></table></div></div></div>
  <h3>Tasks</h3>${table("tasks")}`;
 }
};

function render(){
  document.getElementById("todayLbl").textContent=today().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  renderTabs();
  const focusCol=document.activeElement&&document.activeElement.dataset?document.activeElement.dataset.search:null;
  const selStart=focusCol?document.activeElement.selectionStart:null;
  document.getElementById("view").innerHTML=VIEWS[active]();
  if(focusCol){const el=document.querySelector(`[data-search="${focusCol}"]`);if(el){el.focus();try{el.setSelectionRange(selStart,selStart)}catch(e){}}}
}

/* ---------- Modal & forms ---------- */
const bd=document.getElementById("backdrop"), md=document.getElementById("modal");
function openModal(html){md.innerHTML=html;bd.classList.add("open");const f=md.querySelector("input,select,textarea");if(f)setTimeout(()=>f.focus(),30)}
function closeModal(){bd.classList.remove("open");md.innerHTML=""}
bd.addEventListener("click",e=>{if(e.target===bd)closeModal()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&bd.classList.contains("open"))closeModal()});

function fieldHTML(f,val){
  const v=val!==undefined?val:(typeof f.def==="function"?f.def():f.def!==undefined?f.def:"");
  const opts=typeof f.options==="function"?f.options():f.options;
  const cls=f.full?"full":"";
  const lab=`${esc(f.label)}${f.req?" *":""}${f.hint?` <span class="hint">${esc(f.hint)}</span>`:""}`;
  if(f.type==="select"){const list=[...(opts||[])];if(v&&!list.includes(v))list.push(v);
    return `<label class="${cls}">${lab}<select name="${f.k}" ${f.req?"required":""}>${f.req?"":`<option value=""></option>`}${list.filter(o=>o!==""||!f.req).map(o=>o===""?"":`<option ${o===v?"selected":""}>${esc(o)}</option>`).join("")}</select></label>`;}
  if(f.type==="textarea")return `<label class="${cls}">${lab}<textarea name="${f.k}">${esc(v)}</textarea></label>`;
  if(f.type==="multi"){const sel=Array.isArray(v)?v:[];return `<div class="${cls} form-multi" data-multi="${f.k}"><label>${lab}</label><div class="chips">${opts.map(o=>`<button type="button" class="chip ${sel.includes(o)?"on":""}" data-chip="${esc(o)}">${esc(o)}</button>`).join("")}</div></div>`;}
  return `<label class="${cls}">${lab}<input name="${f.k}" type="${f.type==="date"?"date":f.type==="number"?"number":"text"}" ${f.type==="number"?'step="any" inputmode="decimal"':""} value="${esc(v)}" ${f.req?"required":""}></label>`;
}
function openForm(col,id){
  const S=SCHEMAS[col]; const rec=id?data[col].find(r=>r.id===id):null;
  openModal(`<header><h4>${rec?"Edit":"Add"} ${S.title}</h4><button class="icon-btn" data-close aria-label="Close">✕</button></header>
   <div class="body"><form class="form" id="recForm">${S.fields.map(f=>fieldHTML(f,rec?rec[f.k]:undefined)).join("")}</form><p class="hint" id="formErr" style="color:#B91C1C"></p></div>
   <footer><button class="btn ghost" data-close>Cancel</button><button class="btn" id="saveBtn">${rec?"Save changes":"Add "+S.title}</button></footer>`);
  md.querySelectorAll(".chip[data-chip]").forEach(ch=>ch.addEventListener("click",()=>ch.classList.toggle("on")));
  document.getElementById("saveBtn").addEventListener("click",async()=>{
    const form=document.getElementById("recForm"); const out={...(rec||{})};
    for(const f of S.fields){
      if(f.type==="multi"){out[f.k]=[...form.querySelectorAll(`[data-multi="${f.k}"] .chip.on`)].map(c=>c.dataset.chip);continue;}
      const el=form.querySelector(`[name="${f.k}"]`); let v=el?String(el.value||"").trim():"";
      if(f.req&&!v){document.getElementById("formErr").textContent=f.label+" is required.";if(el)el.focus();return;}
      out[f.k]=f.type==="number"?(v===""?"":Number(v)):v;
    }
    if(col==="tasks"&&out.status==="Done"&&!out.completed)out.completed=iso(today());
    if(col==="problems"&&out.status==="Fixed"&&!out.fixedDate)out.fixedDate=iso(today());
    if(col==="painting"&&(out.areas||[]).length===AREAS.length&&!out.completedDate)out.completedDate=iso(today());
    const b=document.getElementById("saveBtn"); b.disabled=true;
    const ok=await saveRec(col,out); if(ok){closeModal();toast(rec?"Changes saved":S.title.charAt(0).toUpperCase()+S.title.slice(1)+" added")} else b.disabled=false;
  });
}
function confirmDel(col,id){
  const S=SCHEMAS[col];
  openModal(`<header><h4>Delete this ${S.title}?</h4></header><div class="body"><p>This removes the record from this browser. It can't be undone.</p></div>
   <footer><button class="btn ghost" data-close>Keep it</button><button class="btn danger" id="yesDel">Delete</button></footer>`);
  document.getElementById("yesDel").addEventListener("click",async()=>{await delRec(col,id);closeModal();toast("Deleted")});
}
let tt; function toast(m){const t=document.getElementById("toast");t.textContent=m;t.classList.add("show");clearTimeout(tt);tt=setTimeout(()=>t.classList.remove("show"),2400)}

async function exportCSV(col){
  if(!downloads)return; const S=SCHEMAS[col]; const keys=S.fields.map(f=>f.k);
  const rows=[S.fields.map(f=>f.label),...[...data[col]].sort(S.sort||(()=>0)).map(r=>keys.map(k=>Array.isArray(r[k])?r[k].join("; "):r[k]??""))];
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  try{await downloads.save({filename:`cls-${col}-${iso(today())}.csv`,data:csv});}catch(e){}
}

/* ---------- Events ---------- */
document.addEventListener("click",async e=>{
  const t=e.target.closest("button,[data-goto]"); if(!t)return;
  if(t.dataset.tab)return setTab(t.dataset.tab);
  if(t.dataset.goto)return setTab(t.dataset.goto);
  if(t.hasAttribute("data-close"))return closeModal();
  if(t.dataset.add)return openForm(t.dataset.add);
  if(t.dataset.edit)return openForm(t.dataset.edit,t.dataset.id);
  if(t.dataset.del)return confirmDel(t.dataset.del,t.dataset.id);
  if(t.dataset.csv)return exportCSV(t.dataset.csv);
  if(t.id==="backupBtn")return backupData();
  if(t.id==="restoreBtn")return document.getElementById("restoreFile").click();
  if(t.dataset.qty){const r=data.spares.find(x=>x.id===t.dataset.id);if(!r)return;t.disabled=true;await saveRec("spares",{...r,qty:Math.max(0,(+r.qty||0)+Number(t.dataset.qty))});return;}
  if(t.dataset.area){const r=data.painting.find(x=>x.id===t.dataset.id);if(!r)return;const a=new Set(r.areas||[]);a.has(t.dataset.area)?a.delete(t.dataset.area):a.add(t.dataset.area);
    const nr={...r,areas:AREAS.filter(x=>a.has(x))}; nr.completedDate=nr.areas.length===AREAS.length?(r.completedDate||iso(today())):"";
    t.disabled=true; await saveRec("painting",nr); return;}
  if(t.dataset.quick){const st=fuelStats();if(!st.cur)return;t.disabled=true;await saveRec("fuel",{...st.cur,[t.dataset.quick]:iso(today())});toast("Recorded for today");return;}
});
document.addEventListener("input",e=>{
  const col=e.target.dataset&&e.target.dataset.search; if(!col)return;
  searchQ[col]=e.target.value; const S=SCHEMAS[col]; const q=e.target.value.toLowerCase();
  let rows=[...data[col]].sort(S.sort||(()=>0)); if(q)rows=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q));
  document.getElementById("tbl-"+col).innerHTML=tableBody(col,rows,S.cols);
});

document.getElementById("restoreFile").addEventListener("change",e=>{const f=e.target.files[0]; if(f)restoreData(f); e.target.value="";});

setTab("overview");
initStore();
})();
