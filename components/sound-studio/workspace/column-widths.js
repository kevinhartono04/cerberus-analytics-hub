// Percentages keep the table inside its available width on each screen.
export const DEFAULT_WIDTHS=[18,9,25,20,16,8,4];
export const MIN_WIDTHS=[9,7,14,12,12,4,4];
export function normalizedWidths(widths) {
  const total=widths.reduce((sum,value)=>sum+value,0);
  return widths.map(value=>value/total*100);
}
export function validWidths(value,length) {
  return Array.isArray(value) && value.length===length && value.every(n=>Number.isFinite(n)&&n>=2&&n<=75) && Math.abs(value.reduce((a,b)=>a+b,0)-100)<.1;
}
export function resizeColumn(widths,index,delta) {
  const next=[...widths];
  // Notes gives up space first when Sound ID expands. Other columns retain minima.
  const others=[5,...widths.map((_,i)=>i)].filter((v,i,a)=>v!==index && v!==6 && a.indexOf(v)===i && v<widths.length);
  if(delta>0){
    let remaining=delta;
    for(const i of others){const taken=Math.min(remaining,Math.max(0,next[i]-MIN_WIDTHS[i]));next[i]-=taken;next[index]+=taken;remaining-=taken;if(remaining<=0)break;}
  }else{
    const freed=Math.min(-delta,Math.max(0,next[index]-MIN_WIDTHS[index]));
    const recipient=index===0?2:0;
    next[index]-=freed;next[recipient]+=freed;
  }
  return next;
}
