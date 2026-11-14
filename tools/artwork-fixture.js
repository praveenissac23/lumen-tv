// Shared fixture for Chromium and the actual Android WebView bridge.
import { poster, logo, artworkImage } from '../web/src/ui.js';
const src = window.__imageBase + '/image';
document.body.innerHTML = '<div id="fixture" style="display:flex;gap:12px">' +
  '<div id="poster-case" style="width:180px;height:240px">' + poster({name:'Poster photo',img:src}) + '</div>' +
  '<div id="logo-case" style="width:180px;height:240px">' + logo({name:'Logo',logo:src}) + '</div>' +
  '<div id="banner-case" style="width:180px;height:240px">' + artworkImage(window.__imageBase+'/redirect',960,'banner') + '</div>' +
  '<div id="missing-case" style="width:180px;height:240px">' + poster({name:'Unavailable artwork',img:window.__imageBase+'/missing'}) + '</div></div>';
// Exercise boxes that never deliver the placeholder image load event. The
// insertion observer must discover both film and series artwork on its own.
for (const image of document.querySelectorAll('img[data-artwork-state="waiting"]')) image.removeAttribute('onload');
window.__imageResult = () => {
  const images = ['poster-case','logo-case','banner-case'].map(id=>document.querySelector('#'+id+' img'));
  return {
    loaded: images.every(i=>i && i.dataset.artworkState==='loaded' && i.complete && i.naturalWidth>0),
    native: images.every(i=>i && i.src.startsWith('data:image/jpeg;base64,')),
    missing: !document.querySelector('#missing-case img') && document.querySelector('#missing-case').textContent.includes('Unavailable artwork'),
  };
};
