/** Keep the originating icon clear, including at viewport edges. */
export function sensePreviewPosition(icon: {left:number;right:number;top:number;bottom:number}, viewport: {width:number;height:number}) {
  const margin=12,gap=12,width=Math.min(420,viewport.width-2*margin);
  const right=viewport.width-icon.right-gap-margin,left=icon.left-gap-margin;
  const minimum=Math.min(320,width);
  if (right>=minimum || left>=minimum) {
    const useRight=right>=minimum;
    const popupWidth=Math.min(width,useRight?right:left);
    const maxHeight=Math.min(460,viewport.height-2*margin);
    return {left:useRight?icon.right+gap:icon.left-gap-popupWidth,top:Math.max(margin,Math.min(icon.top,viewport.height-maxHeight-margin)),width:popupWidth,maxHeight};
  }
  const below=Math.max(0,viewport.height-icon.bottom-gap-margin),above=Math.max(0,icon.top-gap-margin);
  const useBelow=below>=Math.min(360,above);
  const maxHeight=Math.min(460,useBelow?below:above);
  return {left:Math.max(margin,Math.min(icon.left,viewport.width-width-margin)),top:useBelow?icon.bottom+gap:icon.top-gap-maxHeight,width,maxHeight};
}
