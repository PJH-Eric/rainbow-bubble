const {spawn}=require('child_process');const {chromium}=require('/opt/npm-tools/node_modules/playwright');
(async()=>{const c=spawn('node',['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:'3196'},stdio:'ignore'});await new Promise(r=>setTimeout(r,1200));
const br=await chromium.launch();const errs=[];
for(const lv of ['baby','easy','normal','hard']){
 const pg=await (await br.newContext({viewport:{width:900,height:700}})).newPage();
 pg.on('pageerror',e=>errs.push(lv+e.message));pg.on('console',m=>m.type()==='error'&&errs.push(lv+m.text()));
 await pg.goto('http://127.0.0.1:3196/');await pg.waitForSelector('.home-menu');await pg.click('text=一個人玩');await pg.waitForSelector('.sticky-cta');
 await pg.evaluate(l=>{App.store.solo.opponents=1;App.store.solo.mode='duel';App.store.solo.level=l;App.store.solo.duration=0;App.go('solo')},lv);
 await pg.click('text=開始遊戲');await pg.waitForSelector('.bslot canvas');await pg.waitForFunction(()=>App.game&&App.game.mt()>300);
 const cv=await pg.$('.bslot.mine canvas');const bb=await cv.boundingBox();const seen={};let lasers=0,bad=0;
 for(let i=0;i<70;i++){
  const k=await pg.evaluate(()=>{const b=App.game.m.boards[0];return b&&b.cur?b.cur.k:null});
  seen[k]=(seen[k]||0)+1;
  const before=await pg.evaluate(()=>App.game.m.boards[0].rows.flat().filter(x=>x).length);
  await pg.mouse.click(bb.x+bb.width*(0.15+0.7*Math.random()),bb.y+bb.height*0.3);await pg.waitForTimeout(260);
  if(k&&k.startsWith('laser')){lasers++;const after=await pg.evaluate(()=>App.game.m.boards[0].rows.flat().filter(x=>x).length);if(after>=before+1)bad++;}
 }
 const hs=await pg.evaluate(()=>App.game.m.boards.map(b=>b.shots));
 console.log(lv,JSON.stringify(seen),'laser shots',lasers,'no-effect',bad,'shots',hs);
 await pg.close();}
console.log('errors',JSON.stringify(errs));await br.close();c.kill();})();
