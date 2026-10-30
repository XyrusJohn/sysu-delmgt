const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../app/src/main/java/com/sysu/go/activities/QueueDetailsActivity.kt'),'utf8');
test('POD capture/retake cannot partially write image independently of canonical shipment commit',()=>{assert.equal(source.includes('subCollectionRef.set('),false);assert.equal(source.includes('.delete()'),false);assert.match(source,/PodApiService/);});
