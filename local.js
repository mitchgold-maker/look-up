// Look Up for any location. Builds tonight's report in the browser from primary sources:
// Open-Meteo (ECMWF, GFS and ICON weather models), NOAA SWPC (Kp forecast and aurora nowcast),
// Astronomy Engine (Sun, Moon, planets, eclipses) and the IMO meteor shower list.
// The chosen place stays in this browser; nothing is sent anywhere except the rounded coordinates
// in the public data requests themselves.
const LU=(()=>{
  const KEY='lookup.place',CACHE='lookup.cache.v1',TTL=30*60e3;
  const AE_URL='https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/astronomy.browser.min.js',AE_SRI='sha384-LTVHvxfbG3XHla4Lu0C0s9U18B2sBOuzJIeOoVHm2t05SOOORvMbBMEVjXrGau9g';
  const MODELS=[['ecmwf_ifs025','ECMWF'],['gfs_seamless','GFS'],['icon_seamless','ICON']];
  const LINK={om:'https://open-meteo.com/',kp:'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json',ov:'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast',ae:'https://github.com/cosinekitty/astronomy',imo:'https://www.imo.net/resources/calendar/'};
  // IMO working list: typical peak date, ZHR, speed (km/s), radiant RA/Dec (degrees), parent body.
  const SHOWERS=[['Quadrantids',1,3,80,41,230,49,'asteroid 2003 EH1'],['Lyrids',4,22,18,49,271,34,'Comet Thatcher'],['Eta Aquariids',5,6,50,66,338,-1,'Comet Halley'],
    ['Southern Delta Aquariids',7,30,25,41,340,-16,'Comet 96P/Machholz'],['Perseids',8,12,100,59,48,58,'Comet Swift–Tuttle'],['Draconids',10,8,10,20,262,54,'Comet 21P/Giacobini–Zinner'],
    ['Orionids',10,21,20,66,95,16,'Comet Halley'],['Northern Taurids',11,12,5,29,58,22,'Comet 2P/Encke'],['Leonids',11,17,15,71,152,22,'Comet 55P/Tempel–Tuttle'],
    ['Geminids',12,14,150,35,112,33,'asteroid 3200 Phaethon'],['Ursids',12,22,10,33,217,76,'Comet 8P/Tuttle']];
  const D=Math.PI/180,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),r1=v=>Math.round(v*10)/10;
  const lvl=c=>c>=65?0:c>=40?1:c>=20?2:3,dirs=['N','NE','E','SE','S','SW','W','NW'],dir=a=>dirs[Math.round(((a%360)+360)%360/45)%8];

  // ---- saved place
  function current(){
    const q=new URLSearchParams(location.search),la=+q.get('lat'),lo=+q.get('lon');
    if(q.has('lat')&&q.has('lon')&&isFinite(la)&&isFinite(lo)&&Math.abs(la)<=90&&Math.abs(lo)<=180)return{name:q.get('name')||`${la.toFixed(2)}, ${lo.toFixed(2)}`,lat:la,lon:lo,cc:q.get('cc')||''};
    try{const p=JSON.parse(localStorage.getItem(KEY)||'null');return p&&isFinite(p.lat)&&isFinite(p.lon)?p:null}catch(e){return null}}
  function save(p){try{p?localStorage.setItem(KEY,JSON.stringify(p)):localStorage.removeItem(KEY);localStorage.removeItem(CACHE)}catch(e){}}
  const go=()=>{location.href=location.pathname};

  // ---- network helpers: every request has a timeout and reports which source failed
  async function getJSON(url,ms=12000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
    try{const r=await fetch(url,{signal:c.signal,cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(t)}}
  let aeP=null;
  function loadAE(){if(window.Astronomy)return Promise.resolve();return aeP||(aeP=new Promise((ok,no)=>{const s=document.createElement('script');s.src=AE_URL;s.integrity=AE_SRI;s.crossOrigin='anonymous';s.onload=ok;s.onerror=()=>{aeP=null;no(new Error('astronomy library'))};document.head.append(s)}))}

  // ---- search and reverse geocoding
  async function search(q){const j=await getJSON('https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name='+encodeURIComponent(q),8000);
    return (j.results||[]).map(x=>({name:[x.name,x.admin1,x.country].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(', '),lat:x.latitude,lon:x.longitude,cc:x.country_code||''}))}
  async function here(){const pos=await new Promise((ok,no)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(ok,no,{timeout:10000,maximumAge:6e5}):no(new Error('no geolocation')));
    const la=Math.round(pos.coords.latitude*100)/100,lo=Math.round(pos.coords.longitude*100)/100;let name=`${la}, ${lo}`,cc='';
    try{const j=await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${la}&longitude=${lo}&localityLanguage=en`,8000);name=[j.city||j.locality,j.principalSubdivision,j.countryName].filter(Boolean).join(', ')||name;cc=j.countryCode||''}catch(e){}
    return{name,lat:la,lon:lo,cc}}

  // ---- astronomy helpers (Astronomy Engine)
  function altaz(body,date,obs){const A=window.Astronomy,e=A.Equator(body,date,obs,true,true),h=A.Horizon(date,obs,e.ra,e.dec,'normal');return{alt:h.altitude,az:h.azimuth}}
  function radAlt(ra,dec,date,obs){const A=window.Astronomy,h=A.Horizon(date,obs,ra/15,dec,'normal');return{alt:h.altitude,az:h.azimuth}}
  // geomagnetic latitude from the IGRF dipole (north geomagnetic pole near 80.8N, 72.7W)
  const magLat=(la,lo)=>Math.asin(Math.sin(la*D)*Math.sin(80.8*D)+Math.cos(la*D)*Math.cos(80.8*D)*Math.cos((lo+72.7)*D))/D;

  // ---- build tonight's report for a place
  async function build(place,shared){
    try{const c=JSON.parse(localStorage.getItem(CACHE)||'null');if(c&&c.key===place.lat+','+place.lon&&Date.now()-c.at<TTL&&c.report){TZ=c.report.tz||TZ;return c.report}}catch(e){}
    const la=Math.round(place.lat*100)/100,lo=Math.round(place.lon*100)/100,fails=[];
    const vars='cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,temperature_2m,dew_point_2m,relative_humidity_2m,wind_speed_10m,precipitation_probability,snowfall,visibility';
    const omURL=`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&hourly=${vars}&daily=sunrise,sunset&timezone=auto&past_days=1&forecast_days=3`;
    const mmURL=`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&hourly=cloud_cover&models=${MODELS.map(m=>m[0]).join(',')}&timezone=auto&past_days=1&forecast_days=3`;
    const [wx,mm,kp]=await Promise.all([getJSON(omURL),getJSON(mmURL).catch(()=>{fails.push('Model comparison');return null}),getJSON(LINK.kp).catch(()=>{fails.push('NOAA Kp forecast');return null}),loadAE()]);
    // the weather is the one thing we cannot rate without: if it failed, getJSON already threw
    TZ=wx.timezone||'UTC';const off=wx.utc_offset_seconds||0,ep=s=>Date.parse(s+'Z')-off*1000;
    const A=window.Astronomy,obs=new A.Observer(la,lo,wx.elevation||0),H=wx.hourly,T=H.time.map(ep),now=Date.now();
    const imperial=['US','LR','MM'].includes((place.cc||'').toUpperCase());
    const tC=c=>imperial?Math.round(c*9/5+32)+'°F':Math.round(c)+'°C',spd=k=>imperial?Math.round(k/1.609)+' mph':Math.round(k)+' km/h';
    const clock=d=>new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'numeric',minute:'2-digit'}).format(d);
    const hr=d=>new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'numeric'}).format(d);
    const dateOf=d=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ}).format(d);

    // tonight = the night still ahead (or under way): sunset of the evening through the next sunrise
    const ss=wx.daily.sunset.map(s=>s?ep(s):NaN),sr=wx.daily.sunrise.map(s=>s?ep(s):NaN);let n0=NaN,n1=NaN;
    for(let i=0;i<ss.length-1;i++){if(isFinite(ss[i])&&isFinite(sr[i+1])&&sr[i+1]>now){n0=ss[i];n1=sr[i+1];break}}
    if(!isFinite(n0)){const d0=new Date(now);n0=d0.setHours(0,0,0,0)+20*36e5;n1=n0+10*36e5}   // polar day or night: use 8 PM to 6 AM
    const idx=T.map((t,i)=>i).filter(i=>T[i]>=n0&&T[i]<=n1);
    const sunAlt=i=>altaz('Sun',new Date(T[i]),obs).alt,dark=idx.filter(i=>sunAlt(i)<-12);
    const night=dark.length?dark:idx,noDark=!dark.length;
    const mean=(arr,f)=>arr.length?arr.reduce((a,i)=>a+f(i),0)/arr.length:NaN;
    const cloudDark=mean(night,i=>H.cloud_cover[i]);
    const reportDate=dateOf(new Date(n0)),mid=new Date((n0+n1)/2);

    // the three models' view of tonight's cloud: their spread is our confidence
    let agree=null;if(mm){const per=MODELS.map(([k,n])=>{const a=mm.hourly['cloud_cover_'+k];const v=a?mean(night.filter(i=>a[i]!=null),i=>a[i]):NaN;return[n,v]}).filter(x=>isFinite(x[1]));
      if(per.length>=2){const vs=per.map(x=>x[1]),sp=Math.max(...vs)-Math.min(...vs);agree={per,spread:sp,word:sp<15?'High':sp<35?'Medium':'Low',score:sp<15?.95:sp<35?.8:.6}}}

    // Moon
    const ill=A.Illumination('Moon',mid),lit=Math.round(ill.phase_fraction*100),phaseDeg=A.MoonPhase(mid);
    const phaseName=lit<3?'New Moon':lit>97?'Full Moon':(phaseDeg<180?'Waxing ':'Waning ')+(lit<45?'crescent':lit<55?(phaseDeg<180?'first quarter':'last quarter'):'gibbous');
    const moonUpEve=night.slice(0,Math.ceil(night.length/2)).some(i=>altaz('Moon',new Date(T[i]),obs).alt>0),moonUpLate=night.slice(Math.floor(night.length/2)).some(i=>altaz('Moon',new Date(T[i]),obs).alt>0);
    const mrise=A.SearchRiseSet('Moon',obs,+1,new Date(n0-6*36e5),2),mset=A.SearchRiseSet('Moon',obs,-1,new Date(n0-6*36e5),2);
    const moonNote=[mrise&&mrise.date<n1+6*36e5?'rises '+clock(mrise.date):null,mset&&mset.date<n1+6*36e5?'sets '+clock(mset.date):null].filter(Boolean).join(', ');

    // planets: up after dark, brightest first
    const eve=new Date(Math.min(n1,(night.length?T[night[0]]:n0)+36e5)),late=new Date(n1-90*6e4);
    const planets=['Venus','Jupiter','Mars','Saturn','Mercury'].map(n=>{const e=altaz(n,eve,obs),l=altaz(n,late,obs),m=altaz(n,mid,obs),mag=A.Illumination(n,mid).mag;
      const when=e.alt>8&&l.alt>8?'All night':e.alt>8?'Evening':l.alt>8?'Before dawn':m.alt>8?'Midnight':null;const at=e.alt>8?e:l.alt>8?l:m;
      return when&&mag<2.5?{name:n,when,where:dir(at.az)+(when==='Before dawn'?' before dawn':when==='Evening'||when==='All night'?' after dark':' around midnight'),az:at.az,alt:at.alt,mag}:null}).filter(Boolean).sort((a,b)=>a.mag-b.mag);

    const clearSky=Math.max(.1,1-.9*cloudDark/100),C=(name,val,score,note)=>({name,val,score:Math.round(score*1000)/1000,note});
    const pts=(arr,f)=>arr.filter((_,k)=>k%2===0).map(i=>({t:hr(new Date(T[i])),v:Math.round(f(i))}));
    const omLink=omURL,events=[],upcoming=[];
    const agreeReading=agree?[{name:'Forecast agreement (cloud)',value:agree.word+': '+agree.per.map(([n,v])=>n+' '+Math.round(v)+'%').join(', '),source:'Open-Meteo multi-model',url:mmURL}]:[];
    const cloudCond=C('Clear sky','About '+Math.round(cloudDark)+'% cloud',clearSky,(agree?agree.word+' agreement between the ECMWF, GFS and ICON models. ':'')+(cloudDark<30?'Mostly clear through the dark hours.':cloudDark<60?'Broken cloud. You may need to wait for gaps.':'Heavy cloud is the main thing working against you.'));

    // stars
    {const moonS=moonUpEve?1-.45*lit/100:.95,vis=mean(night.filter(i=>H.visibility&&H.visibility[i]!=null),i=>H.visibility[i]/1000),rh=mean(night,i=>H.relative_humidity_2m[i]);
      const air=isFinite(vis)?(vis>=30?.95:vis>=20?.8:vis>=10?.55:.3):(rh<60?.95:rh<75?.8:rh<88?.55:.3);
      let ch=clamp(Math.round(100*clearSky*moonS*air),1,97);if(noDark)ch=Math.min(ch,25);
      const best=planets[0],look=best?{bearing:Math.round(best.az),label:best.where+', for '+best.name}:{bearing:la>=0?180:0,label:'The darkest part of the sky, away from town glow'};
      events.push({type:'stars',chance:ch,title:['Great','Good','Fair','Poor'][lvl(ch)]+' night for stargazing',
        sub:(noDark?'The Sun never gets far enough below the horizon tonight for a fully dark sky. ':'')+(best?best.name+' is the brightest target, '+best.where.toLowerCase()+'. ':'')+(cloudDark<30?'Mostly clear skies':'Cloud')+' and '+(moonUpEve?'a '+lit+'% Moon':'no Moon in the evening')+' set tonight’s odds.',
        look,params:{cloud:Math.round(cloudDark),moon:lit,planets:planets.slice(0,3).map(p=>p.name),clarity:Math.round(1+4*air)},
        conds:[cloudCond,C('Moonlight',moonUpEve?'Moon '+lit+'% lit, up in the evening':'Moon '+lit+'% lit, not up in the evening',moonS,moonUpEve&&lit>50?'Bright moonlight hides the faint stars and the Milky Way.':'Dark enough for faint stars.'),
          C('Clear air',isFinite(vis)?'Visibility '+Math.round(vis)+' km':'Humidity '+Math.round(rh)+'%',air,air>=.8?'Clean, dry air lets faint stars reach low toward the horizon.':'Haze or damp air dims stars near the horizon.')],
        series:[{label:'Cloud cover tonight',unit:'%',max:100,source:'Open-Meteo',points:pts(idx,i=>H.cloud_cover[i])},{label:'Moon height',unit:'°',max:90,source:'Astronomy Engine',points:pts(idx,i=>Math.max(0,altaz('Moon',new Date(T[i]),obs).alt))}],
        readings:[{name:'Cloud, dark hours',value:Math.round(cloudDark)+'%',source:'Open-Meteo',url:omLink},...agreeReading,{name:'Moon',value:lit+'% lit'+(moonNote?', '+moonNote:''),source:'Astronomy Engine',url:LINK.ae},
          {name:'Darkness',value:noDark?'No full darkness tonight':night.length+' dark hours',source:'Astronomy Engine',url:LINK.ae}],
        facts:[{cat:'Tonight',text:agree?`The three weather models give ${agree.per.map(([n,v])=>n+' '+Math.round(v)+'%').join(', ')} average cloud for the dark hours, so confidence is ${agree.word.toLowerCase()}.`:`Average cloud for the dark hours is about ${Math.round(cloudDark)}%.`}]})}

    // aurora: Kp forecast against the Kp needed at this geomagnetic latitude, plus NOAA's nowcast when it is worth the download
    // NOAA has served this file both as rows of arrays and as objects; accept either
    const utc=s=>{s=String(s||'').replace(' ','T');return Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(s)?s:s+'Z')};
    if(kp&&Array.isArray(kp)){const rows=kp.map(r=>Array.isArray(r)?{t:utc(r[0]),kp:parseFloat(r[1])}:{t:utc(r&&r.time_tag),kp:parseFloat(r&&r.kp)}).filter(r=>isFinite(r.t)&&isFinite(r.kp));
      const tonight=rows.filter(r=>r.t+3*36e5>=n0&&r.t<=n1),maxKp=tonight.length?Math.max(...tonight.map(r=>r.kp)):NaN;
      if(isFinite(maxKp)){const ml=Math.abs(magLat(la,lo)),need=clamp((63.5-ml)/2.05,0,9),d=maxKp-need;
        let storm=d>=1?.92:d>=0?.75:d>=-1?.35:d>=-2?.1:.03,ov=null;
        if(d>=-2){try{const j=await getJSON('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',15000),lon360=Math.round((lo+360)%360),lat=Math.round(la);
          const hit=(j.coordinates||[]).find(c=>c[0]===lon360&&c[1]===lat);if(hit)ov={p:hit[2],at:j['Forecast Time']}}catch(e){fails.push('NOAA aurora nowcast')}}
        if(ov&&ov.p>=30&&sunAlt(T.findIndex(t=>t>=now)>=0?T.findIndex(t=>t>=now):0)<-12)storm=Math.max(storm,.9);
        const moonS=1-.2*lit/100,ch=clamp(Math.round(100*storm*clearSky*moonS),1,97),word=['likely','possible','unlikely','very unlikely'][lvl(ch)],pole=la>=0?'north':'south';
        events.push({type:'aurora',chance:ch,title:'Aurora '+word+' tonight',sub:`Look ${pole}, low over the horizon, from somewhere dark. Tonight's forecast peaks at Kp ${r1(maxKp)}; this far from the auroral zone you usually need about Kp ${r1(need)}.`,
          look:{bearing:la>=0?0:180,label:(la>=0?'North':'South')+', low on the horizon'},params:{kp:r1(maxKp),cloud:Math.round(cloudDark),moon:lit},
          conds:[C('Storm strong enough for your latitude','Kp '+r1(maxKp)+', need about '+r1(need),storm,d>=0?'The auroral oval should reach your horizon.':'The lights probably stay poleward of you. A camera may still catch a glow.'),cloudCond,C('Moonlight','Moon '+lit+'% lit',moonS,'Moonlight washes out faint aurora.')],
          series:[{label:'Kp forecast, 3-hour blocks',unit:'Kp',max:9,threshold:r1(need),thresholdLabel:'needed here',source:'NOAA SWPC',points:rows.filter(r=>r.t>=n0-6*36e5&&r.t<=n1+3*36e5).map(r=>({t:hr(new Date(r.t)),v:r1(r.kp)}))}],
          readings:[{name:'Max Kp tonight',value:String(r1(maxKp)),source:'NOAA SWPC',url:LINK.kp},{name:'Geomagnetic latitude',value:Math.round(ml)+'°',source:'IGRF dipole',url:'https://www.ncei.noaa.gov/products/international-geomagnetic-reference-field'},...(ov?[{name:'Aurora nowcast here',value:ov.p+'% (NOAA OVATION, '+clock(new Date(ov.at))+')',source:'NOAA SWPC',url:LINK.ov}]:[])],
          facts:[{cat:'Tonight',text:`At about ${Math.round(ml)}° geomagnetic latitude, the aurora usually reaches your horizon once Kp climbs to around ${r1(need)}. Tonight's forecast peaks at ${r1(maxKp)}.`}]})}}

    // meteor showers: peak night or one night either side, with the radiant high enough to matter here
    {const md=new Date(n0),y=+reportDate.slice(0,4);
      for(const s of SHOWERS){const peak=Date.UTC(y,s[1]-1,s[2]),dd=Math.round((Date.parse(reportDate)-peak)/864e5);if(Math.abs(dd)>1)continue;
        const alts=night.map(i=>radAlt(s[5],s[6],new Date(T[i]),obs)),best=alts.reduce((a,b)=>b.alt>a.alt?b:a,{alt:-90,az:0}),bi=alts.indexOf(best);if(best.alt<10)continue;
        const zhrHere=Math.round(s[3]*Math.sin(best.alt*D)),peakS=Math.min(.95,.5+s[3]/200)*(dd?.7:1),moonS=moonUpLate?1-.45*lit/100:.97;
        const ch=clamp(Math.round(100*peakS*clearSky*moonS),1,97),con=A.Constellation(s[5]/15,s[6]).name,bt=night[bi]!=null?new Date(T[night[bi]]):mid;
        events.push({type:'meteor',chance:ch,title:s[0]+(dd===0?' peak tonight':dd<0?' build toward their peak':' just past their peak'),sub:`Best around ${clock(bt)}, when the radiant in ${con} is ${Math.round(best.alt)}° up in the ${dir(best.az)}. Under a dark sky expect up to about ${zhrHere} an hour.`,
          look:{bearing:Math.round(best.az),label:dir(best.az)+', toward '+con},params:{shower:s[0],radiant:con,speed:s[4],zhr:s[3],parent:s[7],cloud:Math.round(cloudDark),moon:lit},
          conds:[C('Shower strength',dd===0?'Peak night, ZHR '+s[3]:'One night '+(dd<0?'before':'after')+' the peak',peakS,'Rates fall off quickly away from the peak night.'),cloudCond,C('Moonlight','Moon '+lit+'% lit'+(moonUpLate?', up after midnight':''),moonS,moonUpLate?'Moonlight hides the fainter meteors.':'A dark sky after midnight.')],
          series:[{label:'Radiant height tonight',unit:'°',max:90,source:'Astronomy Engine',points:night.filter((_,k)=>k%2===0).map(i=>({t:hr(new Date(T[i])),v:Math.max(0,Math.round(radAlt(s[5],s[6],new Date(T[i]),obs).alt))}))}],
          readings:[{name:'Zenithal hourly rate',value:String(s[3]),source:'IMO',url:LINK.imo},{name:'Radiant height at best',value:Math.round(best.alt)+'°, '+clock(bt),source:'Astronomy Engine',url:LINK.ae}],
          facts:[{cat:'Tonight',text:`The ${s[0]} come from debris of ${s[7]} and hit the air at about ${s[4]} km/s. With the radiant ${Math.round(best.alt)}° up, you could see up to ${zhrHere} an hour from a truly dark site.`}]});break}
      for(const s of SHOWERS){if(90-Math.abs(la-s[6])<15)continue;for(const yy of [y,y+1]){const pk=Date.UTC(yy,s[1]-1,s[2]);if(pk>Date.parse(reportDate)+864e5&&pk<Date.parse(reportDate)+400*864e5)upcoming.push({at:pk,date:new Date(pk).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}),name:s[0]+' peak',note:'Up to about '+s[3]+' an hour at the peak (IMO).'})}}}

    // Moon events: full Moon (and supermoon), or a close pairing with a bright planet
    {const fq=A.SearchMoonQuarter(new Date(n0-36*36e5));let q=fq;for(let k=0;k<4&&q;k++){if(q.quarter===2&&Math.abs(q.time.date-mid)<18*36e5){const dist=A.GeoVector('Moon',q.time,true).Length()*149597870.7,sup=dist<360000;
        const rise=mrise&&mrise.date<n1?mrise.date:null,ch=clamp(Math.round(100*.97*.95*clearSky),1,97);
        events.push({type:'moon',chance:ch,title:(sup?'Supermoon':'Full Moon')+(rise?' rises at '+clock(rise):' tonight'),sub:`The Moon is full${sup?' and near its closest point to Earth ('+Math.round(dist/1000)+',000 km), so slightly larger and brighter than usual':''}. Catch it just after moonrise, low in the east, when it looks biggest.`,
          look:{bearing:rise?Math.round(altaz('Moon',new Date(+rise+30*6e4),obs).az):90,label:'East at moonrise'},params:{variant:sup?'super':'super',lit:100},
          conds:[C(sup?'Supermoon':'Full Moon',sup?Math.round(dist/1000)+',000 km away':'Full tonight',.97,'The whole face is lit.'),C('Moon above your horizon',rise?'Rises '+clock(rise):'Up tonight',.95,'An open eastern horizon helps.'),cloudCond],
          series:[{label:'Moon height',unit:'°',max:90,source:'Astronomy Engine',points:pts(idx,i=>Math.max(0,altaz('Moon',new Date(T[i]),obs).alt))}],
          readings:[{name:'Full Moon',value:clock(q.time.date),source:'Astronomy Engine',url:LINK.ae},{name:'Distance',value:Math.round(dist).toLocaleString()+' km',source:'Astronomy Engine',url:LINK.ae}],facts:[]});break}q=A.NextMoonQuarter(q)}
      if(!events.some(e=>e.type==='moon')){const mv=A.GeoVector('Moon',eve,true);for(const p of planets){const sep=A.AngleBetween(mv,A.GeoVector(p.name,eve,true));const ma=altaz('Moon',eve,obs);
        if(sep<4&&ma.alt>5){const ch=clamp(Math.round(100*.95*.95*clearSky),1,97);events.push({type:'moon',chance:ch,title:p.name+' beside the Moon tonight',sub:`${p.name} sits about ${r1(sep)}° from the Moon, ${dir(ma.az)} after dark. Both fit in one binocular view.`,
          look:{bearing:Math.round(ma.az),label:dir(ma.az)+' after dark'},params:{variant:'conjunction',lit,near:p.name},conds:[C(p.name+' close to the Moon','About '+r1(sep)+'° apart',.95,'Closer than three finger-widths at arm’s length.'),C('Moon above your horizon',Math.round(ma.alt)+'° up after dark',.95,'Up in the evening sky.'),cloudCond],
          series:[],readings:[{name:'Separation',value:r1(sep)+'°',source:'Astronomy Engine',url:LINK.ae}],facts:[]});break}}}
      // next full Moon for the upcoming list
      let q2=A.SearchMoonQuarter(new Date(n1));for(let k=0;k<4&&q2;k++){if(q2.quarter===2){upcoming.push({at:+q2.time.date,date:new Date(q2.time.date).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:TZ}),name:'Full Moon',note:'Rises around sunset and is up all night.'});break}q2=A.NextMoonQuarter(q2)}}

    // eclipses visible from here: a lunar eclipse tonight, or a solar eclipse today
    {let le=A.SearchLunarEclipse(new Date(n0-12*36e5));for(let k=0;k<6&&le;k++){const pk=le.peak.date,alt=altaz('Moon',pk,obs).alt;
        if(pk>=n0&&pk<=n1&&alt>0){const pct=le.kind==='total'?100:Math.round((le.obscuration||0)*100),ch=clamp(Math.round(100*.97*.95*clearSky),1,97);
          events.push({type:'eclipse',chance:ch,title:le.kind[0].toUpperCase()+le.kind.slice(1)+' lunar eclipse tonight',sub:`Mid-eclipse at ${clock(pk)} with the Moon ${Math.round(alt)}° up${le.kind==='total'?'. It should turn copper red at totality.':'.'}`,look:{bearing:Math.round(altaz('Moon',pk,obs).az),label:'Toward the Moon'},
            params:{kind:'lunar',phase:le.kind,pct},conds:[C('Eclipse visible from here',le.kind+', peak '+clock(pk),.97,'The Moon is up at mid-eclipse.'),C('Moon above the horizon',Math.round(alt)+'° up at peak',.95,'An open view toward the Moon is all you need.'),cloudCond],series:[],readings:[{name:'Peak',value:clock(pk),source:'Astronomy Engine',url:LINK.ae}],facts:[]})}
        if(pk>n1&&alt>0&&upcoming.length<12)upcoming.push({at:+pk,date:new Date(pk).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:TZ}),name:le.kind[0].toUpperCase()+le.kind.slice(1)+' lunar eclipse',note:'Visible from here, peak at '+clock(pk)+'.'});
        if(pk>n1+400*864e5)break;le=A.NextLunarEclipse(le.peak)}
      let se=A.SearchLocalSolarEclipse(new Date(n0-30*36e5),obs);for(let k=0;k<3&&se;k++){const pk=se.peak.time.date;
        if(pk>n1+400*864e5)break;
        if(se.peak.altitude>0&&pk>n0-24*36e5&&pk<n0){const pct=Math.round((se.obscuration||0)*100),ch=clamp(Math.round(100*.97*.95*Math.max(.1,1-.9*(H.cloud_cover[T.findIndex(t=>t>=pk)]||0)/100)),1,97);
          events.push({type:'eclipse',chance:ch,title:se.kind[0].toUpperCase()+se.kind.slice(1)+' solar eclipse today',sub:`Maximum at ${clock(pk)}, ${pct}% of the Sun covered. Use certified ISO 12312-2 eclipse glasses for every partial phase; sunglasses are not safe.`,look:{bearing:Math.round(altaz('Sun',pk,obs).az),label:'Toward the Sun, with eclipse glasses'},
            params:{kind:'solar',phase:se.kind,pct},conds:[C('Eclipse visible from here',se.kind+', '+pct+'% covered',.97,'Only look through certified eclipse glasses.'),C('Sun above the horizon',Math.round(se.peak.altitude)+'° up at maximum',.95,'Clear view toward the Sun needed.'),cloudCond],series:[],readings:[{name:'Maximum',value:clock(pk),source:'Astronomy Engine',url:LINK.ae}],facts:[]})}
        else if(pk>n1&&se.peak.altitude>0)upcoming.push({at:+pk,date:new Date(pk).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:TZ}),name:se.kind[0].toUpperCase()+se.kind.slice(1)+' solar eclipse',note:Math.round((se.obscuration||0)*100)+'% of the Sun covered here. Eclipse glasses needed.'});
        se=A.NextLocalSolarEclipse(se.peak.time,obs)}}

    // sunset colour, from the cloud around the sunset hour
    {const si=T.findIndex(t=>t>=n0-30*6e4);if(si>=0&&isFinite(n0)&&n0>now-2*36e5){const c=H.cloud_cover[si],hi=H.cloud_cover_high[si],pop=H.precipitation_probability[si]??0;
      const cs=c>=25&&c<=62?.9:(c>=12&&c<25)||(c>62&&c<=75)?.6:.3,dry=pop<40?.95:.4,conf=agree?agree.score*.9:.7,ch=clamp(Math.round(100*cs*dry*conf),1,97);
      events.push({type:'sunset',chance:ch,title:['Vivid','Colorful','Plain','Gray'][lvl(ch)]+' sunset expected',sub:`Sunset is at ${clock(new Date(n0))}. ${c<12?'A nearly clear sky gives a clean glow rather than painted clouds.':c>75?'Heavy cloud may block the light unless there is a gap on the horizon.':'Enough cloud to catch the light.'} The best colour comes 5 to 15 minutes after the Sun sets.`,
        look:{bearing:Math.round(altaz('Sun',new Date(n0),obs).az),label:'Toward the sunset'},params:{highCloud:Math.round(hi)},
        conds:[C('Cloud to catch the light',Math.round(c)+'% (best 25 to 62)',cs,'High cloud lit from below gives the strongest colour.'),C('Dry at sunset',Math.round(pop)+'% chance of rain',dry,'Rain or thick haze mutes the colours.'),C('Forecast confidence',agree?agree.word+' model agreement':'Single model',conf,'Sunset colour is hard to forecast; this is a rough guide.')],
        series:[{label:'Cloud by height around sunset',unit:'%',max:100,source:'Open-Meteo',points:[-2,-1,0,1].map(k=>({t:hr(new Date(T[si+k]||T[si])),v:Math.round(H.cloud_cover_high[si+k]??hi)}))}],
        readings:[{name:'Sunset',value:clock(new Date(n0)),source:'Open-Meteo',url:omLink},{name:'Cloud low / mid / high',value:Math.round(H.cloud_cover_low[si])+'% / '+Math.round(H.cloud_cover_mid[si])+'% / '+Math.round(hi)+'%',source:'Open-Meteo',url:omLink}],facts:[]})}}

    // fog, frost and snow, from the hours toward tomorrow's sunrise
    {const morn=T.map((t,i)=>i).filter(i=>T[i]>=n1-7*36e5&&T[i]<=n1+36e5);
      if(morn.length){const spreadC=Math.min(...morn.map(i=>H.temperature_2m[i]-H.dew_point_2m[i])),minC=Math.min(...morn.map(i=>H.temperature_2m[i])),wi=morn.reduce((a,i)=>H.temperature_2m[i]-H.dew_point_2m[i]<H.temperature_2m[a]-H.dew_point_2m[a]?i:a,morn[0]);
        const spreadF=spreadC*1.8,windK=H.wind_speed_10m[wi],windM=windK/1.609,rise=clock(new Date(n1));
        if(spreadF<=8){const sat=spreadF<=2?.95:spreadF<=4?.75:spreadF<=6?.45:.2,calm=windM<=4?.95:windM<=8?.7:.35,ch=clamp(Math.round(100*sat*calm*clearSky),1,97);
          events.push({type:'fog',chance:ch,title:'Fog '+['likely','possible','unlikely','very unlikely'][lvl(ch)]+' at sunrise',sub:`Temperature and dew point come within ${imperial?Math.round(spreadF)+'°F':r1(spreadC)+'°C'} before sunrise (${rise}) with ${spd(windK)} wind. Fog forms first in valleys and low ground.`,
            look:{bearing:90,label:'Low ground and valleys at sunrise'},params:{spreadF:Math.round(spreadF),wind:Math.round(windM),cloud:Math.round(cloudDark)},
            conds:[C('Air close to saturation','Dew point within '+(imperial?Math.round(spreadF)+'°F':r1(spreadC)+'°C'),sat,'Once the air cools to its dew point, fog forms.'),C('Light wind',spd(windK),calm,'Calm air lets the cold layer settle.'),cloudCond],
            series:[{label:'Temperature minus dew point',unit:imperial?'°F':'°C',max:imperial?15:8,threshold:imperial?2:1,thresholdLabel:'fog forms',source:'Open-Meteo',points:morn.map(i=>({t:hr(new Date(T[i])),v:r1((H.temperature_2m[i]-H.dew_point_2m[i])*(imperial?1.8:1))}))}],
            readings:[{name:'Smallest temp/dew point gap',value:imperial?Math.round(spreadF)+'°F':r1(spreadC)+'°C',source:'Open-Meteo',url:omLink},{name:'Sunrise',value:rise,source:'Open-Meteo',url:omLink}],facts:[]})}
        if(minC<=4.4){const lowF=minC*9/5+32,cold=lowF<=30?.95:lowF<=34?.75:lowF<=36?.45:.15,calm=windM<=5?.95:windM<=10?.7:.4,ch=clamp(Math.round(100*cold*clearSky*calm),1,97);
          events.push({type:'frost',chance:ch,title:'Frost '+['likely','possible','unlikely','very unlikely'][lvl(ch)]+' by morning',sub:`A low near ${tC(minC)} with ${cloudDark<40?'clear':'cloudy'} skies. Grass and car roofs run a few degrees colder than the air.`,
            look:{bearing:null,label:'Lawns, roofs and windshields at dawn'},params:{lowF:Math.round(lowF),wind:Math.round(windM),cloud:Math.round(cloudDark)},
            conds:[C('Cold enough at the ground','Low of '+tC(minC),cold,'Thermometers sit about 2 m up; surfaces get colder on clear nights.'),cloudCond,C('Light wind',spd(windK),calm,'Calm air lets the coldest layer sit on the ground.')],
            series:[{label:'Temperature overnight',unit:imperial?'°F':'°C',max:imperial?60:15,threshold:imperial?32:0,thresholdLabel:'freezing',source:'Open-Meteo',points:pts(idx,i=>imperial?H.temperature_2m[i]*9/5+32:H.temperature_2m[i])}],
            readings:[{name:'Overnight low',value:tC(minC),source:'Open-Meteo',url:omLink}],facts:[]})}}
      const snowCm=idx.reduce((a,i)=>a+(H.snowfall[i]||0),0),popMax=Math.max(0,...idx.map(i=>H.precipitation_probability[i]||0));
      if(snowCm>.2){const minT=Math.min(...idx.map(i=>H.temperature_2m[i])),tF=minT*9/5+32,ch=clamp(Math.round(popMax*(tF<=30?.95:tF<=32?.75:.45)),1,97);
        events.push({type:'snow',chance:ch,title:'Snow '+['likely','possible','unlikely','very unlikely'][lvl(ch)]+' tonight',sub:`About ${imperial?r1(snowCm/2.54)+' in':r1(snowCm)+' cm'} forecast overnight, with temperatures near ${tC(minT)}.`,look:{bearing:null,label:'Out any window'},
          params:{tempF:Math.round(tF),pop:Math.round(popMax),inches:r1(snowCm/2.54)},conds:[C('Cold enough to stick',tC(minT),tF<=30?.95:tF<=32?.75:.45,'Below freezing all the way down it accumulates.'),C('Moisture arriving',Math.round(popMax)+'% chance',popMax/100,'The storm track decides this one.'),C('Enough to notice',imperial?r1(snowCm/2.54)+' in':r1(snowCm)+' cm',snowCm>=5?.95:.75,'Grass and cars whiten first.')],
          series:[{label:'Snowfall by hour',unit:'cm',source:'Open-Meteo',points:pts(idx,i=>(H.snowfall[i]||0)*10)}],readings:[{name:'Snow tonight',value:r1(snowCm)+' cm',source:'Open-Meteo',url:omLink}],facts:[]})}}

    // shared daily content from the morning research run: fresh facts and research (never location-specific "Tonight" notes)
    if(shared&&Array.isArray(shared.events))for(const e of events){const s=shared.events.find(x=>x.type===e.type);if(!s)continue;
      e.facts=[...e.facts,...(s.facts||[]).filter(f=>f&&f.cat!=='Tonight'&&!/State College|Pennsylvania|Tussey|Nittany/i.test(f.text||''))];e.research=(s.research||[]).filter(x=>x&&/^https:\/\//.test(x.url||''))}

    events.sort((a,b)=>b.chance-a.chance);
    const RAR={eclipse:6,comet:4,aurora:4,meteor:3,moon:2.2,snow:2,iss:1.6,fog:1.5,frost:1.2,sunset:1.2,stars:1},pool=events.filter(e=>e.chance>=40),feat=pool.length?[...pool].sort((a,b)=>b.chance/100*(RAR[b.type]||1)-a.chance/100*(RAR[a.type]||1))[0]:events[0];   // a highlight needs at least a Good rating
    const st=events.find(e=>e.type==='stars');
    upcoming.sort((a,b)=>a.at-b.at);
    const report={date:reportDate,tz:TZ,live:true,checkedLabel:clock(new Date())+' local time (live forecast)',place:place.name,placeId:'custom',lat:la,lon:lo,
      summary:(cloudDark<30?'Mostly clear':cloudDark<60?'Partly cloudy':'Mostly cloudy')+' tonight'+(st?', '+st.title.toLowerCase().replace(' night',' night')+'':'')+(planets[0]?', with '+planets.slice(0,2).map(p=>p.name).join(' and ')+' up':'')+'.',
      featured:feat?feat.type:'stars',pick:feat?feat.sub:'',next:upcoming[0]?{name:upcoming[0].name,date:new Date(upcoming[0].at).toISOString().slice(0,10)}:null,
      sky:{moon:{phase:phaseName,lit,note:moonNote||'up much of the night'},items:planets.map(p=>({name:p.name,when:p.when,where:p.where,note:'Magnitude '+r1(p.mag)}))},
      events,upcoming:upcoming.slice(0,5).map(({date,name,note})=>({date,name,note})),sourceFailures:fails};
    try{localStorage.setItem(CACHE,JSON.stringify({key:place.lat+','+place.lon,at:Date.now(),report}))}catch(e){}
    return report;
  }

  // ---- the location picker
  function ui(){const btn=$('locBtn'),panel=$('locPanel'),inp=$('locQ'),list=$('locList'),msg=$('locMsg'),cur=current();
    $('locName').textContent=cur?cur.name:'State College, PA';$('locHome').hidden=!cur;
    const open=v=>{panel.hidden=!v;btn.setAttribute('aria-expanded',v);if(v)setTimeout(()=>inp.focus(),30)};
    btn.onclick=()=>open(panel.hidden);document.addEventListener('keydown',e=>{if(e.key==='Escape')open(false)});
    let tm=0;inp.oninput=()=>{clearTimeout(tm);const q=inp.value.trim();if(q.length<2){list.replaceChildren();return}
      tm=setTimeout(async()=>{msg.textContent='Searching...';try{const rs=await search(q);msg.textContent=rs.length?'':'No places found.';
        list.replaceChildren(...rs.map(p=>{const b=document.createElement('button');b.type='button';b.textContent=p.name;b.onclick=()=>{save(p);go()};const li=document.createElement('li');li.append(b);return li}))}catch(e){msg.textContent='Search is unavailable right now.'}},300)};
    $('locHere').onclick=async()=>{msg.textContent='Finding your location...';try{const p=await here();save(p);go()}catch(e){msg.textContent='Could not get your location. Check location permission, or search for a city.'}};
    $('locHome').onclick=()=>{save(null);go()}}
  return{current,save,build,ui,search,here}
})();
