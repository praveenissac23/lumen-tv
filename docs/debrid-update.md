# Debrid search update — implementation and validation

Baseline: `32ddaf40d7c6c869861ead88f886a32edc1fbce8` (main).
The unmodified web build matched the JavaScript in the supplied build 36 APK byte for byte.
Original APK SHA-256: `9cd34b93e2f53b77ef7055f483614704c7ced7b9285c4af880b4f2f3886bd6ce`.

## Changes

- Keep IPTV search selected by default, with independent debounced online title search.
- Cinemeta supplies film/series metadata; configure an HTTPS Stremio-compatible stream add-on in Settings > Debrid and torrents.
- Add Real-Debrid and AllDebrid API keys, validate accounts, choose preferred provider and quality.
- Keys live in a separate app-private cache file, never in source search requests. This uses the existing storage bridge; keys are not additionally encrypted by this feature.
- Show source quality and seed counts where the add-on supplies them. Deduplicate and sort direct links first, preferred quality next, then seeds. Direct links are not represented as verified cached/ready links. Availability is checked on selection.
- Resolve magnets via Debrid, select the requested episode or ask which file to play. Preparing torrents report their state without blocking navigation or polling indefinitely.
- Use existing film/series player settings and existing ADM/1DM download dispatch. No embedded torrent client or new runtime dependency.
- Continue/recent items reopen source selection to obtain a fresh playback URL.
- Keep focus on keyboard/tabs during background result updates; restore search/tab on Back; ignore late results after leaving.
- Preserve existing settings and respect parental PIN for online catalogue access.
- Correct later theme rules that overrode light-mode focus animations.
- Require original signing secrets and match the build 36 signing certificate before publishing.

## Local checks completed

- `npm test`: 18 deterministic service and DOM tests, including both Debrid API flows, episode selection, cancellation, errors, PIN access, stale-response handling, preserved preferences and player/download handoffs using mocked native interfaces.
- `npm run build`: passes. Bundled JavaScript ~250 KB versus ~225 KB at baseline; CSS ~4 KB larger. Development-only test dependencies are not included in the APK.
- Python browser test syntax compiles; workflow YAML parses; `git diff --check` passes.

## GitHub checks completed

The final branch candidate passed all checks in [build 40](https://github.com/praveenissac23/lumen-tv/actions/runs/43152566935): service/DOM tests, real Chromium navigation (including About remaining on screen), Android release compilation, APK signature verification, certificate match against build 36, package identity, newer version code, and APK size limits.

An earlier candidate was 1,382,600 bytes versus 1,373,363 bytes for build 36. No new runtime dependencies are bundled.

## Remaining practical validation

- Actual TV D-pad/Back/long-press checks, upgrade-in-place retention, VLC/MX playback and ADM/1DM downloads with a real subscription still require a device and account. Mocked tests do not verify provider account limits, region/network behaviour or real media playback.
- A source add-on must be configured by the user; no torrent index is bundled. HTTP(S) direct streams and v1 hexadecimal info hashes are supported. Streams requiring custom HTTP headers, external web pages, or unsupported hash formats are excluded.

The release workflow publishes only main-branch builds after all checks pass. The original uploaded APK remains unchanged. The same app ID and certificate allow the installed application's updater to install the newer version in place.


### Artwork bridge and Torrent PIN removal

Torrent browsing and source details open without a PIN, including when IPTV parental controls are enabled. IPTV parental settings are preserved.

The interface no longer requests the synthetic thumbnail hostname. Android downloads and resizes artwork off the UI thread and delivers JPEG data directly through its JavaScript bridge, with at most three image requests active. Images near the visible area load first. A fresh artwork cache bypasses old failed entries; direct original URLs remain a bounded fallback. Posters, channel logos and home banners share the same path.

Debrid review fixes explicit episode mismatches, missing AllDebrid file links, reconnect messages for invalid keys, and stale Back-navigation playback. Internet torrent discovery remains separate from account credentials. Both providers' API flows, cloud preparation, key errors and cancellation are covered by deterministic tests; subscribed live playback on the user's TV cannot be exercised here.

Release gates now include the shared artwork UI fixture in a real Android WebView. The test downloads a PNG from an isolated HTTP fixture, follows a redirect, decodes Android's returned JPEG data in WebView, r…4924 tokens truncated…oad'}]), openWith:(pkg,url,options)=>{calls.push({handoff:true,pkg,url,options:JSON.parse(options)});return true;},
  };
  if (imageHandler) w.Native.artwork = (id,url,width) => {
    calls.push({artwork:true,url,width});
    Promise.resolve().then(()=>imageHandler(url,width)).then(src=>{bodies.set(id,src);w.__nat('artwork',{id,ok:true});},()=>w.__nat('artwork',{id,ok:false,error:'unavailable'}));
  };
  if(engineHandler) {
    for(const method of ['torrentPrepare','torrentStart'])w.Native[method]=(id,...args)=>{
      calls.push({engine:method,args});Promise.resolve().then(()=>engineHandler(method,args)).then(result=>{bodies.set(id,JSON.stringify(result));w.__nat('call',{id,ok:true});},e=>w.__nat('call',{id,ok:false,error:e.message}));
    };
    w.Native.torrentCancel=()=>calls.push({engine:'cancel'});
  }
  w.eval(bundle); windows.push(w);
  const api = w.testAPI;
  return {...api, w, view:w.document.querySelector('#view'), disk, calls, app:{go(){}, back(){}, reload(){}, openVoice(){}}};
}
const delay = ms => new Promise(r=>setTimeout(r,ms));
after(()=>{windows.forEach(w=>w.close()); assert.deepEqual(runtimeErrors,[], 'No uncaught DOM errors');});

test('account keys are separate from existing IPTV state and invalid keys do not persist', async()=>{
 const x=setup(async()=>({username:'test'}),{favs:{movie:['f3']},settings:{playerMovie:'org.videolan.vlc',downloader:'com.dv.adm'}});
 await x.torrents.validateAccount('rd','TEST_TOKEN'); x.torrents.saveAccount('rd','TEST_TOKEN');
 assert.equal(x.torrents.accounts().rd.key,'TEST_TOKEN');
 assert.equal(x.store.setting('playerMovie'),'org.videolan.vlc');
 assert.equal(x.store.setting('downloader'),'com.dv.adm');
 assert.equal(JSON.parse(x.disk.get('state')).favs.movie[0],'f3');
 assert.ok(!x.disk.get('state').includes('TEST_TOKEN'));
 assert.equal(x.calls[0].headers.Authorization,'Bearer TEST_TOKEN');
 await assert.rejects(()=>x.torrents.validateAccount('rd','bad key'));
 x.torrents.saveAccount('rd',''); assert.equal(x.torrents.preferredProvider(),'');
});
test('source URL validation rejects unsafe protocols and catalogue-only add-ons',async()=>{
 const x=setup(async()=>({resources:['catalog']}));
 for(const url of ['http://example.org/manifest.json','javascript:alert(1)','https://u:p@host/manifest.json']) assert.throws(()=>x.torrents.sourceBase(url));
 assert.equal(x.torrents.sourceBase('stremio://example.org/config/manifest.json'),'https://example.org/config');
 await assert.rejects(()=>x.torrents.validateSource('https://example.org/manifest.json'));
});
test('source deduplication, preferred 1080p, seeds, and unsupported streams',()=>{
 const {torrents:t}=setup();
 const h='a'.repeat(40);
 const r=t.normaliseSources([{url:'https://a/video.mp4',name:'1080p'},{url:'https://a/video.mp4',name:'duplicate'},{infoHash:h,fileIdx:0,title:'1080p seeders: 4'},{infoHash:'b'.repeat(40),title:'1080p seeders: 400'},{infoHash:'c'.repeat(40),title:'2160p seeders: 9999'},{url:'javascript:alert(1)'},{externalUrl:'https://website'},{url:'https://headers/video',behaviorHints:{proxyHeaders:{request:{Cookie:'secret'}}}}]);
 assert.equal(r.length,4); assert.ok(r[0].url); assert.equal(r[1].seeds,400); assert.equal(r[3].quality,2160);
});
test('multi-file selection finds requested episode, rejects samples and respects cancellation', async()=>{
 const {torrents:t}=setup();
 const files=[{name:'sample.mkv'},{name:'Show.S01E01.mkv'},{name:'Show.S01E02.mkv'}];
 assert.equal((await t.chooseVideo(files,{}, {season:1,episode:2},()=>assert.fail('must not ask'))).name,'Show.S01E02.mkv');
 assert.equal((await t.chooseVideo(files,{fileIdx:1},null,()=>assert.fail())).name,'Show.S01E01.mkv');
 await assert.rejects(()=>t.chooseVideo(files,{},null,async()=>null),/Cancelled/);
});
test('Real-Debrid resolves selected file and keeps different episodes independent',async()=>{
 let added=0, selected=new Map();
 const x=setup(async(url,method,body)=>{
  const path=url.split('/rest/1.0/')[1];
  if(path==='torrents/addMagnet') return {id:String(++added)};
  if(path.startsWith('torrents/selectFiles/')) {selected.set(path.split('/').pop(),+new URLSearchParams(body).get('files')); return '';}
  if(path.startsWith('torrents/info/')) {const id=path.split('/').pop(), sel=selected.get(id); return {status:sel?'downloaded':'waiting_files_selection',files:[{id:1,path:'Show.S01E01.mkv',selected:sel===1?1:0},{id:2,path:'Show.S01E02.mkv',selected:sel===2?1:0}],links:sel?['https://rd/file'+sel]:[]};}
  if(path==='unrestrict/link') return {download:'https://cdn/video'+new URLSearchParams(body).get('link').slice(-1)+'.mkv'};
  throw Error('unexpected '+url);
 });
 x.torrents.saveAccount('rd','TEST'); const stream={hash:'a'.repeat(40),fileIdx:null};
 const a=await x.torrents.resolveSource(stream,'rd',{id:'tt1:1:1',season:1,episode:1},()=>assert.fail());
 const b=await x.torrents.resolveSource(stream,'rd',{id:'tt1:1:2',season:1,episode:2},()=>assert.fail());
 assert.match(a.url,/video1/); assert.match(b.url,/video2/); assert.equal(added,2);
});
test('AllDebrid nested file tree resolves correct episode and unlocks its link',async()=>{
 const x=setup(async(url,method,body)=>{
  if(url.endsWith('/magnet/upload')) return {status:'success',data:{magnets:[{id:7}]}};
  if(url.endsWith('/magnet/status')) return {status:'success',data:{magnets:{id:7,statusCode:4}}};
  if(url.endsWith('/magnet/files')) return {status:'success',data:{magnets:[{id:'7',files:[{n:'season',e:[{n:'Show.S02E01.mkv',l:'https://ad/one'},{n:'Show.S02E02.mkv',l:'https://ad/two'}]}]}]}};
  if(url.endsWith('/link/unlock')) { assert.equal(new URLSearchParams(body).get('link'),'https://ad/two'); return {status:'success',data:{link:'https://cdn/two.mkv'}}; }
  throw Error('unexpected');
 });
 x.torrents.saveAccount('ad','TEST');
 const r=await x.torrents.resolveSource({hash:'b'.repeat(40)},'ad',{id:'tt1:2:2',season:2,episode:2},()=>assert.fail());
 assert.equal(r.url,'https://cdn/two.mkv');
});
test('preparing source is not labelled playable, retries reuse cloud job',async()=>{
 let added=0;
 const x=setup(async(url)=>url.endsWith('/addMagnet')?{id:String(++added)}:{status:'downloading'});
 x.torrents.saveAccount('rd','TEST'); const source={hash:'d'.repeat(40)};
 for(let i=0;i<2;i++) await assert.rejects(()=>x.torrents.resolveSource(source,'rd',null,()=>{}),/Preparing/);
 assert.equal(added,1);
});
test('failed title provider does not prevent other title results and no account token leaks',async()=>{
 const x=setup(async(url)=>{ if(url.includes('/catalog/series/')) throw Error('offline'); return {metas:[{id:'tt100',name:'Test',poster:'https://image/poster.jpg'}]}; });
 x.torrents.saveAccount('rd','PRIVATE'); const titles=await x.torrents.findTitles('test');
 assert.equal(titles.length,1); assert.equal(titles[0].type,'movie'); assert.ok(x.calls.every(c=>!c.url.includes('PRIVATE')));
});
test('default IPTV tab and asynchronous torrent results preserve keyboard focus',async()=>{
 const x=setup(async()=>({metas:[{id:'tt100',name:'Test',poster:'https://image/poster.jpg'}]}),{settings:{lockAdult:false}});
 const s=new x.SearchScreen(x.view,{q:'test'},x.app);
 const key=x.view.querySelector('.key'); key.focus();
 await delay(600);
 assert.equal(s.tab,'lumen'); assert.equal(x.w.document.activeElement,key);
 assert.equal(s.titles.length,2); // a film and a series may share the same IMDb ID
 assert.equal(x.view.querySelector('.sr-lumen-pane').hidden,false);
 await s.switchTab('torrents'); assert.equal(x.view.querySelector('.sr-torrent-pane').hidden,false);
 assert.equal(x.w.document.activeElement.dataset.tab,'torrents');
 s.destroy();
});
test('rapid query changes are coalesced and old responses cannot overwrite new titles',async()=>{
 let resolveOld; const old=new Promise(r=>resolveOld=r);
 const x=setup(async(url)=>{ if(url.includes('search=old.')) return old; return {metas:[{id:'tt200',name:'New result'}]}; },{settings:{lockAdult:false}});
 const s=new x.SearchScreen(x.view,{q:'old'},x.app);
 await delay(470); s.q='new'; s.input.value='new'; s.paint(); await delay(470);
 assert.equal(x.calls.filter(c=>c.url.includes('/catalog/')).length,2);
 resolveOld({metas:[{id:'tt100',name:'Old result'}]}); await delay(550);
 assert.ok(s.titles.every(t=>t.name==='New result')); assert.equal(x.calls.filter(c=>c.url.includes('/catalog/')).length,4);
 s.destroy();
});
test('leaving search cancels pending timers and late results do not touch detached UI',async()=>{
 const x=setup(async()=>({metas:[]}),{settings:{lockAdult:false}});
 const s=new x.SearchScreen(x.view,{q:'test'},x.app); s.destroy(); x.view.innerHTML='Other screen';
 await delay(500); assert.equal(x.view.textContent,'Other screen'); assert.equal(x.calls.length,0);
});
test('torrents tab and direct detail open without PIN while IPTV parental settings stay intact',async()=>{
 const x=setup(async()=>({streams:[]}),{pin:'1234',settings:{lockAdult:true}});
 const s=new x.SearchScreen(x.view,{},x.app); await s.switchTab('torrents');
 assert.equal(s.tab,'torrents'); assert.equal(x.w.document.querySelector('.pin'),null); s.destroy();
 const d=new x.TorrentDetailScreen(x.view,{item:{id:'tt1',type:'movie',name:'Test'}},x.app);
 await delay(20); assert.equal(x.w.document.querySelector('.pin'),null); assert.ok(x.calls.some(c=>c.url.includes('/stream/movie/')));
 assert.equal(x.store.setting('lockAdult'),true); assert.equal(x.store.S.pin,'1234'); d.destroy();
});
test('explicitly disabled internet search keeps detail usable with a path to settings',async()=>{
 const x=setup(undefined,{settings:{lockAdult:false,internetTorrents:false}}); const d=new x.TorrentDetailScreen(x.view,{item:{id:'tt1',type:'movie',name:'Test'}},x.app);
 await delay(10); assert.match(x.view.querySelector('#td-list').textContent,/Internet torrent search is switched off/); assert.equal(x.view.querySelector('#td-play'),null); d.destroy();
});
test('Debrid settings render saved state without exposing API keys',()=>{
 const x=setup(); x.torrents.saveAccount('rd','PRIVATE_TOKEN');
 new x.SettingsScreen(x.view,{restore:{sec:'debrid'}},x.app);
 assert.match(x.view.textContent,/Key saved/); assert.ok(!x.view.innerHTML.includes('PRIVATE_TOKEN'));
});

for (const [player, downloader] of [['org.videolan.vlc','idm.internet.download.manager'],['com.mxtech.videoplayer.ad','com.dv.adm']]) {
 test(`movie source uses existing ${player} and ${downloader} preferences`,async()=>{
  const x=setup(async()=>({streams:[{name:'1080p',url:'https://cdn.test/film.mp4'}]}),{settings:{lockAdult:false,playerMovie:player,downloader,torrentSource:'https://source.test'}});
  const d=new x.TorrentDetailScreen(x.view,{item:{id:'tt1',type:'movie',name:'Film'}},x.app);
  await delay(20); await d.launch(false);
  let h=x.calls.filter(c=>c.handoff).at(-1); assert.equal(h.pkg,player); assert.equal(h.options.mode,'play'); assert.equal(h.url,'https://cdn.test/film.mp4');
  await d.launch(true); h=x.calls.filter(c=>c.handoff).at(-1); assert.equal(h.pkg,downloader); assert.equal(h.options.mode,'download');
  assert.equal(x.store.S.recentVod[0].torrentItem.id,'tt1'); d.destroy();
 });
}
test('series source uses the series player setting and restores episode choice',async()=>{
 const x=setup(async(url)=>url.includes('/meta/')?{meta:{videos:[{id:'tt1:1:2',season:1,episode:2,title:'Second'}]}}:{streams:[{url:'https://cdn/episode.mkv'}]}, {settings:{lockAdult:false,playerMovie:'org.videolan.vlc',playerSeries:'com.mxtech.videoplayer.ad',torrentSource:'https://source.test'}});
 const episode={id:'tt1:1:2',season:1,episode:2};
 const d=new x.TorrentDetailScreen(x.view,{item:{id:'tt1',type:'series',name:'Series'},restore:{episode}},x.app);
 await delay(20); await d.launch(false);
 assert.equal(x.calls.find(c=>c.handoff).pkg,'com.mxtech.videoplayer.ad');
 assert.equal(d.save().episode.id,episode.id);
 assert.equal(d.onKey('back'),true); assert.equal(d.phase,'episodes'); assert.equal(d.episode,null); d.destroy();
});
test('invalid API response is surfaced and cannot launch a player',async()=>{
 const x=setup(async()=>({error:'bad_token'})); x.torrents.saveAccount('rd','INVALID');
 await assert.rejects(()=>x.torrents.resolveSource({hash:'e'.repeat(40)},'rd',null,()=>{}),/key is invalid or expired/);
 assert.equal(x.calls.filter(c=>c.handoff).length,0);
});

test('older bridges use original image URLs without the failing thumbnail hostname',()=>{
 const x=setup(); x.view.innerHTML=x.ui.poster({name:'Real poster',img:'https://images.test/poster.jpg'});
 const img=x.view.querySelector('img'); assert.equal(img.src,'https://images.test/poster.jpg');
 x.w.__lumenImageError(img); assert.equal(x.view.querySelector('img'),null); assert.match(x.view.textContent,/Real poster/);
 assert.equal(x.ui.directImageUrl('https://image.tmdb.org/t/p/original/p.jpg',320),'https://image.tmdb.org/t/p/w342/p.jpg');
 assert.equal(x.ui.directImageUrl('//images.test/p.jpg',320),'https://images.test/p.jpg');
});
test('new native artwork route sends JPEG data to posters, logos and banners, deduplicating requests',async()=>{
 const data='data:image/jpeg;base64,TEST'; const x=setup(undefined,{},async()=>{await delay(10);return data;});
 x.view.innerHTML=x.ui.poster({name:'Film',img:'https://images.test/p.jpg'})+x.ui.artworkImage('https://images.test/p.jpg',320,'duplicate')+x.ui.logo({name:'Channel',logo:'https://images.test/logo.png'});
 for(const img of x.view.querySelectorAll('img')) x.w.__lumenLoadImage(img);
 await delay(30);
 assert.equal(x.calls.filter(c=>c.artwork).length,2);
 for(const img of x.view.querySelectorAll('img')) {assert.equal(img.src,data);img.onload();assert.equal(img.dataset.artworkState,'loaded');}
});
test('native artwork failures use direct images once and limit concurrency to three',async()=>{
 let active=0,max=0;
 const x=setup(undefined,{},async()=>{max=Math.max(max,++active);await delay(10);--active;throw Error('offline');});
 x.view.innerHTML=Array.from({length:8},(_,i)=>x.ui.artworkImage('https://images.test/'+i+'.jpg',320)).join('');
 for(const img of x.view.querySelectorAll('img')) x.w.__lumenLoadImage(img);
 await delay(80); assert.equal(max,3);
 for(const img of [...x.view.querySelectorAll('img')]) {assert.equal(img.src,img.dataset.original);x.w.__lumenImageError(img);}
 assert.equal(x.view.querySelectorAll('img').length,0);
});
test('detached images are never populated by late artwork responses',async()=>{
 const x=setup(undefined,{},async()=>{await delay(15);return 'data:image/jpeg;base64,TEST';});
 x.view.innerHTML=x.ui.artworkImage('https://images.test/a.jpg',320);const img=x.view.querySelector('img'); x.w.__lumenLoadImage(img);img.remove();
 await delay(30);assert.match(img.src,/svg/);
});
test('wrong explicit episode cannot override requested episode through a file index',async()=>{
 const {torrents:t}=setup();const files=[{name:'Show.S01E01.mkv'},{name:'Show.S01E02.mkv'}];
 assert.equal((await t.chooseVideo(files,{fileIdx:0},{season:1,episode:2},()=>assert.fail())).name,'Show.S01E02.mkv');
 await assert.rejects(()=>t.chooseVideo(files.slice(0,1),{fileIdx:0},{season:1,episode:2},()=>assert.fail()),/requested episode was not found/);
});
for(const [provider,response] of [['rd',{error:'bad',error_code:8}],['ad',{status:'error',error:{code:'AUTH_BAD_APIKEY'}}]]) {
 test(provider+' expired key gives a safe reconnect message',async()=>{
  const x=setup(async()=>response);x.torrents.saveAccount(provider,'PRIVATE_KEY');
  await assert.rejects(()=>x.torrents.resolveSource({hash:'e'.repeat(40)},provider,null,()=>{}),e=>/Reconnect/.test(e.message)&&!e.message.includes('PRIVATE_KEY'));
 });
}
test('AllDebrid preparing jobs are reused and do not return playback links',async()=>{
 let uploads=0;const x=setup(async(url)=>url.endsWith('/upload')?(++uploads,{status:'success',data:{magnets:[{id:8}]}}):{status:'success',data:{magnets:{id:8,statusCode:1}}});x.torrents.saveAccount('ad','TEST');
 for(let i=0;i<2;i++)await assert.rejects(()=>x.torrents.resolveSource({hash:'f'.repeat(40)},'ad',null,()=>{}),/Preparing in AllDebrid/);
 assert.equal(uploads,1);
});
test('Back during a Debrid request prevents late player handoff and permits next episode',async()=>{
 let release;
 const x=setup(async(url)=>url.includes('/meta/')?{meta:{videos:[{id:'tt1:1:1',season:1,episode:1}]}}:url.includes('/stream/')?{streams:[{infoHash:'a'.repeat(40)}]}:url.endsWith('/addMagnet')?{id:'1'}:new Promise(r=>{release=r;}),{settings:{playerSeries:'org.videolan.vlc'}});
 x.torrents.saveAccount('rd','TEST');const episode={id:'tt1:1:1',season:1,episode:1};
 const d=new x.TorrentDetailScreen(x.view,{item:{id:'tt1',type:'series',name:'Series'},restore:{episode}},x.app);
 await delay(20);const pending=d.launch(false);await delay(10);d.onKey('back');assert.equal(d.busy,false);
 release({status:'downloaded',files:[{id:1,path:'Show.S01E01.mkv',selected:1}],links:['https://rd/file']});await pending;
 assert.equal(x.calls.filter(c=>c.handoff).length,0);assert.equal(d.phase,'episodes');d.destroy();
});

test('internet torrent indexes are searched without a Debrid account or custom add-on',async()=>{
 const x=setup(async()=>({streams:[{name:'1080p',infoHash:'a'.repeat(40),title:'seeders: 99'}]}));
 const sources=await x.torrents.findSources('movie','tt1254207');
 assert.equal(sources.length,1); assert.equal(sources[0].sourceType,'internet'); assert.equal(sources[0].hash,'a'.repeat(40));
 assert.match(x.calls[0].url,/^https:\/\/torrentio.strem.fun\/stream\/movie\/tt1254207.json$/);
 assert.equal(x.calls.filter(c=>c.headers?.Authorization).length,0); assert.equal(x.torrents.preferredProvider(),'');
});
test('a Debrid-cloud add-on cannot replace or restrict the independent internet search',async()=>{
 const x=setup(async(url)=>url.startsWith('https://torrentio.strem.fun')?{streams:[{name:'1080p',infoHash:'b'.repeat(40)}]}:{streams:[{url:'https://cloud.test/video.mp4',name:'1080p'}]}, {settings:{torrentSource:'https://cloud-addon.test',torrentSourceName:'Cloud addon'}});
 x.torrents.saveAccount('rd','PRIVATE_TOKEN');
 const sources=await x.torrents.findSources('movie','tt1');
 assert.equal(sources.length,2); assert.equal(sources[0].sourceType,'custom'); assert.equal(sources[1].sourceType,'internet');
 assert.equal(x.calls.filter(c=>c.url.includes('/stream/movie/')).length,2);
 assert.ok(x.calls.every(c=>!c.url.includes('PRIVATE_TOKEN')&&!c.headers?.Authorization));
});
test('provider outages are explicit and do not hide working internet torrents',async()=>{
 const x=setup(async(url)=>{if(url.startsWith('https://cloud-addon.test')) throw Error('offline');return {streams:[{infoHash:'c'.repeat(40)}]};},{settings:{torrentSource:'https://cloud-addon.test',torrentSourceName:'Cloud addon'}});
 const sources=await x.torrents.findSources('series','tt1:1:2');
 assert.equal(sources.length,1); assert.equal(sources.sourceErrors[0],'Cloud addon'); assert.match(sources.sourceSummary,/1 internet torrents/);
});
test('internet outage is visible even when a custom cloud provider still works',async()=>{
 const x=setup(async(url)=>{if(url.startsWith('https://torrentio.strem.fun'))throw Error('offline');return {streams:[{url:'https://cloud/video.mp4'}]};},{settings:{torrentSource:'https://cloud-addon.test'}});
 const sources=await x.torrents.findSources('movie','tt1'); assert.match(sources.sourceSummary,/Unavailable: Internet/); assert.equal(sources[0].sourceType,'custom');
});
test('internet search can be disabled explicitly without losing a custom provider',async()=>{
 const x=setup(async()=>({streams:[]}),{settings:{internetTorrents:false,torrentSource:'https://custom.test'}});
 await x.torrents.findSources('movie','tt1'); assert.equal(x.calls.length,1); assert.ok(x.calls[0].url.startsWith('https://custom.test/'));
});
test('ranking happens before limiting a large internet response to 150 TV rows',()=>{
 const x=setup(); const streams=[];
 for(let i=0;i<200;i++)streams.push({infoHash:i.toString(16).padStart(40,'0'),name:'2160p',_lumenScope:'internet'});
 streams.push({infoHash:'f'.repeat(40),name:'1080p',_lumenScope:'internet'});
 const sources=x.torrents.normaliseSources(streams); assert.equal(sources.length,150); assert.equal(sources[0].quality,1080);
});

for(const [code,message] of [[10,/account verification/],[11,/account verification/],[9,/denied account access/],[20,/subscription is required/]]) {
 test('Real-Debrid error '+code+' uses documented account feedback',async()=>{
  const x=setup(async()=>({error:'provider error',error_code:code}));x.torrents.saveAccount('rd','TEST');
  await assert.rejects(()=>x.torrents.resolveSource({hash:'a'.repeat(40)},'rd',null,()=>{}),message);
 });
}

for(const provider of ['rd','ad']) test(provider+' source OK resolves through Debrid and opens VLC once without pressing Play',async()=>{
 const x=setup(async(url)=>{
  if(url.includes('/stream/'))return {streams:[{infoHash:'b'.repeat(40),title:'1080p seeders: 30'}]};
  if(url.includes('/torrents?'))return [{id:8,hash:'b'.repeat(40),status:'downloaded'}];
  if(url.endsWith('/addMagnet'))throw Error('Unexpected upload');
  if(url.includes('/torrents/info/'))return {status:'downloaded',files:[{id:1,path:'Film.mkv',selected:1}],links:['https://rd.test/link']};
  if(url.endsWith('/unrestrict/link'))return {download:'https://cdn.test/rd.mkv'};
  if(url.endsWith('/magnet/upload'))return {status:'success',data:{magnets:[{id:8}]}};
  if(url.endsWith('/magnet/status'))return {status:'success',data:{magnets:{id:8,statusCode:4,hash:'b'.repeat(40)}}};
  if(url.endsWith('/magnet/files'))return {status:'success',data:{magnets:[{id:8,files:[{n:'Film.mkv',l:'https://ad.test/link'}]}]}};
  if(url.endsWith('/link/unlock'))return {status:'success',data:{link:'https://cdn.test/ad.mkv'}};
  throw Error('Unexpected endpoint');
 },{settings:{playerMovie:'org.videolan.vlc'}});
 x.torrents.saveAccount(provider,'TEST');
 const d=new x.TorrentDetailScreen(x.view,{item:{id:'tt1',type:'movie',name:'Film'}},x.app);
 await delay(20);const row=x.view.querySelector('[data-source="0"]');row.focus();
 assert.ok(row.classList.contains('td-debrid'));assert.match(row.textContent,provider==='rd'?/Real-Debrid/:/AllDebrid/);assert.match(row.textContent,/OK · Source options/);
 assert.equal(d.onKey('ok'),true);assert.match(x.w.document.querySelector('.sheet').textContent,/Play in VLC/);assert.equal(x.calls.filter(c=>c.handoff).length,0);x.w.document.querySelector('.sheet-item').click();await delay(20);
 const handoffs=x.calls.filter(c=>c.handoff);assert.equal(handoffs.length,1);assert.equal(handoffs[0].pkg,'org.videolan.vlc');assert.equal(handoffs[0].url,'https://cdn.test/'+provider+'.mkv');d.destroy();
});
test('source click opens its own actions; floating play/download/account controls are absent',async()=>{
 const x=setup(async()=>({streams:[{url:'https://cdn.test/first.mp4'},{url:'https://cdn.test/second.mp4'}]}),{settings:{playerMovie:'org.videolan.vlc'}});
 const d=new x.TorrentDetailScreen(x.view,{item:{id:'tt1',type:'movie',name:'Film'}},x.app);await delay(20);
 const row=x.view.querySelector('[data-source="1"]');row.querySelector('b').click();await delay(10);
 assert.equal(x.calls.filter(c=>c.handoff).length,0);assert.match(x.w.document.querySelector('.sheet h2').textContent,/Source 2/);
 x.w.document.querySelector('.sheet-item').click();await delay(10);assert.equal(x.calls.find(c=>c.handoff).url,'https://cdn.test/second.mp4');
 assert.equal(x.view.querySelectorAll('#td-play,#td-download,#td-provider').length,0);d.destroy();
});
test('Debrid badges update when account changes and known direct links show provider clearly',async()=>{
 const x=setup(async()=>({streams:[{infoHash:'c'.repeat(40)},{url:'https://download.real-debrid.com/video.mkv'}]}));x.torrents.saveAccount('rd','TEST');x.torrents.saveAccount('ad','TEST');
 const d=new x.TorrentDetailScreen(x.view,{item:{id:'tt1',type:'movie',name:'Film'}},x.app);await delay(20);
 d.provider='ad';d.refreshRoutes();const routes=[...x.view.querySelectorAll('[data-route]')].map(n=>n.textContent);
 assert.ok(routes.includes('External torrent')); assert.equal(x.view.querySelectorAll('.td-debrid').length,0);assert.ok(routes.includes('Real-Debrid link'));
 assert.equal(d.sourceProvider({url:'https://real-debrid.com.evil.test/video',text:''}),'');d.destroy();
});

test('direct add-on streams marked Torrentio RD+ or AD+ keep clear Debrid badges',async()=>{
 const x=setup(async()=>({streams:[{name:'Torrentio RD+ 1080p',url:'https://addon.test/rd'},{name:'Torrentio AD+ 1080p',url:'https://addon.test/ad'}]}));
 const d=new x.TorrentDetailScreen(x.view,{item:{id:'tt1',type:'movie',name:'Film'}},x.app);await delay(20);
 const badges=[...x.view.querySelectorAll('[data-route]')].map(n=>n.textContent);
 assert.ok(badges.includes('Real-Debrid link'));assert.ok(badges.includes('AllDebrid link'));assert.equal(x.view.querySelectorAll('.td-debrid').length,0);d.destroy();
});

test('normal click on an uncached magnet never uploads and opens only an external torrent handler',async()=>{
 const x=setup(async url=>url.includes('/stream/')?{streams:[{infoHash:'a'.repeat(40)}]}:{status:'success',data:{magnets:[]}});
 x.torrents.saveAccount('ad','TEST');const d=new x.TorrentDetailScreen(x.view,{item:{id:'tt1',type:'movie',name:'Film'}},x.app);await delay(20);await d.launch(false);
 assert.ok(x.calls.every(c=>!c.url.includes('/upload')&&!c.url.includes('/addMagnet')));
 const handoff=x.calls.find(c=>c.handoff);assert.equal(handoff.options.mode,'magnet');assert.match(handoff.url,/^magnet:/);assert.equal(handoff.pkg,'');
 assert.equal(x.view.querySelectorAll('.td-debrid').length,0);d.destroy();
});
test('verified AllDebrid availability highlights only the matching ready hash, never a downloading one',async()=>{
 const x=setup(async url=>url.includes('/stream/')?{streams:[{infoHash:'a'.repeat(40)},{infoHash:'b'.repeat(40)}]}:{status:'success',data:{magnets:[{id:1,hash:'a'.repeat(40),statusCode:4},{id:2,hash:'b'.repeat(40),statusCode:1}]}});
 x.torrents.saveAccount('ad','TEST');const d=new x.TorrentDetailScreen(x.view,{item:{id:'tt1',type:'movie',name:'Film'}},x.app);await delay(30);
 assert.equal(x.view.querySelectorAll('.td-debrid').length,1);assert.match(x.view.querySelector('.td-debrid').textContent,/Ready in AllDebrid/);
 assert.ok(x.calls.every(c=>!c.url.includes('/upload')));d.destroy();
});
test('availability errors stay unknown and do not stop external playback or turn badges green',async()=>{
 const x=setup(async()=>{throw Error('offline')});x.torrents.saveAccount('ad','TEST');
 const r=await x.torrents.readySources([{hash:'c'.repeat(40)}]);assert.equal(r.found.size,0);assert.equal(r.errors[0],'AllDebrid');
 const playback=await x.torrents.resolvePlayable({hash:'c'.repeat(40)},'ad',null,()=>{});assert.equal(playback.magnet,true);
 assert.ok(x.calls.every(c=>!c.url.includes('/upload')));
});
test('TorrServer streams the correct episode to VLC without any Debrid upload',async()=>{
 const x=setup(async url=>url.includes('/stream?')?{file_stats:[{id:1,path:'Show.S01E01.mkv',length:10},{id:2,path:'Show.S01E02.mkv',length:20}]}:{streams:[{infoHash:'d'.repeat(40),fileIdx:0}]},{settings:{torrentServer:'http://192.168.1.5:8090',playerSeries:'org.videolan.vlc'}});
 const result=await x.torrents.resolvePlayable({hash:'d'.repeat(40),fileIdx:0},'',{id:'tt1:1:2',season:1,episode:2},()=>assert.fail());
 assert.match(result.url,/^http:\/\/192.168.1.5:8090\/stream\?/);assert.equal(new URL(result.url).searchParams.get('index'),'2');assert.ok(new URL(result.url).searchParams.has('play'));
 assert.ok(x.calls.every(c=>!c.url.includes('alldebrid')&&!c.url.includes('real-debrid')));
 for(const bad of ['javascript:alert(1)','https://user:pass@host','http://host/?token=x'])assert.throws(()=>x.torrents.torrentServerBase(bad));
});
test('long-press opens options without playing or uploading; explicit upload is a separate action',async()=>{
 const x=setup(async(url)=>url.includes('/stream/')?{streams:[{infoHash:'e'.repeat(40)}]}:url.endsWith('/upload')?{status:'success',data:{magnets:[{id:8}]}}:{status:'success',data:{magnets:{id:8,statusCode:1}}});x.torrents.saveAccount('ad','TEST');
 const d=new x.TorrentDetailScreen(x.view,{item:{id:'tt1',type:'movie',name:'Film'}},x.app);await delay(20);x.view.querySelector('[data-source]').focus();assert.equal(d.onKey('hold'),true);
 assert.match(x.w.document.querySelector('.sheet').textContent,/Upload to AllDebrid/);assert.match(x.w.document.querySelector('.sheet').textContent,/Open with another player/);assert.equal(x.calls.filter(c=>c.handoff).length,0);assert.ok(x.calls.every(c=>!c.url.endsWith('/upload')));
 [...x.w.document.querySelectorAll('.sheet-item')].find(n=>n.textContent.includes('Upload to AllDebrid')).click();await delay(30);
 assert.equal(x.calls.filter(c=>c.url.endsWith('/upload')).length,1);assert.equal(x.calls.filter(c=>c.handoff).length,0);d.destroy();
});
test('search Down reaches every suggestion and Up returns to the keyboard without escaping',async()=>{
 const x=setup();const s=new x.SearchScreen(x.view,{},x.app);
 x.view.querySelector('#sr-sugg').innerHTML=[1,2,3,4].map(i=>'<button class="f sugg" data-q="Spiderman '+i+'">Spiderman '+i+'</button>').join('');
 x.view.querySelector('.kb .key:last-child').focus();assert.equal(s.onKey('down'),true);assert.equal(x.w.document.activeElement.id,'sr-dictate');s.onKey('down');
 for(let i=0;i<4;i++){assert.equal(x.w.document.activeElement.dataset.q,'Spiderman '+(i+1));s.onKey('down');}
 assert.equal(x.w.document.activeElement.dataset.q,'Spiderman 4');for(let i=0;i<4;i++)s.onKey('up');assert.equal(x.w.document.activeElement.id,'sr-dictate');s.destroy();
});

test('uncached Debrid add-on resolver URLs are never opened as direct playback',()=>{
 const {torrents:t}=setup();const hash='a'.repeat(40);
 const sources=t.normaliseSources([{name:'Torrentio AD download 1080p',url:'https://addon.test/alldebrid/PRIVATE/'+hash+'/film/0'}]);
 assert.equal(sources.length,1);assert.equal(sources[0].url,'');assert.equal(sources[0].hash,hash);
});

test('a stalled Debrid availability check cannot hold up external playback indefinitely',async()=>{
 const x=setup(async()=>new Promise(()=>{}));x.torrents.saveAccount('ad','TEST');const started=Date.now();
 const result=await x.torrents.resolvePlayable({hash:'f'.repeat(40)},'ad',null,()=>{});
 assert.equal(result.magnet,true);assert.ok(Date.now()-started<2000);assert.ok(x.calls.every(c=>!c.url.includes('/upload')));
});

test('a stale ready badge falls back to external playback instead of starting cloud preparation',async()=>{
 const x=setup(async(url,method,body)=>({status:'success',data:{magnets:new URLSearchParams(body).get('status')==='ready'?[{id:7,hash:'a'.repeat(40),statusCode:4}]:{id:7,statusCode:1}}}));x.torrents.saveAccount('ad','TEST');
 const source={hash:'a'.repeat(40),readyProviders:[{provider:'ad',id:7}]};
 const result=await x.torrents.resolvePlayable(source,'ad',null,()=>{});assert.equal(result.magnet,true);assert.equal(source.readyProviders.length,0);
 assert.ok(x.calls.every(c=>!c.url.includes('/upload')));
});

test('cancelling the nested downloader chooser returns focus to the selected source',async()=>{
 const x=setup(async()=>({streams:[{url:'https://cdn.test/film.mp4'}]}));const d=new x.TorrentDetailScreen(x.view,{item:{id:'tt1',type:'movie',name:'Film'}},x.app);await delay(20);
 const row=x.view.querySelector('[data-source]');row.focus();d.onKey('hold');
 [...x.w.document.querySelectorAll('.sheet-item')].find(n=>n.textContent.includes('Download using')).click();await delay(10);
 assert.match(x.w.document.querySelector('.sheet').textContent,/1DM/);
 x.nav.topLayer().onKey('back');await delay(10);assert.equal(x.w.document.activeElement,row);assert.equal(x.calls.filter(c=>c.handoff).length,0);d.destroy();
});

test('Down from the last number row does not skip Space, Delete and Clear',()=>{
 const x=setup();const s=new x.SearchScreen(x.view,{},x.app);x.view.querySelectorAll('.kb .key')[30].focus();assert.equal(s.onKey('down'),false);s.destroy();
});

test('raw torrent Play in VLC uses the built-in engine and never opens a magnet chooser',async()=>{
 const hash='a'.repeat(40);
 const x=setup(async()=>({streams:[{infoHash:hash,fileIdx:0}]}),{},null,async(method,args)=>method==='torrentPrepare'?{hash,files:[{id:0,name:'Film.mp4',size:1000}]}:{url:'http://127.0.0.1:12345/stream/test',file:'Film.mp4',size:1000});
 const d=new x.TorrentDetailScreen(x.view,{item:{id:'tt1',type:'movie',name:'Film'}},x.app);await delay(20);x.view.querySelector('[data-source]').focus();d.onKey('ok');
 assert.equal(x.calls.filter(c=>c.engine).length,0);x.w.document.querySelector('.sheet-item').click();await delay(30);
 assert.equal(x.calls.filter(c=>c.engine==='torrentPrepare').length,1);assert.equal(x.calls.filter(c=>c.engine==='torrentStart').length,1);
 const handoff=x.calls.find(c=>c.handoff);assert.equal(handoff.pkg,'org.videolan.vlc');assert.equal(handoff.options.mode,'play');assert.match(handoff.url,/^http:\/\/127.0.0.1:/);assert.ok(x.calls.every(c=>!c.url?.includes('/upload')));d.destroy();
});
test('built-in torrent engine chooses the requested episode instead of the first pack file',async()=>{
 const hash='b'.repeat(40);const x=setup(undefined,{},null,async(method,args)=>{
  if(method==='torrentPrepare')return {hash,files:[{id:0,name:'Show.S01E01.mkv'},{id:1,name:'Show.S01E02.mkv'}]};
  assert.equal(args[1],1);return {url:'http://127.0.0.1:12345/video',file:'Show.S01E02.mkv'};
 });
 const result=await x.torrents.resolvePlayable({hash,fileIdx:0},'',{season:1,episode:2},()=>assert.fail());assert.match(result.url,/127.0.0.1/);
});
