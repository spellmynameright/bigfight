// Run against a dev server, e.g. node scripts/check-backgrounds.mjs http://localhost:5192/bigfight/
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const url=process.argv[2]??'http://localhost:5192/bigfight/';
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1280,height:720}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
mkdirSync('background-lab/campaign-captures',{recursive:true});
const result=[];
try {
await page.goto(url);await page.waitForFunction(()=>window.bigfight);
await page.evaluate(()=>window.bigfight.stop());
for(let level=1;level<=16;level++){
 await page.evaluate(async({level,base})=>{const g=window.bigfight;const{GameplayScreen}=await import(`${base}src/screens/GameplayScreen.ts`);g.screens.replace(new GameplayScreen({levelId:level,characterId:'volt',seed:12345}));},{level,base:new URL(url).pathname});
 await page.waitForFunction(()=>window.bigfight.renderer.scene.getObjectByName('generated-scenery')?.userData.ready);
 const state=await page.evaluate(()=>{const g=window.bigfight;for(let i=0;i<240;i++)g.screens.update(1/60);g.screens.render(1);g.renderer.render(1/60);const s=g.renderer.scene.getObjectByName('generated-scenery');return {layers:s.children.length,fallback:g.renderer.scene.getObjectByName('procedural-scenery-fallback').visible,sceneryGroups:g.renderer.scene.children.flatMap(c=>c.children??[]).filter(c=>c.name==='generated-scenery').length}});
 assert.equal(state.fallback,false);assert.equal(state.sceneryGroups,1);
 await page.screenshot({path:`background-lab/campaign-captures/level-${String(level).padStart(2,'0')}.png`});
 result.push({level,...state});
}
// Camera bounds, tall and ultrawide screens, and both rendering tiers.
for(const [width,height]of [[390,844],[844,390],[1920,600]]){
 await page.setViewportSize({width,height});
 for(const quality of ['mobile','high']){
 const covered=await page.evaluate(({quality})=>{const g=window.bigfight;g.renderer.setQuality(quality);g.renderer.onResize();for(const[x,y,z]of[[-24,18,16],[24,-10,30],[0,35,30]]){g.renderer.camera.position.set(x,y,z);g.renderer.render(1/60);const mesh=g.renderer.scene.getObjectByName('scenery-far'),camera=g.renderer.camera;const corners=[[-.5,-.5],[.5,.5]].map(([x,y])=>mesh.position.clone().set(x,y,0).applyMatrix4(mesh.matrixWorld).project(camera));if(corners[0].x> -1||corners[0].y> -1||corners[1].x<1||corners[1].y<1)return false}return true},{quality});
 assert.equal(covered,true,`${width}x${height} ${quality} uncovered edge`);
 }
}
// Failed asset load must leave the full existing scenery intact.
await page.route('**/backgrounds/rooftop/near.webp',r=>r.abort());
await page.evaluate(async(base)=>{const{GameplayScreen}=await import(`${base}src/screens/GameplayScreen.ts`);window.bigfight.screens.replace(new GameplayScreen({levelId:1,characterId:'volt'}));},new URL(url).pathname);
await page.waitForTimeout(250);
assert.equal(await page.evaluate(()=>window.bigfight.renderer.scene.getObjectByName('procedural-scenery-fallback').visible),true);
// Delayed loads finishing after stage disposal must not revive removed scenery.
await page.unroute('**/backgrounds/rooftop/near.webp');
await page.route('**/backgrounds/cavern/*.webp',async r=>{await new Promise(resolve=>setTimeout(resolve,250));await r.continue();});
await page.evaluate(async(base)=>{const{GameplayScreen}=await import(`${base}src/screens/GameplayScreen.ts`);const g=window.bigfight;g.screens.replace(new GameplayScreen({levelId:2,characterId:'volt'}));g.screens.replace(new GameplayScreen({levelId:1,characterId:'volt'}));},new URL(url).pathname);
await page.waitForFunction(()=>window.bigfight.renderer.scene.getObjectByName('generated-scenery')?.userData.ready);
await page.waitForTimeout(400);
assert.equal(await page.evaluate(()=>window.bigfight.renderer.scene.children.flatMap(c=>c.children??[]).filter(c=>c.name==='generated-scenery').length),1);
assert.deepEqual(errors,[]);
writeFileSync('background-lab/campaign-captures/check-results.json',JSON.stringify({levels:result,errors,cameraCoverage:'passed: 3 viewports x 2 tiers x 3 camera extremes',failedLoad:'fallback retained',lateLoad:'disposed stage stayed removed'},null,2));
console.log('16 campaign levels, stage replacement, camera coverage, both quality tiers, failed load, and late disposal: passed.');
} finally {await browser.close()}
