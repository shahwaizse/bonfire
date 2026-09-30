/* Bonfire, 24 seconds. Pure Canvas; no fonts, images, clips or network assets. */
(() => {
  const canvas = document.querySelector('#film'), c = canvas.getContext('2d');
  const W=1280,H=720,DURATION=24;
  const P={bg:'#0e0c14',card:'#211c2c',panel:'#17131f',paper:'#f3effa',ink:'#110d19',orange:'#c39af3',lime:'#b9a3e8',pink:'#68bdcb',muted:'#81758e',border:'#3a3049'};
  const clamp=x=>Math.max(0,Math.min(1,x)), ease=x=>1-Math.pow(1-clamp(x),4);
  const lerp=(a,b,x)=>a+(b-a)*x;
  // Move in a short burst, hold, then go again. Character motion lives on twos.
  const pose=t=>Math.floor(t*12)/12;
  const enter=(t,delay=0)=>ease((t-delay)/0.28);
  function rect(x,y,w,h,color,r=0){c.fillStyle=color;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();}
  function text(s,x,y,size=64,color=P.ink,align='left',weight=900){c.fillStyle=color;c.font=`${weight} ${size}px "Arial Black",Arial,sans-serif`;c.textAlign=align;c.textBaseline='alphabetic';c.fillText(s,x,y);}
  function line(x,y,x2,y2,color=P.ink,width=4){c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.stroke();}
  function disc(x,y,r,color){c.fillStyle=color;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();}
  function star(x,y,r,rotation=0,color=P.orange){c.save();c.translate(x,y);c.rotate(rotation);c.beginPath();for(let i=0;i<24;i++){const a=i*Math.PI/12,q=i%2?r*.73:r;c.lineTo(Math.cos(a)*q,Math.sin(a)*q);}c.closePath();c.fillStyle=color;c.fill();c.restore();}
  function pill(s,x,y,w,color=P.lime,angle=0){c.save();c.translate(x,y);c.rotate(angle);rect(-w/2,-24,w,48,color,24);text(s,0,7,18,P.ink,'center',700);c.restore();}
  function arrow(x,y,w=90){line(x,y,x+w,y);line(x+w,y,x+w-18,y-15);line(x+w,y,x+w-18,y+15);}
  function flame(x,y,scale=1,t=0){c.save();c.translate(x,y);c.scale(scale,scale);c.rotate(Math.sin(pose(t)*4)*.035);c.fillStyle=P.orange;c.beginPath();c.moveTo(0,-100);c.bezierCurveTo(42,-58,16,-46,46,-67);c.bezierCurveTo(91,5,72,68,0,75);c.bezierCurveTo(-72,68,-80,6,-33,-45);c.bezierCurveTo(-22,-5,-6,-37,0,-100);c.fill();c.fillStyle=P.lime;c.beginPath();c.moveTo(0,-18);c.bezierCurveTo(46,22,38,63,0,65);c.bezierCurveTo(-37,63,-36,26,0,-18);c.fill();disc(-18,8,7,P.ink);disc(18,8,7,P.ink);line(-11,32,11,32,P.ink,5);c.restore();}
  function gpu(x,y,scale=1,t=0,mood='normal'){
    c.save();c.translate(x,y);c.rotate(Math.sin(pose(t)*3)*.045);c.scale(scale,scale);
    line(-55,65,-67,112,P.muted,9);line(55,65,70,112,P.muted,9);line(-68,112,-92,112,P.muted,9);line(70,112,94,112,P.muted,9);
    line(-124,-12,-157,-44,P.muted,8);line(124,-12,153,-42,P.muted,8);
    rect(-129,-76,258,150,P.ink,15);rect(-120,-67,240,132,P.lime,10);
    for(let i=0;i<9;i++)rect(-75+i*18,74,10,14,P.orange,2);
    for(const xx of [-61,61]){disc(xx,0,45,P.ink);disc(xx,0,34,P.paper);c.save();c.translate(xx,0);c.rotate(Math.floor(t*5)*.7);for(let j=0;j<6;j++){c.rotate(Math.PI/3);rect(2,-5,26,10,P.muted,5);}c.restore();disc(xx,0,9,P.ink);}
    if(mood==='shock'){disc(-20,-44,5,P.ink);disc(20,-44,5,P.ink);disc(0,40,9,P.ink);}else{line(-18,40,18,40,P.ink,5);}
    c.restore();
  }
  function background(t=0){
    rect(0,0,W,H,P.bg);
    const g=c.createRadialGradient(370+Math.sin(t*.3)*100,220,30,550,300,740);
    g.addColorStop(0,'#352244');g.addColorStop(.6,'#17121f');g.addColorStop(1,P.bg);
    c.fillStyle=g;c.fillRect(0,0,W,H);
    const a=c.createRadialGradient(1120,660,10,1120,660,510);
    a.addColorStop(0,'#15313b66');a.addColorStop(1,'#15313b00');c.fillStyle=a;c.fillRect(0,0,W,H);
  }
  function popWord(s,x,y,size,t,delay=0,color=P.paper){const e=enter(t,delay);c.save();c.translate(x,lerp(y+70,y,e));c.scale(1,lerp(.75,1,e));c.globalAlpha=e;text(s,0,0,size,color);c.restore();}
  const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
  function key(t,keys){for(let i=1;i<keys.length;i++){if(t<=keys[i][0]){const a=keys[i-1],b=keys[i];return lerp(a[1],b[1],smooth((t-a[0])/(b[0]-a[0])));}}return keys.at(-1)[1];}
  function camera(x,y,z){c.translate(W/2,H/2);c.scale(z,z);c.translate(-x,-y);}
  function strokeBox(x,y,w,h,r=14,color=P.border){c.strokeStyle=color;c.lineWidth=1.5;c.beginPath();c.roundRect(x,y,w,h,r);c.stroke();}
  function cursor(x,y,click=0){
    if(click>0&&click<1){c.save();c.globalAlpha=1-click;c.strokeStyle=P.orange;c.lineWidth=3;c.beginPath();c.arc(x,y,8+click*36,0,Math.PI*2);c.stroke();c.restore();}
    c.save();c.translate(x,y);c.shadowColor='#0008';c.shadowBlur=8;c.fillStyle=P.paper;c.strokeStyle=P.ink;c.lineWidth=2;c.beginPath();c.moveTo(0,0);c.lineTo(0,25);c.lineTo(7,19);c.lineTo(13,31);c.lineTo(18,28);c.lineTo(12,17);c.lineTo(23,16);c.closePath();c.fill();c.stroke();c.restore();
  }
  function sendButton(x,y,press=0){c.save();c.translate(x,y);c.scale(1-press*.12,1-press*.12);rect(-23,-23,46,46,P.orange,13);line(-8,2,8,-7,P.ink,2.5);line(8,-7,5,9,P.ink,2.5);line(8,-7,-9,-6,P.ink,2.5);c.restore();}
  function app({prompt='',typed=0,submitted=false,mode='images',stage=0,expanded=0,t=0,click=0}={}){
    c.save();c.shadowColor='#0008';c.shadowBlur=40;rect(110,76,1060,568,P.panel,22);c.restore();strokeBox(110,76,1060,568,22);
    rect(110,76,192,568,'#14101b',22);rect(290,76,13,568,'#14101b');line(303,99,303,623,P.border,1);
    text('bonfire',138,124,27,P.paper,'left',800);rect(128,156,157,39,P.card,10);text('+ New chat',145,182,16,P.paper,'left',600);
    text('Conversations',138,229,13,P.muted,'left',500);rect(128,248,157,43,'#30223e',10);text(mode==='images'?'Little guys':'GPU detective',143,275,16,P.paper,'left',600);
    disc(143,607,4,P.pink);text('Local model',156,612,13,P.muted,'left',500);
    text(mode==='images'?'A little help from the internet':'Tools that actually do things',340,117,18,P.paper,'left',600);line(326,140,1144,140,P.border,1);
    if(submitted){rect(722,168,405,66,'#392647',16);text(prompt,744,208,17,P.paper,'left',500);}
    if(!submitted){c.save();c.globalAlpha=1-ease(typed/.16);text('What are we trying today?',735,297,34,P.paper,'center',650);text('Local brains. Occasional internet legs.',735,342,18,P.muted,'center',400);c.restore();}
    if(submitted&&stage<1){disc(355,292,4,P.orange);disc(372,292,4,P.orange);disc(389,292,4,P.orange);text('Working on it...',410,298,18,P.muted,'left',500);}
    if(stage>=1){
      text(mode==='images'?'Found your tiny team.':'RX 6600 XT. Tiny GPU, big feelings.',346,281,23,P.paper,'left',650);
      if(mode==='images'){
        for(let i=0;i<3;i++){
          const x=346+i*244,e=enter(t,.15+i*.13);c.save();c.globalAlpha=e;c.translate(0,lerp(34,0,e));rect(x,313,224,177,[P.card,'#352347','#20343c'][i],14);strokeBox(x,313,224,177);
          if(i===0)flame(x+112,393,.58,t);else if(i===1)gpu(x+112,401,.43,t);else{star(x+112,393,48,pose(t)*.07,P.pink);disc(x+98,387,4,P.ink);disc(x+126,387,4,P.ink);line(x+100,405,x+123,405,P.ink,3);}
          text(['hot take','local legend','just a guy'][i],x+112,474,15,P.paper,'center',600);c.restore();
        }
      }
      const yy=mode==='images'?514:327;rect(346,yy-18,710,36,P.card,9);text(`${expanded>0?'v':'>'}  Tools used (${mode==='images'?1:2})`,364,yy+6,15,P.muted,'left',500);
      if(expanded>0){c.save();c.globalAlpha=expanded;rect(346,yy+28,710,132,'#1d1728',10);text('workspace / list_files',368,yy+58,16,P.orange,'left',600);text('welcome.txt',789,yy+58,16,P.paper,'left',500);line(366,yy+76,1035,yy+76,P.border,1);text('workspace / read_file',368,yy+106,16,P.orange,'left',600);text('GPU: Radeon RX 6600 XT',733,yy+106,16,P.paper,'left',500);c.restore();}
    }
    rect(328,554,808,70,P.card,16);strokeBox(328,554,808,70,16);
    const typedText=prompt.slice(0,Math.floor(prompt.length*clamp(typed)));
    text(submitted?'Ask anything...':typedText||'Ask anything...',348,583,18,submitted||!typedText?P.muted:P.paper,'left',400);
    if(!submitted&&typed>0&&typed<1){c.font='400 18px Arial';const xx=348+c.measureText(typedText).width;rect(xx+3,565,2,21,P.orange);}
    rect(348,597,68,19,'#30273e',6);text('Web off',382,611,11,P.muted,'center',500);sendButton(1100,589,click);
  }
  function draw(time){
    const t=Math.max(0,Math.min(time,DURATION-.001));c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,W,H);background(t);
    if(t<3){const s=t;
      const zoom=key(s,[[0,1],[2.45,1],[3,4.8]]);c.save();camera(lerp(640,1030,clamp((s-2.45)/.55)),lerp(360,395,clamp((s-2.45)/.55)),zoom);
      popWord('SMALL GPU.',85,260,94,s);popWord('BIG FEELINGS.',85,365,86,s,.18);gpu(1030,419,1.08,s,s>1.4?'shock':'normal');
      if(s>1){text('meet bonfire.',90,450,45,P.orange);}c.restore();
    }else if(t<6){const s=t-3;
      const z=key(s,[[0,1.07],[.3,1],[2.5,1],[3,3.5]]);c.save();camera(key(s,[[0,640],[2.5,640],[3,977]]),key(s,[[0,360],[2.5,360],[3,411]]),z);
      popWord('LOCAL',90,270,139,s);popWord('BRAINS.',90,417,139,s,.13);text('the model lives on your machine.',98,484,26,P.muted,'left',500);gpu(981,411,1.14,s);flame(978,213,.55,s);
      if(s>.9){pill('Qwen3.5 / 9B',987,590,247,P.orange,-.04);}c.restore();
    }else if(t<11){const s=t-6;
      c.save();camera(key(s,[[0,640],[.5,640],[1,728],[2.6,728],[3.16,1079],[3.5,1079],[4.1,700],[5,700]]),key(s,[[0,360],[.5,360],[1,576],[2.6,576],[3.16,579],[3.5,579],[4.1,342],[5,342]]),key(s,[[0,.88],[.5,1],[1,1.45],[2.6,1.45],[3.16,2.7],[3.5,2.7],[4.1,1.08],[5,1.08]]));
      app({prompt:'Show me pictures of little guys.',typed:clamp((s-.7)/1.7),submitted:s>3.28,mode:'images',stage:0,t:s,click:s>3.15&&s<3.35?Math.sin((s-3.15)/.2*Math.PI):0});
      const move=smooth((s-2.45)/.7);if(s>2.45)cursor(lerp(896,1100,move),lerp(666,589,move),s>3.17?clamp((s-3.17)/.42):0);c.restore();
    }else if(t<15.5){const s=t-11;
      c.save();camera(key(s,[[0,700],[.4,715],[1.7,715],[2.25,702],[3.7,702],[4.5,702]]),key(s,[[0,342],[.4,359],[1.7,359],[2.25,403],[3.7,403],[4.5,403]]),key(s,[[0,1.08],[.4,1.12],[1.7,1.12],[2.25,1.85],[3.7,1.85],[4.5,6.4]]));
      app({prompt:'Show me pictures of little guys.',typed:1,submitted:true,mode:'images',stage:1,t:s});
      if(s>1.15&&s<3.1)cursor(key(s,[[1.15,1096],[2,707],[3.1,707]]),key(s,[[1.15,581],[2,414],[3.1,414]]));c.restore();
    }else if(t<20.5){const s=t-15.5;
      c.save();camera(key(s,[[0,640],[.3,640],[.75,734],[1.7,734],[2.1,1077],[2.5,1077],[2.95,711],[3.3,711],[3.7,700],[5,700]]),key(s,[[0,360],[.3,360],[.75,574],[1.7,574],[2.1,583],[2.5,583],[2.95,325],[3.3,325],[3.7,366],[5,366]]),key(s,[[0,.91],[.3,1],[.75,1.5],[1.7,1.5],[2.1,2.4],[2.5,2.4],[2.95,1.26],[3.3,1.26],[3.7,1.4],[5,1.4]]));
      app({prompt:'Read welcome.txt. Which GPU is this?',typed:clamp((s-.35)/1.15),submitted:s>2.2,mode:'tools',stage:s>2.6?1:0,expanded:enter(s,3.55),t:s,click:s>2.1&&s<2.3?Math.sin((s-2.1)/.2*Math.PI):0});
      if(s>1.6){const x=key(s,[[1.6,910],[2.12,1100],[2.5,1100],[3.5,430],[5,430]]),y=key(s,[[1.6,662],[2.12,589],[2.5,589],[3.5,329],[5,329]]);cursor(x,y,s>3.5?clamp((s-3.5)/.4):s>2.13?clamp((s-2.13)/.4):0);}c.restore();
      // The result panel expands into the final title: a match cut, not a flash.
      if(s>4.65){const e=ease((s-4.65)/.35);c.save();c.globalAlpha=e;background(t);c.restore();}
    }else{const s=t-20.5;
      c.save();camera(640,360,key(s,[[0,1.15],[.4,1],[3,1],[3.5,1.03]]));flame(640,137,.56,s);popWord('bonfire',290,369,181,s);text('SELF-HOST. BREAK THINGS. LEARN STUFF.',640,459,27,P.paper,'center',650);
      if(s>.7){text('not a startup. please relax.',640,516,25,P.orange,'center',500);}if(s>1.4){text('github.com/shahwaizse/bonfire',640,582,19,P.muted,'center',500);}c.restore();
    }
  }
  window.bonfireFilm={draw,duration:DURATION,width:W,height:H};
  let playing=!new URLSearchParams(location.search).has('render'),now=0,last=performance.now();
  const play=document.querySelector('#play'),seek=document.querySelector('#seek');
  play.textContent=playing?'Pause':'Play';
  play.onclick=()=>{playing=!playing;play.textContent=playing?'Pause':'Play';};
  document.querySelector('#again').onclick=()=>{now=0;playing=true;play.textContent='Pause';};
  seek.oninput=()=>{now=Number(seek.value);draw(now);};
  function tick(stamp){if(playing)now=(now+(stamp-last)/1000)%DURATION;last=stamp;draw(now);seek.value=now;document.querySelector('#clock').textContent=`0:${Math.floor(now).toString().padStart(2,'0')} / 0:24`;requestAnimationFrame(tick);}
  draw(0);if(!new URLSearchParams(location.search).has('render'))requestAnimationFrame(tick);
})();
