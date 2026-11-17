const TYPES=['png','pdf','csv'];
const METRICS=['precip','tmean','tmax','vpd','fwi','speih'];
const number=(value,min,max,fallback)=>Number.isFinite(value)&&value>=min&&value<=max?value:fallback;
const choice=(value,values,fallback)=>values.includes(value)?value:fallback;

// Only presentation settings travel between the embed and its download tab.
export function normalizeExportState(value){
 if(!value||!METRICS.includes(value.metric)||!Number.isInteger(value.start)||!Number.isInteger(value.end)||value.start<2021||value.end>2025||value.start>value.end)throw Error('Invalid export selection');
 const graph=choice(value.graph,value.metric==='speih'?['annual','classes']:['annual','daily','weekly'],'annual');
 return {
  metric:value.metric,start:value.start,end:value.end,view:choice(value.view,['map','graph'],'map'),graph,
  swipe:number(value.swipe,5,95,50),opacity:number(value.opacity,0,1,.78),
  colorMode:choice(value.colorMode,['fixed','selected'],'fixed'),comparison:choice(value.comparison,['anomaly','baseline'],'anomaly'),basemap:choice(value.basemap,['satellite','light'],'satellite'),
  roads:value.roads!==false,places:value.places!==false,leftSatellite:!!value.leftSatellite,rightSatellite:!!value.rightSatellite,
  rolling:graph==='annual'&&!!value.rolling,hidden:Array.isArray(value.hidden)?value.hidden.filter(key=>['annual','selected','reference','rolling'].includes(key)):[],
  center:[number(value.center?.[0],-85,85,44.73),number(value.center?.[1],-180,180,-115.6)],zoom:number(value.zoom,6,16,8),
  viewport:{width:number(value.viewport?.width,320,2000,1200),height:number(value.viewport?.height,500,2400,900)}
 };
}

export function exportPageURL(href,type,snapshot){
 if(!TYPES.includes(type))throw Error('Unknown export format');
 const saved=normalizeExportState(snapshot),url=new URL(href);url.hash='';url.search='';
 for(const [key,value]of Object.entries({metric:saved.metric,from:saved.start,to:saved.end,panel:saved.view,download:type,settings:JSON.stringify(saved)}))url.searchParams.set(key,value);
 return url.href;
}

export function readExportRequest(href){
 try{const url=new URL(href),type=url.searchParams.get('download');if(!TYPES.includes(type))return null;
  const raw=url.searchParams.get('settings');if(!raw||raw.length>5000)return null;
  return {type,snapshot:normalizeExportState(JSON.parse(raw))};
 }catch{return null;}
}
