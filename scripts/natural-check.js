const {spawn}=require('child_process');const {chromium}=require(require('fs').existsSync('/opt/npm-tools/node_modules/playwright') ? '/opt/npm-tools/node_modules/playwright' : 'playwright');
(async()=>{const c=spawn('node',['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:'3196'},stdio:'ignore'});
for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:3196/health')).ok)break}catch(e){}await new Promise(r=>setTimeout(r,150))}
const br=await chromium.launch();const errs=[];
/* 四個難度各開一個 context 並行跑，印出順序仍依難度排列 */
const run=async lv=>{
 const ctx=await br.newContext({viewport:{width:900,height:700}});await ctx.addInitScript('window.__GO_IN = 300');const pg=await ctx.newPage();
 pg.on('pageerror',e=>errs.push(lv+e.message));pg.on('console',m=>m.type()==='error'&&errs.push(lv+m.text()));
 await pg.goto('http://127.0.0.1:3196/');await pg.waitForSelector('.home-menu');await pg.click('text=一個人玩');await pg.waitForSelector('.sticky-cta');
 await pg.evaluate(l=>{App.store.solo.opponents=1;App.store.solo.mode='duel';App.store.solo.level=l;App.store.solo.duration=0;App.go('solo')},lv);
 await pg.click('text=開始遊戲');await pg.waitForSelector('.bslot canvas');await pg.waitForFunction(()=>App.game&&App.game.mt()>300);
 const cv=await pg.$('.bslot.mine canvas');const bb=await cv.boundingBox();const seen={};let lasers=0,bad=0;
 for(let i=0;i<40;i++){
  const k=await pg.evaluate(()=>{const b=App.game.m.boards[0];return b&&b.cur?b.cur.k:null});
  seen[k]=(seen[k]||0)+1;
  const before=await pg.evaluate(()=>App.game.m.boards[0].rows.flat().filter(x=>x).length);
  await pg.mouse.click(bb.x+bb.width*(0.15+0.7*Math.random()),bb.y+bb.height*0.3);await pg.waitForTimeout(260);
  if(k&&k.startsWith('laser')){lasers++;const after=await pg.evaluate(()=>App.game.m.boards[0].rows.flat().filter(x=>x).length);if(after>=before+1)bad++;}
 }
 const hs=await pg.evaluate(()=>App.game.m.boards.map(b=>b.shots));
 await ctx.close();
 return [lv,JSON.stringify(seen),'laser shots',lasers,'no-effect',bad,'shots',JSON.stringify(hs)];};
const rows=await Promise.all(['baby','easy','normal','hard'].map(run));
rows.forEach(r=>console.log(r.join(' ')));
console.log('errors',JSON.stringify(errs));await br.close();c.kill();})();
