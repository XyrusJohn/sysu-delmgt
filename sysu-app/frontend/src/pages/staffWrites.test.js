import {readFileSync} from 'node:fs';
import {test,expect,vi} from 'vitest';
const source=readFileSync('src/pages/dashboard.js','utf8');
function method(name,args,bindings) {
  const body=source.match(new RegExp(`async ${name}\\(${args}\\) \\{([\\s\\S]*?)\\n {2}\\}`))[1];
  return new Function(...Object.keys(bindings),`return async function(${args}) {${body}}`)(...Object.values(bindings));
}
test('R14 saving a driver uses the authenticated server and never writes another queue',async()=>{
  document.body.innerHTML=['drvFName','drvLName','drvPhone','drvLicense','drvTruckType','drvPlate','drvCompany','drvHelper','drvNotes'].map(id=>`<input id="${id}" value="Synthetic">`).join('');
  const direct=vi.fn(async()=>{throw new Error('Direct SDK staff writes denied');});
  const save=vi.fn(async()=>({success:true}));
  const alert=vi.fn();
  const context={state:{editDrvId:'driver-a',queue:[{id:'other',driverId:'driver-b',registrationComplete:false}]},closeDrvModal:vi.fn(),_renderAll:vi.fn(),_showToast:vi.fn(),_showErrorToast:vi.fn(),_notifyFailure:vi.fn()};
  await method('saveDriver','',{StaffDriverService:{save},setDoc:direct,updateDoc:direct,doc:()=>({}),db:{},document,alert,console,getDocs:direct,query:()=>({}),collection:()=>({}),where:()=>({})}).call(context);
  expect(save).toHaveBeenCalledWith('driver-a',expect.objectContaining({name:'Synthetic Synthetic'}));
  expect(direct).not.toHaveBeenCalled();
  expect(context.state.queue[0].registrationComplete).toBe(false);
});
test('R14 driver deletion uses guarded server path rather than direct SDK delete',async()=>{
  const remove=vi.fn(async()=>({success:true}));const direct=vi.fn();
  await method('deleteDriver','id',{StaffDriverService:{remove},deleteDoc:direct,doc:()=>({}),db:{},confirm:()=>true,document,console,alert:vi.fn(),setTimeout:vi.fn()}).call({},'driver-a');
  expect(remove).toHaveBeenCalledWith('driver-a');expect(direct).not.toHaveBeenCalled();
});
