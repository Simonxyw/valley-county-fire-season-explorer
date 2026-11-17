import {YEARS,CLASSES,hydrate,select,weighted,category,dailySelection,cumulative,movingAverage,cellAt,inCounty,bounds,scaleRange} from './math.mjs';
import {exportPageURL,readExportRequest} from './export-state.mjs';
const $=id=>document.getElementById(id);
const META={
 precip:{name:'Precipitation',short:'Seasonal precipitation',unit:'mm',source:'PRISM via Climate Engine',resolution:'~800 m',positive:true,palette:['#f7fcf0','#ccebc5','#7bccc4','#2b8cbe','#084081'],anomaly:['#8c510a','#dfc27d','#f5f5ed','#80cdc1','#01665e'],explain:'Average annual June to October rainfall total.'},
 tmean:{name:'Mean temperature',short:'Mean temperature',unit:'°C',source:'PRISM via Climate Engine',resolution:'~800 m',palette:['#4575b4','#91bfdb','#ffffbf','#fc8d59','#a50026'],anomaly:['#2166ac','#92c5de','#f7f7f7','#f4a582','#b2182b'],explain:'Seasonal mean of daily mean temperature.'},
 tmax:{name:'Maximum temperature',short:'Mean daily maximum',unit:'°C',source:'PRISM via Climate Engine',resolution:'~800 m',palette:['#4575b4','#91bfdb','#ffffbf','#fc8d59','#a50026'],anomaly:['#2166ac','#92c5de','#f7f7f7','#f4a582','#b2182b'],explain:'Seasonal mean of daily maximum temperature.'},
 vpd:{name:'Vapor pressure deficit',short:'Vapor pressure deficit',unit:'kPa',source:'gridMET via Climate Engine',resolution:'~4 km',positive:true,palette:['#f7fcb9','#addd8e','#31a354','#fdae61','#a63603'],anomaly:['#2166ac','#92c5de','#f7f7f7','#f4a582','#b2182b'],explain:'Higher values indicate greater atmospheric drying demand.'},
 fwi:{name:'Fire Weather Index',short:'Mean Fire Weather Index',unit:'index',source:'CEMS Fire v4.1 via Climate Engine',resolution:'0.25° (~24 km)',positive:true,palette:['#ffffcc','#a1dab4','#41b6c4','#fb8d3d','#bd0026'],anomaly:['#2166ac','#92c5de','#f7f7f7','#f4a582','#b2182b'],explain:'Seasonal mean fire-weather intensity index; higher values indicate more conducive fire weather.'},
 speih:{name:'Drought (Hargreaves SPEI)',short:'Seasonal Hargreaves SPEI',unit:'index',source:'PRISM Hargreaves SPEI via Climate Engine',resolution:'~800 m',palette:['#8c2d04','#fdae6b','#f0f0dc','#a1d99b','#006d2c'],frequency:['#ffffe5','#fee391','#fec44f','#d95f0e','#993404'],explain:'Negative SPEI is dry; positive SPEI is wet.'}
};
const MIN_COMPARE_YEAR=2021,MAX_COMPARE_YEAR=2025;
const state={metric:'precip',start:2025,end:2025,view:'map',graph:'annual',swipe:50,opacity:.78,colorMode:'fixed',comparison:'anomaly',hidden:new Set(),basemap:'satellite',pinned:null,busy:true};
const cache=new Map();let bundle,result,county,manifest,map,climate,boundaryLayer,roads,placeNames,base,selectionOutline,requestNo=0,renderFrame;
const isEmbedded=()=>window.self!==window.top;
const downloadRequest=readExportRequest(location.href);
const unit=()=>META[state.metric].unit;
const labelYears=()=>state.start===state.end?String(state.start):`${state.start} to ${state.end}`;
const fmt=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}):'No data';
const signed=v=>(v>0?'+':'')+fmt(v);
const isSeasonGraph=()=>state.graph==='daily'||state.graph==='weekly';
const coverageNote=()=>state.metric==='fwi'&&state.start<=2024&&state.end>=2024||state.metric==='fwi'&&state.view==='graph'&&state.graph==='annual'?'FWI 2024: 151/152 days (99.34%); August 8 is missing. No interpolation.':'';
function setText(id,text){$(id).textContent=text;}
function hex(s){return [1,3,5].map(i=>parseInt(s.slice(i,i+2),16));}
function color(v,domain,palette) {
 const t=Math.max(0,Math.min(1,(v-domain[0])/(domain[1]-domain[0])))*(palette.length-1),i=Math.min(palette.length-2,Math.floor(t)),f=t-i,a=hex(palette[i]),b=hex(palette[i+1]);
 return `rgb(${a.map((x,j)=>Math.round(x+(b[j]-x)*f)).join(',')})`;
}
function getSchemes() {
 const m=META[state.metric],single=state.start===state.end;
 if(state.metric==='speih')return single?
  [{domain:[-3,3],palette:m.palette,title:`${state.start} SPEI`,note:'June 1 to October 30 · index'},
   {categorical:true,title:'Moisture classes',note:'The same annual SPEI, classified'}]:
  [{domain:[0,100],palette:m.frequency,title:`${labelYears()} drought frequency`,note:'Share of selected years with SPEI ≤ −1 (%)'},
   {domain:[0,100],palette:m.frequency,title:'1991 to 2020 drought frequency',note:'Share of reference years with SPEI ≤ −1 (%)'}];
 const fixed=state.colorMode==='fixed';
 if(!bundle.fixedRaw) {
  bundle.fixedRaw=scaleRange([...bounds(bundle.values),...bounds(bundle.baseline)],{positive:m.positive});
  const all=new Float64Array(bundle.values.length);
  for(let i=0;i<all.length;i++)all[i]=bundle.values[i]-bundle.baseline[i%bundle.count];
  bundle.fixedAnomaly=scaleRange(all,{zero:true});
 }
 const raw=fixed?bundle.fixedRaw:scaleRange([...bounds(result.mean),...bounds(bundle.baseline)],{positive:m.positive});
 const anomaly=fixed?bundle.fixedAnomaly:scaleRange(result.anomaly,{zero:true});
 return [{domain:raw,palette:m.palette,title:`${labelYears()} ${m.short.toLowerCase()}`,note:`${single?'Seasonal value':'Mean of annual seasons'} · ${m.unit}`},
 state.comparison==='baseline'?{domain:raw,palette:m.palette,title:'1991 to 2020 reference',note:`Long-term seasonal mean · ${m.unit}`}:
 {domain:anomaly,palette:m.anomaly,title:'Difference from reference',note:`${labelYears()} minus 1991 to 2020 · ${m.unit}`}];
}
function rightValues(){return state.metric!=='speih'&&state.comparison==='baseline'?bundle.baseline:result.right;}
function legendKey(el,scheme) {
 el.replaceChildren();
 if(scheme.categorical){const key=document.createElement('div');key.className='category-key';
  for(const c of CLASSES){const s=document.createElement('span');s.title=c.range;s.innerHTML=`<i class="swatch" style="background:${c.color}"></i>${c.label}`;key.append(s);}el.append(key);
 }else{const r=document.createElement('div');r.className='ramp';r.style.background=`linear-gradient(to right,${scheme.palette.join(',')})`;const ticks=document.createElement('div');ticks.className='ramp-ticks';const [a,b]=scheme.domain;
 ticks.innerHTML=[a,(a+b)/2,b].map(v=>`<span>${fmt(v,Math.abs(b-a)<4?2:0)}</span>`).join('');el.append(r,ticks);}
}
function update() {
 if(!bundle||state.busy)return;
 result=select(bundle,state.start,state.end);const m=META[state.metric],schemes=getSchemes();
 setText('year-label',labelYears());setText('resolution',`${m.resolution} native grid`);
 $('comparison-label').hidden=state.metric==='speih';$('color-mode').disabled=state.metric==='speih';
 setText('scale-description',state.metric==='speih'?'SPEI uses fixed index, category, and frequency scales. Dry means SPEI ≤ −1.':'Fixed scales support comparisons across years. Each indicator keeps its native pixels.');
 if(state.metric==='speih'){
  const d=result.county-result.countyBaseline;
  setText('metric-summary',`${labelYears()}: ${fmt(result.county)}% of the county ${result.years.length===1?'is dry':'is dry on average per year'} (SPEI ≤ −1). Reference: ${fmt(result.countyBaseline)}%; difference: ${signed(d)} percentage points.`);
 }else setText('metric-summary',`${labelYears()}: ${fmt(result.county)} ${m.unit} countywide. Reference: ${fmt(result.countyBaseline)} ${m.unit}; difference: ${signed(result.countyAnomaly)} ${m.unit}. ${m.explain}`);
 const note=coverageNote();$('coverage').hidden=!note;setText('coverage',note);
 setText('metric-source',`${m.source} · June 1 to October 30 · Valley County, Idaho`);
 for(const [i,side] of ['left','right'].entries()){setText(side+'-title',schemes[i].title);setText(side+'-note',schemes[i].note);legendKey($(side+'-key'),schemes[i]);}
 climate?.redraw();if(state.view==='graph')drawGraph();
 if(state.pinned)queryPixel(state.pinned,true);
 const params=new URLSearchParams(location.search);params.set('metric',state.metric);params.set('from',state.start);params.set('to',state.end);params.set('panel',state.view);
 history.replaceState(null,'',`${location.pathname}?${params}`);
}
function scheduleUpdate(){cancelAnimationFrame(renderFrame);renderFrame=requestAnimationFrame(update);}
async function loadMetric(key) {
 const ticket=++requestNo;state.metric=key;state.busy=true;$('loading').hidden=false;setText('loading-text',`Loading ${META[key].name.toLowerCase()}…`);setText('metric-summary',`Loading ${META[key].name.toLowerCase()}…`);
 document.querySelectorAll('[data-metric]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.metric===key));
 try{
  if(!cache.has(key))cache.set(key,fetch(`./data/${key}.json`).then(r=>{if(!r.ok)throw Error('Data request failed');return r.json();}).then(hydrate).catch(e=>{cache.delete(key);throw e;}));
  const b=await cache.get(key);if(ticket!==requestNo)return;bundle=b;state.busy=false;state.hidden.clear();state.pinned=null;$('pixel-readout').hidden=true;selectionOutline?.remove();
  const daily=$('graph-mode').querySelector('[value=daily]'),classes=$('graph-mode').querySelector('[value=classes]');daily.hidden=daily.disabled=key==='speih';classes.hidden=classes.disabled=key!=='speih';const weekly=$('graph-mode').querySelector('[value=weekly]');weekly.hidden=weekly.disabled=key==='speih';
  if((key==='speih'&&isSeasonGraph())||(key!=='speih'&&state.graph==='classes'))state.graph='annual';$('graph-mode').value=state.graph;
  $('left-satellite').checked=$('right-satellite').checked=false;$('loading').hidden=true;update();
 }catch(e){if(ticket!==requestNo)return;state.busy=true;$('loading-text').textContent='The data could not load. Please reload to try again.';setText('metric-summary','Climate data are unavailable. Please reload.');console.error('Climate data load failed',e);}
}
function countyPath(ctx,m) {
 const geom=county.features[0].geometry,polygons=geom.type==='Polygon'?[geom.coordinates]:geom.coordinates;
 ctx.beginPath();for(const poly of polygons)for(const ring of poly){for(let i=0;i<ring.length;i++){const p=m.latLngToContainerPoint([ring[i][1],ring[i][0]]);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}ctx.closePath();}
}
function drawNative(ctx,m,w,h) {
 if(!bundle||!result)return;const schemes=getSchemes(),[a,,c,,,f]=bundle.transform,e=bundle.transform[4];
 const xs=Array.from({length:bundle.width+1},(_,j)=>m.latLngToContainerPoint([f,c+j*a]).x),ys=Array.from({length:bundle.height+1},(_,i)=>m.latLngToContainerPoint([f+i*e,c]).y);
 for(let side=0;side<2;side++){
  if($(side===0?'left-satellite':'right-satellite').checked)continue;
  ctx.save();ctx.beginPath();ctx.rect(side===0?0:w*state.swipe/100,0,side===0?w*state.swipe/100:w*(1-state.swipe/100),h);ctx.clip();countyPath(ctx,m);ctx.clip('evenodd');ctx.globalAlpha=state.opacity;
  const vals=side===0?result.left:rightValues(),sc=schemes[side];
  for(let i=0;i<bundle.count;i++){
   const id=bundle.ids[i],col=id%bundle.width,row=Math.floor(id/bundle.width),x0=xs[col],x1=xs[col+1],y0=ys[row],y1=ys[row+1];
   if(x1<0||x0>w||y1<0||y0>h)continue;
   ctx.fillStyle=sc.categorical?CLASSES[vals[i]].color:color(vals[i],sc.domain,sc.palette);ctx.fillRect(x0,y0,x1-x0+.3,y1-y0+.3);
  }ctx.restore();
 }
}
function initMap() {
 map=L.map('map',{zoomControl:false,scrollWheelZoom:false,zoomAnimation:false,fadeAnimation:false,zoomSnap:.25,minZoom:6,maxZoom:16,attributionControl:true});
 map.createPane('climate').style.zIndex=350;map.createPane('roads').style.zIndex=360;map.createPane('county').style.zIndex=450;map.createPane('places').style.zIndex=500;map.getPane('places').style.pointerEvents='none';
 const CanvasLayer=L.Layer.extend({onAdd(m){this._map=m;this.canvas=L.DomUtil.create('canvas','climate-canvas leaflet-layer');this.canvas.style.position='absolute';m.getPane('climate').append(this.canvas);m.on('move zoom resize viewreset',this.redraw,this);this.redraw();},onRemove(m){m.off('move zoom resize viewreset',this.redraw,this);this.canvas.remove();cancelAnimationFrame(this.frame);},redraw(){cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>{const m=this._map,s=m.getSize(),d=Math.min(devicePixelRatio||1,2);L.DomUtil.setPosition(this.canvas,m.containerPointToLayerPoint([0,0]));this.canvas.width=s.x*d;this.canvas.height=s.y*d;this.canvas.style.width=s.x+'px';this.canvas.style.height=s.y+'px';const ctx=this.canvas.getContext('2d');ctx.scale(d,d);drawNative(ctx,m,s.x,s.y);});}});
 setBasemap('satellite');roads=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',{pane:'roads',crossOrigin:'anonymous',maxZoom:19,attribution:'Roads © Esri'}).addTo(map);
 climate=new CanvasLayer().addTo(map);boundaryLayer=L.geoJSON(county,{pane:'county',style:{color:'#fff',weight:2,opacity:.95,fill:false},interactive:false}).addTo(map);
 placeNames=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{pane:'places',crossOrigin:'anonymous',maxZoom:19,attribution:'Place labels © Esri and data providers'}).addTo(map);
 L.control.scale({position:'topleft',imperial:false,maxWidth:110}).addTo(map);home();
 $('map').addEventListener('click',()=>map.scrollWheelZoom.enable());$('map').addEventListener('focus',()=>map.scrollWheelZoom.enable());$('map').addEventListener('mouseleave',()=>map.scrollWheelZoom.disable());$('map').addEventListener('blur',()=>map.scrollWheelZoom.disable());
 let hoverFrame;map.on('mousemove',e=>{if(state.pinned||state.busy)return;cancelAnimationFrame(hoverFrame);hoverFrame=requestAnimationFrame(()=>queryPixel(e.latlng,false));});map.on('mouseout',()=>{if(!state.pinned)$('pixel-readout').hidden=true;});
 map.on('click',e=>{if(!state.busy){state.pinned=e.latlng;queryPixel(e.latlng,true);}});
 $('zoom-in').onclick=()=>map.zoomIn();$('zoom-out').onclick=()=>map.zoomOut();$('home').onclick=home;
 $('roads').onchange=e=>{if(e.target.checked)roads.addTo(map);else roads.remove();};$('places').onchange=e=>{if(e.target.checked)placeNames.addTo(map);else placeNames.remove();};$('basemap').onchange=e=>setBasemap(e.target.value);
 $('map').addEventListener('keydown',e=>{if(e.key==='Escape'){state.pinned=null;$('pixel-readout').hidden=true;selectionOutline?.remove();}});
 new ResizeObserver(()=>{if(state.view==='map'){map.invalidateSize();climate.redraw();}}).observe($('map-panel'));
}
function setBasemap(key){if(base)base.remove();state.basemap=key;const name=key==='satellite'?'World_Imagery':'Canvas/World_Light_Gray_Base';base=L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${name}/MapServer/tile/{z}/{y}/{x}`,{crossOrigin:'anonymous',maxZoom:19,attribution:key==='satellite'?'Imagery © Esri, Maxar, Earthstar Geographics, GIS Community':'Basemap © Esri, HERE, Garmin, OpenStreetMap contributors'}).addTo(map);placeNames?.setUrl(`https://server.arcgisonline.com/ArcGIS/rest/services/${key==='satellite'?'Reference/World_Boundaries_and_Places':'Canvas/World_Light_Gray_Reference'}/MapServer/tile/{z}/{y}/{x}`);}
function home(){map.fitBounds(boundaryLayer.getBounds(),{paddingTopLeft:[42,25],paddingBottomRight:[42,120]});}
function queryPixel(ll,pinned) {
 if(!inCounty([ll.lng,ll.lat],county.features[0].geometry)){if(!pinned)$('pixel-readout').hidden=true;else{state.pinned=null;$('pixel-readout').hidden=true;selectionOutline?.remove();}return;}
 const i=cellAt(bundle,ll.lng,ll.lat);if(i<0)return;const m=META[state.metric],el=$('pixel-readout');el.hidden=false;el.replaceChildren();
 if(pinned){const close=document.createElement('button');close.textContent='✕';close.setAttribute('aria-label','Close location values');close.onclick=()=>{state.pinned=null;el.hidden=true;selectionOutline?.remove();};el.append(close);}
 let text;if(state.metric==='speih')text=result.years.length===1?`${fmt(result.mean[i],2)} SPEI · ${CLASSES[category(result.mean[i])].label}`:`Dry years: ${fmt(result.frequency[i])}% selected · ${fmt(result.baselineFrequency[i])}% reference`;
 else text=`${fmt(result.mean[i],2)} ${m.unit} selected · ${fmt(bundle.baseline[i],2)} reference · ${signed(result.anomaly[i])} difference`;
 const strong=document.createElement('strong');strong.textContent=text;const small=document.createElement('small');small.textContent=`${labelYears()} · June 1 to October 30${pinned?` · ${ll.lat.toFixed(4)}°N, ${Math.abs(ll.lng).toFixed(4)}°W`:''}${coverageNote()?' · 2024: 151/152 days':''}`;el.append(strong,small);
 if(pinned){selectionOutline?.remove();const [a,,c,,,f]=bundle.transform,e=bundle.transform[4],col=bundle.ids[i]%bundle.width,row=Math.floor(bundle.ids[i]/bundle.width);selectionOutline=L.rectangle([[f+row*e,c+col*a],[f+(row+1)*e,c+(col+1)*a]],{color:'#fff',weight:2,fill:false,dashArray:'5 3',interactive:false,pane:'county'}).addTo(map);}
}
function setSwipe(v){state.swipe=Math.max(5,Math.min(95,v));$('divider').style.left=state.swipe+'%';$('swipe').setAttribute('aria-valuenow',Math.round(state.swipe));climate?.redraw();}
function initSwipe(){const handle=$('swipe');let dragging=false;handle.addEventListener('pointerdown',e=>{dragging=true;handle.setPointerCapture(e.pointerId);e.preventDefault();});handle.addEventListener('pointermove',e=>{if(!dragging)return;const r=$('map').getBoundingClientRect();setSwipe((e.clientX-r.left)/r.width*100);});handle.addEventListener('pointerup',()=>dragging=false);handle.addEventListener('pointercancel',()=>dragging=false);handle.addEventListener('keydown',e=>{const n={ArrowLeft:-3,ArrowRight:3,Home:5-state.swipe,End:95-state.swipe}[e.key];if(n!==undefined){e.preventDefault();setSwipe(state.swipe+n);}});}
function setView(view){state.view=view;for(const v of ['map','graph']){$(v+'-panel').hidden=v!==view;$(v+'-tab').setAttribute('aria-selected',v===view);$(v+'-tab').tabIndex=v===view?0:-1;}$('map-options-button').hidden=view!=='map';if(view==='map')requestAnimationFrame(()=>{map.invalidateSize();climate.redraw();});else drawGraph();update();}
function svgElement(name,attrs={},text){const el=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;return el;}
function weekValues(values,last=false){const out=[];for(let i=0;i<values.length;i+=7){const a=values.slice(i,i+7);out.push(a.some(v=>v===null)?null:last?a.at(-1):a.reduce((s,v)=>s+v,0)/a.length);}return out;}
function chartSeries() {
 const isSpei=state.metric==='speih',m=META[state.metric];
 if(isSeasonGraph()){
  let a=dailySelection(bundle,state.start,state.end),b=bundle.dailyBaseline; if(state.metric==='precip'){a=cumulative(a);b=cumulative(b);}
  if(state.graph==='weekly'){a=weekValues(a,state.metric==='precip');b=weekValues(b,state.metric==='precip');}
  return [{key:'selected',label:labelYears(),color:'#14779e',values:a},{key:'reference',label:'1991 to 2020 reference',color:'#a3542f',dash:true,values:b}];
 }
 const annual=bundle.county.map(r=>isSpei?r.drought_area_pct:r.value),baseline=isSpei?result.countyBaseline:result.countyBaseline;
 const series=[{key:'annual',label:'Annual seasons',color:'#14779e',values:annual},{key:'reference',label:'1991 to 2020 reference',color:'#a3542f',dash:true,values:YEARS.map(()=>baseline)}];
 if($('rolling').checked)series.push({key:'rolling',label:'5-year moving average',color:'#315d41',values:movingAverage(annual)});return series;
}
function drawGraph() {
 if(!bundle||state.busy||state.view!=='graph')return;const m=META[state.metric],isSpei=state.metric==='speih';const supportsRolling=state.graph==='annual';$('rolling-label').hidden=!supportsRolling;$('rolling').disabled=!supportsRolling;if(!supportsRolling){$('rolling').checked=false;state.hidden.delete('rolling');}setText('graph-spatial',isSeasonGraph()?`COUNTYWIDE · ${state.graph==='weekly'?'WEEKLY':'DAILY'} REGIONAL MEANS`:'COUNTYWIDE · AREA WEIGHTED');
 setText('graph-title',state.graph==='classes'?`Moisture classes across Valley County`:isSeasonGraph()?`${labelYears()} ${state.metric==='precip'?'cumulative rainfall':m.name.toLowerCase()}`:isSpei?'County area in dry conditions':`${m.short} across 35 seasons`);
 setText('graph-description',state.graph==='classes'?`Area in each annual SPEI class, averaged across ${labelYears()}, compared with the reference. Each bar totals 100%.`:isSeasonGraph()?`Countywide ${state.graph==='weekly'?'weekly':'daily'} regional means; ${result.years.length>1?'selected years are averaged by calendar day; ':''}${state.metric==='precip'?'rainfall accumulates from June 1.':'June 1 to October 30.'} ${coverageNote()}`:`June 1 to October 30 each year. Shaded years: ${labelYears()}. ${isSpei?'Dry means pixel SPEI ≤ −1. Values are county area percentages.':'Values weight native pixels by their area inside Valley County.'}`);
 const svg=$('chart');svg.replaceChildren();const rect=$('chart-wrap').getBoundingClientRect(),W=Math.max(340,rect.width),H=Math.max(245,rect.height);svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('aria-label',$('graph-title').textContent);const margin={l:62,r:24,t:24,b:40},pw=W-margin.l-margin.r,ph=H-margin.t-margin.b;
 if(state.graph==='classes'){drawClassGraph(svg,W,H,margin);return;}
 const series=chartSeries();if(series.every(s=>state.hidden.has(s.key)))state.hidden.delete(series[0].key);const visible=series.filter(s=>!state.hidden.has(s.key));renderSeriesLegend(series);
 const values=visible.flatMap(s=>s.values).filter(Number.isFinite),domain=scaleRange(values,{positive:isSpei||m.positive});if(isSpei){domain[0]=Math.max(0,domain[0]);domain[1]=Math.min(100,domain[1]);}
 const len=series[0].values.length,x=i=>margin.l+i/(len-1)*pw,y=v=>margin.t+ph-(v-domain[0])/(domain[1]-domain[0])*ph;
 if(state.graph==='annual')svg.append(svgElement('rect',{x:x(state.start-1991)-pw/(len-1)*.45,y:margin.t,width:(state.end-state.start+.9)*pw/(len-1),height:ph,fill:'#e8f1e8'}));
 for(let i=0;i<=5;i++){const v=domain[0]+(domain[1]-domain[0])*i/5,yy=y(v);svg.append(svgElement('line',{x1:margin.l,y1:yy,x2:W-margin.r,y2:yy,class:'chart-grid'}),svgElement('text',{x:margin.l-9,y:yy+4,'text-anchor':'end',class:'axis'},fmt(v,(domain[1]-domain[0])<5?1:0)));}
 svg.append(svgElement('text',{x:margin.l,y:13,class:'axis'},isSpei?'County area (%)':unit()));
 const ticks=state.graph==='annual'?[[0,'1991'],[9,'2000'],[19,'2010'],[29,'2020'],[34,'2025']]:(state.graph==='weekly'?[[0,'Jun 1–7'],[4,'Jul 5'],[8,'Aug 2'],[13,'Sep 6'],[17,'Oct 4'],[21,'Oct 30']]:[[0,'Jun 1'],[30,'Jul 1'],[61,'Aug 1'],[92,'Sep 1'],[122,'Oct 1'],[151,'Oct 30']]);
 for(const[i,label]of ticks)svg.append(svgElement('text',{x:x(i),y:H-12,'text-anchor':i===0?'start':i===len-1?'end':'middle',class:'axis'},label));
 for(const s of visible){let d='',pen=false;for(let i=0;i<len;i++){const v=s.values[i];if(v===null||!Number.isFinite(v)){pen=false;continue;}d+=`${pen?'L':'M'}${x(i).toFixed(2)},${y(v).toFixed(2)} `;pen=true;}svg.append(svgElement('path',{d,fill:'none',stroke:s.color,'stroke-width':s.key==='rolling'?2.5:2,'stroke-dasharray':s.dash?'6 5':'none'}));}
 const cursor=svgElement('line',{x1:0,y1:margin.t,x2:0,y2:margin.t+ph,stroke:'#6d8777','stroke-dasharray':'3 3',visibility:'hidden'});svg.append(cursor);
 const read=i=>{cursor.setAttribute('x1',x(i));cursor.setAttribute('x2',x(i));cursor.setAttribute('visibility','visible');const when=state.graph==='annual'?YEARS[i]:state.graph==='weekly'?`${manifest.dates[i*7]} to ${manifest.dates[Math.min(151,i*7+6)]}`:manifest.dates[i].replace('-','/');setText('chart-readout',`${when} · ${visible.map(s=>`${s.label}: ${s.values[i]===null?'No data (source gap)':fmt(s.values[i],2)+' '+(isSpei?'%':unit())}`).join(' · ')}${state.metric==='fwi'&&state.graph==='annual'&&YEARS[i]===2024?' · 151/152 days; no interpolation.':''}`);};
 if(state.graph==='annual')for(let i=0;i<len;i++){
  const s=visible.find(s=>s.key==='annual')||visible.find(s=>Number.isFinite(s.values[i]));if(!s)continue;const dot=svgElement('circle',{cx:x(i),cy:y(s.values[i]),r:state.start<=YEARS[i]&&YEARS[i]<=state.end?4.3:3,fill:s.color,stroke:'white','stroke-width':1.2,class:'chart-dot',tabindex:0,role:'button','aria-label':`${YEARS[i]}: ${fmt(s.values[i],2)} ${isSpei?'percent':unit()}`});dot.addEventListener('mouseenter',()=>read(i));dot.addEventListener('focus',()=>read(i));dot.addEventListener('click',()=>read(i));dot.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();read(i);}});svg.append(dot);
 }else{
  const hit=svgElement('rect',{x:margin.l,y:margin.t,width:pw,height:ph,fill:'transparent',class:'chart-hit',tabindex:0,role:'slider','aria-label':'Inspect daily countywide values','aria-valuemin':0,'aria-valuemax':len-1,'aria-valuenow':0});let index=0;
  const inspect=e=>{const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const p=point.matrixTransform(svg.getScreenCTM().inverse());index=Math.max(0,Math.min(len-1,Math.round((p.x-margin.l)/pw*(len-1))));hit.setAttribute('aria-valuenow',index);read(index);};hit.addEventListener('mousemove',inspect);hit.addEventListener('click',inspect);hit.addEventListener('focus',()=>read(index));hit.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();index=Math.max(0,Math.min(len-1,index+(e.key==='ArrowRight'?1:-1)));hit.setAttribute('aria-valuenow',index);read(index);}});svg.append(hit);
 }
}
function renderSeriesLegend(series){const box=$('series-legend');box.replaceChildren();for(const s of series){const b=document.createElement('button');b.setAttribute('aria-pressed',!state.hidden.has(s.key));b.innerHTML=`<span class="series-line ${s.dash?'dashed':''}" style="--color:${s.color}"></span>${s.label}`;b.onclick=()=>{if(state.hidden.has(s.key))state.hidden.delete(s.key);else if(series.filter(x=>!state.hidden.has(x.key)).length>1)state.hidden.add(s.key);drawGraph();};box.append(b);}}
function drawClassGraph(svg,W,H,margin){
 $('series-legend').replaceChildren();const box=$('series-legend');for(const c of CLASSES){const s=document.createElement('span');s.style.cssText='display:flex;align-items:center;gap:4px;font-size:.64rem';s.title=c.range;s.innerHTML=`<i class="swatch" style="background:${c.color}"></i>${c.label}`;box.append(s);}
 const left=W<600?85:145,right=24,pw=W-left-right,barH=Math.min(66,(H-90)/2.6),rows=[{label:labelYears(),values:result.classes,y:40},{label:'1991 to 2020',values:result.baselineClasses,y:40+barH+45}];
 for(let t=0;t<=100;t+=20){const xx=left+t/100*pw;svg.append(svgElement('line',{x1:xx,y1:20,x2:xx,y2:H-30,class:'chart-grid'}),svgElement('text',{x:xx,y:H-10,'text-anchor':'middle',class:'axis'},t+'%'));}
 for(const r of rows){svg.append(svgElement('text',{x:left-10,y:r.y+barH/2+4,'text-anchor':'end',class:'axis'},r.label));let offset=0;for(let j=0;j<7;j++){const v=r.values[j],c=CLASSES[j],rect=svgElement('rect',{x:left+offset/100*pw,y:r.y,width:v/100*pw,height:barH,fill:c.color,stroke:'white','stroke-width':.5,tabindex:0,role:'button','aria-label':`${r.label}, ${c.label}: ${fmt(v,2)} percent of county area`});const read=()=>setText('chart-readout',`${r.label} · ${c.label}: ${fmt(v,2)}% of county area · ${c.range}`);rect.append(svgElement('title',{},`${c.label}: ${fmt(v,2)}%`));rect.addEventListener('mouseenter',read);rect.addEventListener('focus',read);rect.addEventListener('click',read);rect.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();read();}});svg.append(rect);if(v>8)svg.append(svgElement('text',{x:left+(offset+v/2)/100*pw,y:r.y+barH/2+4,'text-anchor':'middle',fill:[0,1,5,6].includes(j)?'white':'#163448','font-size':11,'font-family':'system-ui','pointer-events':'none'},fmt(v,0)+'%'));offset+=v;}}
}
function renderMoistureClasses(){
 const body=$('moisture-class-rows');body.replaceChildren();
 CLASSES.forEach((c,i)=>{const row=document.createElement('tr'),name=document.createElement('th'),range=document.createElement('td'),dry=document.createElement('td');name.scope='row';const swatch=document.createElement('i');swatch.className='swatch';swatch.style.background=c.color;swatch.setAttribute('aria-hidden','true');name.append(swatch,document.createTextNode(c.label));range.textContent=c.range;dry.textContent=i<3?'Yes':'No';row.append(name,range,dry);body.append(row);});
}
function initControls(){
 renderMoistureClasses();
 $('export-context').hidden=!isEmbedded();$('export-help-close').onclick=()=>$('export-help').close();
 const params=new URLSearchParams(location.search);if(META[params.get('metric')])state.metric=params.get('metric');const from=Number(params.get('from')),to=Number(params.get('to'));if(params.has('from')&&Number.isInteger(from)&&Number.isInteger(to)&&from>=MIN_COMPARE_YEAR&&to<=MAX_COMPARE_YEAR&&from<=to){state.start=from;state.end=to;}if(params.get('panel')==='graph')state.view='graph';
 if(downloadRequest&&!isEmbedded()){const s=downloadRequest.snapshot;Object.assign(state,{metric:s.metric,start:s.start,end:s.end,view:s.view,graph:s.graph});}
 noUiSlider.create($('timeline'),{start:[state.start,state.end],connect:true,step:1,range:{min:MIN_COMPARE_YEAR,max:MAX_COMPARE_YEAR},keyboardSupport:true,handleAttributes:[{'aria-label':'First year'},{'aria-label':'Last year'}],format:{to:v=>String(Math.round(v)),from:Number}});
 $('timeline').noUiSlider.on('update',values=>{state.start=Number(values[0]);state.end=Number(values[1]);$('timeline').classList.toggle('single-year',state.start===state.end);$('year-start').value=state.start;$('year-end').value=state.end;setText('year-label',labelYears());scheduleUpdate();});
 for(const id of ['year-start','year-end'])$(id).addEventListener('change',()=>{let a=Number($('year-start').value),b=Number($('year-end').value);if(!Number.isInteger(a)||!Number.isInteger(b)||a<MIN_COMPARE_YEAR||b>MAX_COMPARE_YEAR||a>b){$('year-start').value=state.start;$('year-end').value=state.end;return;}$('timeline').noUiSlider.set([a,b]);});$('reset-year').onclick=()=>$('timeline').noUiSlider.set([2025,2025]);
 document.querySelectorAll('[data-metric]').forEach(b=>b.onclick=()=>loadMetric(b.dataset.metric));
 for(const v of ['map','graph'])$(v+'-tab').onclick=()=>setView(v);document.querySelector('.tabs').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const v=e.key==='Home'?'map':e.key==='End'?'graph':state.view==='map'?'graph':'map';setView(v);$(v+'-tab').focus();}});
 function options(open){$('map-options').hidden=!open;$('map-options-button').setAttribute('aria-expanded',open);}$('map-options-button').onclick=()=>options($('map-options').hidden);$('options-close').onclick=()=>options(false);
 $('opacity').oninput=e=>{state.opacity=Number(e.target.value)/100;setText('opacity-value',e.target.value+'%');climate.redraw();};$('color-mode').onchange=e=>{state.colorMode=e.target.value;update();};$('comparison').onchange=e=>{state.comparison=e.target.value;update();};for(const side of ['left','right'])$(side+'-satellite').onchange=()=>climate.redraw();
 $('graph-mode').onchange=e=>{state.graph=e.target.value;state.hidden.clear();update();};$('rolling').onchange=()=>drawGraph();new ResizeObserver(()=>{if(state.view==='graph')drawGraph();}).observe($('chart-wrap'));
 for(const id of ['about-open','methods-link'])$(id).onclick=()=>{if($('about').parentElement!==$('app')&&(document.fullscreenElement||document.webkitFullscreenElement))$('app').append($('about'));$('about').showModal();};$('about-close').onclick=()=>$('about').close();$('about').addEventListener('click',e=>{if(e.target===$('about')){const r=$('about').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('about').close();}});
 let fullscreenFallback=false;$('fullscreen').onclick=async()=>{if(fullscreenFallback){window.open(location.href,'_blank','noopener');return;}try{if(document.fullscreenElement||document.webkitFullscreenElement)await(document.exitFullscreen?.()??document.webkitExitFullscreen?.());else{const method=$('app').requestFullscreen||$('app').webkitRequestFullscreen;if(!method)throw Error('Fullscreen unavailable');await method.call($('app'));}}catch{fullscreenFallback=true;setText('export-status','Fullscreen is restricted here. Select ⛶ again to open a full-page view.');$('fullscreen').setAttribute('aria-label','Open full-page view');}};
 for(const e of ['fullscreenchange','webkitfullscreenchange'])document.addEventListener(e,()=>{$('app').classList.toggle('app-fullscreen',!!(document.fullscreenElement||document.webkitFullscreenElement));requestAnimationFrame(()=>{map.invalidateSize();climate.redraw();drawGraph();});});
 document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>exportCurrent(b.dataset.export));
}
function csvCell(v){const s=v===null||v===undefined?'':String(v);return /[",\n\r]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;}
function download(blob,name){
 const url=URL.createObjectURL(blob);let a=document.createElement('a');a.href=url;a.download=name;
 if(downloadRequest&&!isEmbedded()){
  // Keep a real file link available for browsers that require a second user gesture.
  const previous=$('download-again');if(previous.tagName==='A')URL.revokeObjectURL(previous.href);
  a.id='download-again';a.className='quiet download-file';a.setAttribute('role','button');a.textContent=`Download ${downloadRequest.type.toUpperCase()}`;previous.replaceWith(a);a.click();return;
 }
 document.body.append(a);a.click();a.remove();const timer=setTimeout(()=>URL.revokeObjectURL(url),30000);timer.unref?.();
}
function captureExportState(){
 const center=map.getCenter(),viewport=$('app').getBoundingClientRect();
 return {...state,hidden:[...state.hidden],center:[center.lat,center.lng],zoom:map.getZoom(),viewport:{width:viewport.width,height:viewport.height},roads:$('roads').checked,places:$('places').checked,leftSatellite:$('left-satellite').checked,rightSatellite:$('right-satellite').checked,rolling:$('rolling').checked};
}
function showEmbeddedExport(type){
 const href=exportPageURL(location.href,type,captureExportState()),dialog=$('export-help');
 setText('export-help-title',`Download ${type.toUpperCase()}`);
 setText('export-help-selection',`${META[state.metric].name} · ${labelYears()} · ${state.view==='map'?'Map':$('graph-mode').selectedOptions[0].textContent}`);
 $('export-view-link').value=href;
 if(dialog.parentElement!==$('app')&&(document.fullscreenElement||document.webkitFullscreenElement))$('app').append(dialog);
 dialog.showModal();$('export-view-link').focus();$('export-view-link').select();
 setText('export-status','Use the full explorer link below this map to download.');
}
function restoreExportState(s){
 Object.assign(state,{swipe:s.swipe,opacity:s.opacity,colorMode:s.colorMode,comparison:s.comparison,hidden:new Set(s.hidden)});
 $('opacity').value=Math.round(s.opacity*100);setText('opacity-value',Math.round(s.opacity*100)+'%');
 $('color-mode').value=s.colorMode;$('comparison').value=s.comparison;$('basemap').value=s.basemap;setBasemap(s.basemap);
 for(const [id,layer,enabled]of [['roads',roads,s.roads],['places',placeNames,s.places]]){$(id).checked=enabled;if(enabled)layer.addTo(map);else layer.remove();}
 $('left-satellite').checked=s.leftSatellite;$('right-satellite').checked=s.rightSatellite;$('rolling').checked=s.rolling;
 map.invalidateSize();map.setView(s.center,s.zoom,{animate:false});setSwipe(s.swipe);update();
}
async function prepareRequestedDownload(){
 const {type,snapshot}=downloadRequest,banner=$('download-banner'),app=$('app'),label=type.toUpperCase();
 banner.hidden=false;app.classList.add('download-layout');app.style.width=snapshot.viewport.width+'px';app.style.height=snapshot.viewport.height+'px';app.inert=true;
 setText('download-title',`${label} download`);setText('download-message','Preparing the view you selected…');
 const back=new URL(location.href);back.searchParams.delete('download');back.searchParams.delete('settings');$('download-return').href=back.href;
 const button=$('download-again');button.textContent=`Download ${label}`;
 await new Promise(requestAnimationFrame);restoreExportState(snapshot);await new Promise(requestAnimationFrame);
 if(state.view==='map')await Promise.all([base,...($('roads').checked?[roads]:[]),...($('places').checked?[placeNames]:[])].map(layer=>new Promise(resolve=>{
  if(!layer.isLoading())return resolve();const timer=setTimeout(done,8000);function done(){clearTimeout(timer);layer.off('load',done);resolve();}layer.once('load',done);
 })));
 await new Promise(requestAnimationFrame);
 button.disabled=false;button.onclick=()=>exportCurrent(type);
 const ok=await exportCurrent(type);setText('download-message',ok?`${label} prepared. If the download did not start, select Download ${label}.`:'The download could not finish. Select Download to try again.');
}
function exportCSV(){
 const m=META[state.metric],note=coverageNote(),meta=[['region','Valley County, Idaho'],['indicator',m.name],['selected_years',labelYears()],['season','June 1 to October 30 inclusive'],['reference','1991 to 2020'],['source',m.source],['native_grid',m.resolution],['native_crs',bundle.crs],['coverage',note||(state.metric==='speih'?'Seasonal standardized product; day-by-day source coverage not independently audited':'No approved source gap in selected seasons')],['aggregation',state.metric==='speih'?'Annual classifications or annual drought frequency; no classification of a mean index':'Equal-weight mean of annual seasonal values; native pixel county-intersection area weighting']];let rows=[];
 if(state.view==='map'){
  const common=['cell_id','longitude','latitude','county_intersection_area_m2'];rows.push([...common,...(state.metric==='speih'?(result.years.length===1?['annual_spei','annual_class','selected_dry_years_pct','reference_dry_years_pct']:['selected_dry_years_pct','reference_dry_years_pct','difference_percentage_points']):[`selected_${m.unit}`,`reference_${m.unit}`,`difference_${m.unit}`])]);
  const[a,,c,,,f]=bundle.transform,e=bundle.transform[4];for(let i=0;i<bundle.count;i++){const id=bundle.ids[i],col=id%bundle.width,row=Math.floor(id/bundle.width),values=state.metric==='speih'?(result.years.length===1?[result.mean[i],CLASSES[category(result.mean[i])].key,result.frequency[i],result.baselineFrequency[i]]:[result.frequency[i],result.baselineFrequency[i],result.frequency[i]-result.baselineFrequency[i]]):[result.mean[i],bundle.baseline[i],result.anomaly[i]];rows.push([id,c+(col+.5)*a,f+(row+.5)*e,bundle.weights[i],...values]);}
 }else if(state.graph==='classes'){rows.push(['class','definition','selected_mean_annual_area_pct','reference_mean_annual_area_pct']);CLASSES.forEach((c,i)=>rows.push([c.label,c.range,result.classes[i],result.baselineClasses[i]]));}
 else if(isSeasonGraph()){
  meta.push(['spatial_method','Climate Engine regional mean over simplified query boundary; differs from native-grid seasonal maps'],['missing_days','Any missing selected source day stays blank; no interpolation']);
  if(state.graph==='weekly'){
   const series=chartSeries();meta.push(['display_interval',state.metric==='precip'?'Cumulative rainfall at the end of each week':'Calendar-week mean; last interval contains 5 days']);
   rows.push(['week_start','week_end',`selected_${m.unit}`,`reference_${m.unit}`]);series[0].values.forEach((v,i)=>rows.push([manifest.dates[i*7],manifest.dates[Math.min(151,i*7+6)],v,series[1].values[i]]));
  }else{
   const a=dailySelection(bundle,state.start,state.end),b=bundle.dailyBaseline,ac=state.metric==='precip'?cumulative(a):null,bc=state.metric==='precip'?cumulative(b):null;
   rows.push(['month_day',`selected_daily_${m.unit}`,`reference_daily_${m.unit}`,...(ac?[`selected_cumulative_${m.unit}`,`reference_cumulative_${m.unit}`]:[])]);
   manifest.dates.forEach((d,i)=>rows.push([d,a[i],b[i],...(ac?[ac[i],bc[i]]:[])]));
  }
 }
 else{rows.push(['year','in_selected_range',state.metric==='speih'?'drought_area_pct':`seasonal_value_${m.unit}`,state.metric==='speih'?'reference_mean_drought_area_pct':`reference_${m.unit}`,'coverage_note']);bundle.county.forEach(r=>rows.push([r.year,r.year>=state.start&&r.year<=state.end,state.metric==='speih'?r.drought_area_pct:r.value,result.countyBaseline,r.coverage_note||'']));}
 const text=meta.map(r=>'# '+r.map(csvCell).join(',')).join('\r\n')+'\r\n'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');download(new Blob(['\ufeff'+text],{type:'text/csv;charset=utf-8'}),filename('csv'));
}
function filename(ext){return `valley-county_${state.metric}_${state.start}_${state.end}_0601_1030_${state.view}${state.view==='graph'?'_'+state.graph:''}.${ext}`;}
function wrapText(ctx,text,x,y,maxWidth,lineHeight,maxLines=99){const words=text.split(/\s+/);let line='',count=0;for(const word of words){const next=line?line+' '+word:word;if(ctx.measureText(next).width>maxWidth&&line){ctx.fillText(line,x,y);y+=lineHeight;count++;line=word;if(count>=maxLines)return y;}else line=next;}if(line){ctx.fillText(line,x,y);y+=lineHeight;}return y;}
async function exportImage(){
 const isMap=state.view==='map',m=META[state.metric],source=isMap?$('map'):$('chart'),r=source.getBoundingClientRect(),width=Math.max(1000,Math.round(r.width)),scale=width/r.width,height=Math.max(300,Math.round(r.height*scale)),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height+235;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#163448';ctx.font='bold 25px system-ui';ctx.fillText(`Valley County · ${m.name}`,26,35);ctx.font='14px system-ui';ctx.fillText(`${labelYears()} | June 1 to October 30 | Reference: 1991 to 2020`,26,61);let imagery=true;
 ctx.save();ctx.translate(0,84);ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();
 if(isMap){
  ctx.fillStyle='#d4ddd1';ctx.fillRect(0,0,width,height);ctx.save();ctx.scale(scale,scale);const rect=$('map').getBoundingClientRect();
  const tiles=[...$('map').querySelectorAll('.leaflet-tile-pane img.leaflet-tile-loaded')];imagery=tiles.length>0;for(const img of tiles){const p=img.getBoundingClientRect();ctx.drawImage(img,p.left-rect.left,p.top-rect.top,p.width,p.height);}
  const test=document.createElement('canvas');test.width=test.height=1;const tc=test.getContext('2d');try{for(const img of [...tiles,...['roads','places'].flatMap(name=>$(name).checked?[...map.getPane(name).querySelectorAll('img.leaflet-tile-loaded')]:[])])tc.drawImage(img,0,0,1,1);tc.getImageData(0,0,1,1);}catch{imagery=false;}
  ctx.restore();if(!imagery){ctx.restore();return exportImageWithoutTiles(width,height,m);}
  ctx.save();ctx.scale(scale,scale);drawNative(ctx,map,r.width,r.height);for(const name of ['roads','places'])if($(name).checked){for(const img of map.getPane(name).querySelectorAll('img.leaflet-tile-loaded')){const p=img.getBoundingClientRect();ctx.drawImage(img,p.left-rect.left,p.top-rect.top,p.width,p.height);}}
  drawMapDecoration(ctx,r.width,r.height);ctx.restore();
 }else{const clone=$('chart').cloneNode(true);clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width',r.width);clone.setAttribute('height',r.height);const style=svgElement('style',{},'.axis{fill:#60766c;font:11px system-ui}.chart-grid{stroke:#e1e9e3;stroke-width:1}');clone.prepend(style);const svgBlob=new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}),url=URL.createObjectURL(svgBlob);try{const img=await loadImage(url);ctx.drawImage(img,0,0,width,height);}finally{URL.revokeObjectURL(url);}}
 ctx.restore();drawExportFooter(ctx,width,height,imagery);return canvas;
}
function loadImage(url){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=url;});}
function exportImageWithoutTiles(width,height,m){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height+235;const ctx=canvas.getContext('2d'),r=$('map').getBoundingClientRect();ctx.fillStyle='white';ctx.fillRect(0,0,width,canvas.height);ctx.fillStyle='#163448';ctx.font='bold 25px system-ui';ctx.fillText(`Valley County · ${m.name}`,26,35);ctx.font='14px system-ui';ctx.fillText(`${labelYears()} | June 1 to October 30 | Reference: 1991 to 2020`,26,61);ctx.save();ctx.translate(0,84);ctx.scale(width/r.width,width/r.width);ctx.fillStyle='#e5e9dd';ctx.fillRect(0,0,r.width,r.height);drawNative(ctx,map,r.width,r.height);drawMapDecoration(ctx,r.width,r.height);ctx.restore();drawExportFooter(ctx,width,height,false);return canvas;}
function drawMapDecoration(ctx,w,h){
 countyPath(ctx,map);ctx.strokeStyle='white';ctx.lineWidth=2;ctx.stroke();

 ctx.strokeStyle='white';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(w*state.swipe/100,0);ctx.lineTo(w*state.swipe/100,h);ctx.stroke();ctx.fillStyle='#fffffff0';ctx.fillRect(12,12,32,51);ctx.fillStyle='#163448';ctx.font='bold 13px system-ui';ctx.fillText('N',23,28);ctx.beginPath();ctx.moveTo(28,34);ctx.lineTo(18,56);ctx.lineTo(28,50);ctx.lineTo(38,56);ctx.closePath();ctx.fill();
 const p1=map.containerPointToLatLng([55,h-18]),p2=map.containerPointToLatLng([155,h-18]),km=map.distance(p1,p2)/1000;ctx.fillStyle='white';ctx.fillRect(15,h-42,145,35);ctx.fillStyle='#163448';ctx.font='11px system-ui';ctx.fillText(`${fmt(km,1)} km`,48,h-25);ctx.strokeStyle='#163448';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(35,h-22);ctx.lineTo(35,h-16);ctx.lineTo(135,h-16);ctx.lineTo(135,h-22);ctx.stroke();
 const schemes=getSchemes(),boxW=Math.min(310,w*.46),boxH=schemes[1].categorical?158:107;for(let s=0;s<2;s++){const xx=s===0?12:w-boxW-12,yy=h-boxH-55;ctx.fillStyle='#fffffff0';ctx.fillRect(xx,yy,boxW,boxH);ctx.fillStyle='#163448';ctx.font='bold 11px system-ui';let next=wrapText(ctx,schemes[s].title,xx+10,yy+19,boxW-20,14,2);ctx.font='10px system-ui';next=wrapText(ctx,schemes[s].note,xx+10,next+1,boxW-20,12,2);
 if(schemes[s].categorical){ctx.font='10px system-ui';for(let j=0;j<7;j++){const y=next+10+j*12;ctx.fillStyle=CLASSES[j].color;ctx.fillRect(xx+10,y-8,8,8);ctx.fillStyle='#163448';ctx.fillText(CLASSES[j].label,xx+23,y);}}
 else{const sc=schemes[s],grad=ctx.createLinearGradient(xx+10,0,xx+boxW-10,0);sc.palette.forEach((c,i)=>grad.addColorStop(i/(sc.palette.length-1),c));ctx.fillStyle=grad;ctx.fillRect(xx+10,next+6,boxW-20,9);ctx.fillStyle='#163448';ctx.font='10px system-ui';ctx.fillText(fmt(sc.domain[0],1),xx+10,next+29);ctx.textAlign='right';ctx.fillText(fmt(sc.domain[1],1),xx+boxW-10,next+29);ctx.textAlign='left';}
 if($(s===0?'left-satellite':'right-satellite').checked){ctx.fillStyle='#163448';ctx.font='bold 10px system-ui';ctx.fillText('Climate layer hidden',xx+10,yy+boxH-7);}}
}
function drawExportFooter(ctx,w,h,imagery){const m=META[state.metric];ctx.fillStyle='#163448';ctx.font='13px system-ui';let y=wrapText(ctx,$('metric-summary').textContent,26,h+111,w-52,19,2);ctx.fillStyle='#516c5e';ctx.font='11px system-ui';y=wrapText(ctx,`${m.source} | Native grid: ${m.resolution} | Valley County, Idaho | ${state.view==='graph'&&isSeasonGraph()?'Daily regional means over simplified query boundary':'County-intersection area weighting'} | Equal-weight annual seasons`,26,y+4,w-52,16,2);if(state.view==='map')y=wrapText(ctx,imagery?'Basemap © Esri and data providers.':'Basemap omitted from export because image access is restricted.',26,y,w-52,16,1);if(coverageNote()){ctx.fillStyle='#855b19';wrapText(ctx,coverageNote(),26,y+3,w-52,16,2);}}
async function exportCurrent(type){
 if(state.busy||!bundle||!['png','pdf','csv'].includes(type))return false;$('export-menu').open=false;
 try{
  if(isEmbedded()){showEmbeddedExport(type);return true;}
  setText('export-status',`Preparing ${type.toUpperCase()}…`);
  if(type==='csv')exportCSV();
  else{const canvas=await exportImage();if(type==='png'){const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('Image unavailable');download(blob,filename('png'));}
   else{const PDF=window.jspdf?.jsPDF;if(!PDF)throw Error('PDF export library unavailable');const pdf=new PDF({orientation:canvas.width>canvas.height?'landscape':'portrait',unit:'px',format:[canvas.width,canvas.height],hotfixes:['px_scaling']});pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,canvas.width,canvas.height);pdf.setProperties({title:`Valley County ${META[state.metric].name} ${labelYears()}`,subject:'June 1 to October 30; reference 1991 to 2020',author:'UCross Valley County project'});download(pdf.output('blob'),filename('pdf'));}
  }
  setText('export-status',`${type.toUpperCase()} ready.`);return true;
 }catch(e){setText('export-status','Export could not finish. Please try again or open the explorer.');console.error('Export failed',e);return false;}
}
async function start(){try{const responses=await Promise.all(['manifest.json','county.geojson'].map(f=>fetch('./data/'+f).then(r=>{if(!r.ok)throw Error('Data unavailable');return r.json();})));[manifest,county]=responses;initControls();initMap();initSwipe();setView(state.view);await loadMetric(state.metric);if(downloadRequest&&!isEmbedded()&&!state.busy)await prepareRequestedDownload();}catch(e){setText('loading-text','The explorer could not start. Please reload.');console.error('Explorer startup failed',e);}}
export const ready=start();
export {state,loadMetric,setView,update,drawGraph,queryPixel,exportCurrent};
