import {initInput,pushLayer,focus} from '../web/src/nav.js';
import {TorrentDetailScreen} from '../web/src/screens/torrentdetail.js';
document.body.innerHTML='<div id="stage"><main id="view"></main><div id="overlays"></div><div id="toast"></div></div>';
const view=document.querySelector('#view');
const screen=new TorrentDetailScreen(view,{item:{id:'tt-fixture',type:'movie',name:'Source actions fixture',year:'2026'}},{go(){},back(){},reload(){}});
initInput();pushLayer({root:view,onKey:k=>screen.onKey(k)});
window.__sourceTest={
 ready:()=>view.querySelectorAll('[data-source]').length>=1,
 focus:i=>focus(view.querySelector(`[data-source="${i}"]`)),
 state:()=>({menu:document.querySelector('.sheet')?.textContent||'',menus:document.querySelectorAll('.sheet-wrap').length,selected:screen.index,handoffs:window.__handoffs.length,topControls:view.querySelectorAll('#td-play,#td-download,#td-provider').length}),
};
