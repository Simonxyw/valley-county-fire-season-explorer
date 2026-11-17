export const YEARS = Array.from({length:35}, (_,i)=>1991+i);
export const CLASSES = [
  {key:'extremely_dry',label:'Extremely dry',range:'SPEI ≤ −2',color:'#8c2d04'},
  {key:'severely_dry',label:'Severely dry',range:'−2 < SPEI ≤ −1.5',color:'#d94801'},
  {key:'moderately_dry',label:'Moderately dry',range:'−1.5 < SPEI ≤ −1',color:'#fdae6b'},
  {key:'near_normal',label:'Near normal',range:'−1 < SPEI < 1',color:'#f0f0dc'},
  {key:'moderately_wet',label:'Moderately wet',range:'1 ≤ SPEI < 1.5',color:'#a1d99b'},
  {key:'very_wet',label:'Very wet',range:'1.5 ≤ SPEI < 2',color:'#41ab5d'},
  {key:'extremely_wet',label:'Extremely wet',range:'SPEI ≥ 2',color:'#006d2c'},
];
export function decode64(encoded) {
  const bytes=Uint8Array.from(atob(encoded), c=>c.charCodeAt(0));
  if(bytes.byteLength%8)throw Error('Invalid numerical data length');
  const view=new DataView(bytes.buffer);
  return Float64Array.from({length:bytes.byteLength/8},(_,i)=>view.getFloat64(i*8,true));
}
export function hydrate(bundle) {
  const b={...bundle,weights:decode64(bundle.weights),values:decode64(bundle.annual),baseline:bundle.baseline?decode64(bundle.baseline):null};
  if(b.values.length!==35*b.count || b.weights.length!==b.count)throw Error('Incomplete annual grids');
  if(b.baseline && b.baseline.length!==b.count)throw Error('Incomplete baseline grid');
  b.position=new Map(b.ids.map((id,i)=>[id,i]));
  return b;
}
export function weighted(values,weights) {
  if(values.length!==weights.length||!values.length)throw Error('Unaligned data');
  let sum=0,area=0;
  for(let i=0;i<values.length;i++) {
    if(!Number.isFinite(values[i])||!(weights[i]>0))throw Error('Invalid value or area');
    sum+=values[i]*weights[i];area+=weights[i];
  }
  return sum/area;
}
export function category(v) {return v<=-2?0:v<=-1.5?1:v<=-1?2:v<1?3:v<1.5?4:v<2?5:6;}
export function select(b,start,end) {
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<1991||end>2025||start>end)throw Error('Invalid year range');
  const years=YEARS.filter(y=>y>=start&&y<=end), mean=new Float64Array(b.count);
  for(const [j,y] of years.entries())for(let i=0;i<b.count;i++)mean[i]+=(b.values[(y-1991)*b.count+i]-mean[i])/(j+1);
  if(b.metric!=='speih') {
    const anomaly=Float64Array.from(mean,(v,i)=>v-b.baseline[i]);
    return {years,mean,anomaly,left:mean,right:anomaly,county:weighted(mean,b.weights),countyBaseline:weighted(b.baseline,b.weights),countyAnomaly:weighted(anomaly,b.weights)};
  }
  const frequency=new Float64Array(b.count),baselineFrequency=new Float64Array(b.count);
  for(let i=0;i<b.count;i++) {
    for(const y of years)frequency[i]+=(b.values[(y-1991)*b.count+i]<=-1?100:0)/years.length;
    for(let y=0;y<30;y++)baselineFrequency[i]+=(b.values[y*b.count+i]<=-1?100:0)/30;
  }
  const classes=CLASSES.map(c=>years.reduce((s,y)=>s+b.categories[y][c.key],0)/years.length);
  const baselineClasses=CLASSES.map(c=>YEARS.slice(0,30).reduce((s,y)=>s+b.categories[y][c.key],0)/30);
  return {years,mean,frequency,baselineFrequency,classes,baselineClasses,county:weighted(frequency,b.weights),countyBaseline:weighted(baselineFrequency,b.weights),
    left:years.length===1?mean:frequency,right:years.length===1?Float64Array.from(mean,category):baselineFrequency};
}
export function dailySelection(b,start,end) {
  return b.dailyBaseline.map((_,i)=>{
    const v=b.daily.slice(start-1991,end-1991+1).map(a=>a[i]);
    // A missing source day stays a gap. Do not fill from other selected years.
    return v.some(x=>x===null)?null:v.reduce((s,x)=>s+x,0)/v.length;
  });
}
export function cumulative(values) {
  let sum=0,gap=false;
  return values.map(v=>{if(v===null)gap=true;return gap?null:(sum+=v);});
}
export function movingAverage(values,n=5) {
  return values.map((v,i)=>i<n-1?null:values.slice(i-n+1,i+1).reduce((s,x)=>s+x,0)/n);
}
export function cellAt(b,lng,lat) {
  const [a,,c,,,f]=b.transform,e=b.transform[4];
  const col=Math.floor((lng-c)/a),row=Math.floor((lat-f)/e);
  if(col<0||row<0||col>=b.width||row>=b.height)return -1;
  return b.position.get(row*b.width+col)??-1;
}
function inRing(point,ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    if((yi>point[1])!==(yj>point[1])&&point[0]<(xj-xi)*(point[1]-yi)/(yj-yi)+xi)inside=!inside;
  }
  return inside;
}
export function inCounty(point,geometry) {
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  return polygons.some(p=>inRing(point,p[0])&&!p.slice(1).some(r=>inRing(point,r)));
}
export function bounds(values) {
  let lo=Infinity,hi=-Infinity;
  for(const v of values)if(Number.isFinite(v)){lo=Math.min(lo,v);hi=Math.max(hi,v);}
  if(lo===Infinity)return [0,1];
  return lo===hi?[lo-.5,hi+.5]:[lo,hi];
}
export function scaleRange(values,{zero=false,positive=false}={}) {
  let [lo,hi]=bounds(values);
  if(zero){const m=Math.max(Math.abs(lo),Math.abs(hi));lo=-m;hi=m;}
  const raw=(hi-lo)/5,p=Math.pow(10,Math.floor(Math.log10(raw))),f=raw/p;
  const step=(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p;
  return [positive?Math.max(0,Math.floor(lo/step)*step):Math.floor(lo/step)*step,Math.ceil(hi/step)*step];
}
