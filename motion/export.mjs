// Deterministic Canvas -> JPEG pipe -> FFmpeg. Scratch files stay on D: by default.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'frontend/package.json'));
const { chromium } = require('@playwright/test');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const scratch = process.env.BONFIRE_MOTION_TEMP || 'D:/Projects/bonfire-motion-render';
const out = path.join(root, 'docs');
const fps = 24, seconds = 24;
await fs.mkdir(scratch, { recursive: true });
await fs.mkdir(out, { recursive: true });

// A tiny 120 BPM beat: kicks, hats, rubbery bass and scene-change blips.
const rate=22050, samples=rate*seconds, wave=Buffer.alloc(44+samples*2);
wave.write('RIFF',0);wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);
wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);
wave.writeUInt32LE(rate,24);wave.writeUInt32LE(rate*2,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);
wave.write('data',36);wave.writeUInt32LE(samples*2,40);
const cuts=[0,3,6,9.2,11,15.5,17.65,19,20.5], notes=[36,36,39,43,36,46,43,39];
for(let i=0;i<samples;i++){
  const t=i/rate,b=t%0.5,h=t%0.25,beat=Math.floor(t/.5);
  const noise=((Math.imul(i+1,16807)>>>0)%65536)/32768-1;
  const kick=Math.sin(2*Math.PI*(49*b+8*(1-Math.exp(-b*35))))*Math.exp(-b*22)*.48;
  const hat=noise*Math.exp(-h*110)*.085;
  const clap=beat%2?noise*Math.exp(-b*30)*.15:0;
  const f=440*Math.pow(2,(notes[beat%notes.length]-69)/12);
  const bass=Math.asin(Math.sin(2*Math.PI*f*t))*2/Math.PI*Math.exp(-b*6)*.14;
  let blip=0;for(const cut of cuts){const d=t-cut;if(d>=0&&d<.3)blip+=Math.sin(2*Math.PI*(720*d-700*d*d))*Math.exp(-d*16)*.15;}
  // Little rests make the held poses feel held. Fade the final beat out.
  const rest=(t>5.7&&t<6)||(t>15.2&&t<15.5)||(t>20.2&&t<20.5)?0:1;
  const fade=Math.min(1,t*8,Math.max(0,(seconds-t)*2));
  wave.writeInt16LE(Math.round(Math.tanh((kick+hat+clap+bass+blip)*rest)*fade*25000),44+i*2);
}
const audio=path.join(scratch,'bonfire-beat.wav');await fs.writeFile(audio,wave);

function encode(args){
  const child=spawn(ffmpeg,['-hide_banner','-loglevel','error','-y',...args],{windowsHide:true,stdio:['pipe','ignore','pipe']});
  let errors='';child.stderr.on('data',chunk=>{errors+=chunk;});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(errors||`FFmpeg exit ${code}`)));});
  // Attach immediately so early executable/encoding failures are handled.
  done.catch(()=>{});return {child,done};
}
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1328,height:850},deviceScaleFactor:1});
  await page.goto(pathToFileURL(path.join(root,'motion/index.html')).href+'?render=1');
  await page.waitForFunction(()=>Boolean(window.bonfireFilm));
  await page.addStyleTag({content:'canvas{width:1280px;height:720px;border-radius:0}'});
  const film=page.locator('#film');
  const video=encode(['-f','image2pipe','-vcodec','mjpeg','-framerate',`${fps}`,'-i','pipe:0','-i',audio,'-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart','-shortest',path.join(out,'bonfire-intro.mp4')]);
  video.child.stdin.on('error',()=>{});
  for(let frame=0;frame<fps*seconds;frame++){
    await page.evaluate(t=>window.bonfireFilm.draw(t),frame/fps);
    const buffer=await film.screenshot({type:'jpeg',quality:95,animations:'allow'});
    if(!video.child.stdin.write(buffer))await Promise.race([once(video.child.stdin,'drain'),video.done.then(()=>{throw new Error('Encoder closed early');})]);
    if(frame%(fps*4)===0)console.log(`Rendered ${frame/fps}/${seconds}s`);
  }
  video.child.stdin.end();await video.done;
  await page.evaluate(()=>window.bonfireFilm.draw(21.7));
  await film.screenshot({path:path.join(out,'bonfire-intro-poster.png')});
  const frames=[];for(const t of [1.8,4.7,8.5,9.25,12.5,13.8,18.9,22.6]){
    await page.evaluate(t=>window.bonfireFilm.draw(t),t);
    frames.push(await film.screenshot({type:'jpeg',quality:85}));
  }
  await page.setViewportSize({width:1280,height:1130});
  await page.setContent(`<body style="margin:0;background:#0e0c14;display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px">${frames.map(b=>`<img style="width:100%" src="data:image/jpeg;base64,${b.toString('base64')}">`).join('')}</body>`);
  await page.screenshot({path:path.join(scratch,'contact-sheet.png'),fullPage:true});
} finally {await browser.close();}
console.log('Encoding README loop...');
const gif=encode(['-i',path.join(out,'bonfire-intro.mp4'),'-filter_complex','fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3','-loop','0',path.join(out,'bonfire-intro.gif')]);
gif.child.stdin.end();await gif.done;
for(const name of ['bonfire-intro.mp4','bonfire-intro.gif','bonfire-intro-poster.png']){
  const info=await fs.stat(path.join(out,name));console.log(`${name}: ${(info.size/1024/1024).toFixed(2)} MB`);
}
