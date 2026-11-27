import React,{useRef} from 'react';
export default function ColumnResize({label,index,onResize}) {
  const drag=useRef(null);
  return <button type="button" className="column-resize" aria-label={`Resize ${label} column`}
    onPointerDown={e=>{e.preventDefault();const width=e.currentTarget.closest('table').getBoundingClientRect().width;drag.current={x:e.clientX,width,initial:[...e.currentTarget.closest('table').querySelectorAll('thead th')].map(th=>th.getBoundingClientRect().width/width*100)};e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{if(!drag.current)return;const delta=(e.clientX-drag.current.x)/drag.current.width*100;drag.current.x=e.clientX;onResize(index,delta,drag.current.initial);drag.current.initial=null;}}
    onPointerUp={e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
    onLostPointerCapture={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}
    onDoubleClick={()=>onResize(null)}
    onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();const table=e.currentTarget.closest('table'),width=table.getBoundingClientRect().width;onResize(e.key==='Home'?null:index,e.key==='ArrowLeft'?-1:1,[...table.querySelectorAll('thead th')].map(th=>th.getBoundingClientRect().width/width*100));}}}>
    <span aria-hidden="true"/>
  </button>;
}
