// Shared fixture for Chromium and the actual Android WebView bridge.
import { poster, logo, artworkImage } from '../web/src/ui.js';
const src = window.__imageBase + '/image';
// Force the older-engine condition even in current browser CI.
const compatibility = document.createElement('style');
compatibility.textContent = '*{aspect-ratio:auto!important} #fixture{display:flex;flex-wrap:wrap;height:100%;overflow-y:auto;align-content:flex-start} #fixture>div{margin:12px}';
document.head.appendChild(compatibility);
document.body.innerHTML = '<div id="fixture">' +
  '<div id="poster-case" style="width:204px">' + poster({name:'Film poster',img:src}) + '</div>' +
  '<div id="series-case" style="width:180px">' + poster({name:'Series poster',img:src}) + '</div>' +
  '<div id="compact-case" style="width:160px">' + poster({name:'Compact poster',img:src}) + '</div>' +
  '<div id="search-case" class="best poster" style="width:230px">' + poster({name:'Search poster',img:src}) + '</div>' +
  '<div id="landscape-case" style="width:320px">' + poster({name:'Landscape',img:src},true) + '</div>' +
  '<div id="logo-case" style="width:80px">' + logo({name:'Logo',logo:src}) + '</div>' +
  '<div id="banner-case" style="width:180px;height:240px">' + artworkImage(window.__imageBase+'/redirect',960,'banner') + '</div>' +
  '<div id="missing-case" style="width:180px">' + poster({name:'Unavailable artwork',img:window.__imageBase+'/missing'}) + '</div></div>';
// Exercise boxes that never deliver the placeholder image load event. The
// insertion observer must discover both film and series artwork on its own.
for (const image of document.querySelectorAll('img[data-artwork-state="waiting"]')) image.removeAttribute('onload');
window.__imageResult = () => {
  // The emulator viewport is smaller than the desktop one. Visit every card
  // through the real scroll container rather than requiring offscreen downloads.
  const pending = document.querySelector('img[data-artwork-state="waiting"]');
  if (pending) pending.scrollIntoView({block:'center'});
  const images = ['poster-case','series-case','compact-case','search-case','landscape-case','logo-case','banner-case'].map(id=>document.querySelector('#'+id+' img'));
  return {
    states: Array.from(document.querySelectorAll('img'),i=>({state:i.dataset.artworkState,native:i.src.startsWith('data:image/jpeg;base64,'),width:i.getBoundingClientRect().width,height:i.getBoundingClientRect().height})),
    layout: ['poster-case','series-case','compact-case','search-case','landscape-case','missing-case'].every(id=>{
      const art=document.querySelector('#'+id+' .art'), r=art.getBoundingClientRect();
      const ratio=id==='landscape-case'?9/16:3/2;
      const img=art.querySelector('img'), ir=img && img.getBoundingClientRect();
      return r.width>=100 && Math.abs(r.height-r.width*ratio)<2 && (!img || (Math.abs(ir.width-r.width)<2 && Math.abs(ir.height-r.height)<2));
    }),
    loaded: images.every(i=>i && i.dataset.artworkState==='loaded' && i.complete && i.naturalWidth>0),
    native: images.every(i=>i && i.src.startsWith('data:image/jpeg;base64,')),
    missing: !document.querySelector('#missing-case img') && document.querySelector('#missing-case').textContent.includes('Unavailable artwork'),
  };
};
