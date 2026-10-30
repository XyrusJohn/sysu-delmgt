const test=require('node:test');
const assert=require('node:assert/strict');
const {validateAssignment}=require('../../src/services/sapAssignmentPolicy');
const row={SAPDispatchNumber:'dispatch-a',TruckType:'4W',OBDNumber:'000001',Quantity:'10.500',ShipToPartyName:'Synthetic'};
const body={dispatchKey:'dispatch-a',truckType:'4w',lineItems:[{obdNumber:'000001',quantity:10.5,customerName:'Synthetic'}]};
test('SAP policy retains source ordering and customer fallback with leading-zero OBD IDs',()=>{
  const fallback={...row,ShipToPartyName:'',ShipToParty:'Synthetic'};
  assert.deepEqual(validateAssignment([fallback],body).lineItems,[{...body.lineItems[0],shipTo:'Synthetic'}]);
});
test('SAP policy rejects a client-selected type different from the dispatch group type',()=>{
  assert.equal(validateAssignment([row],{...body,truckType:'40F'}).status,409);
});
test('temporary review exception with blank SAP truck type remains non-assignable',()=>{
  assert.equal(validateAssignment([{...row,TruckType:''}],body).status,409);
});
test('SAP policy rejects malformed source customer types instead of throwing an internal error',()=>{
  assert.equal(validateAssignment([{...row,ShipToPartyName:123}],body).status,409);
});
test('SAP policy rejects incomplete, invalid and excessive source quantities without guessing',()=>{
  for(const patch of [{OBDNumber:''},{ShipToPartyName:''},{Quantity:'0'},{Quantity:'garbage'},{Quantity:'12junk'},{Quantity:'99999999999999999'}]) {
    assert.equal(validateAssignment([{...row,...patch}],body).status,409);
  }
});
test('SAP policy treats rows as a multiset rather than silently deduplicating an OBD',()=>{
  assert.equal(validateAssignment([row,row],{...body,lineItems:[body.lineItems[0],body.lineItems[0]]}).status,200);
  assert.equal(validateAssignment([row,row],body).status,409);
});
test('SAP policy carries verified destination and physical metrics into assignments',()=>{
  const source={...row,ShipToParty:'0010002870',Address:'Synthetic delivery address',Latitude:'14.6628',Longitude:'120.9578',Volume:'0.045',Weight:'21.36'};
  const lineItem={...body.lineItems[0],shipTo:'0010002870',deliveryAddress:'Synthetic delivery address',latitude:14.6628,longitude:120.9578,volume:0.045,weight:21.36};
  assert.deepEqual(validateAssignment([source],{...body,lineItems:[lineItem]}).lineItems,[lineItem]);
});
test('SAP policy fills new assignment identity fields from SAP for older clients',()=>{
  const source={...row,ShipToParty:'0010002870',Address:'Synthetic delivery address',Latitude:'14.6628',Longitude:'120.9578',Volume:'0.045',Weight:'21.36'};
  const result=validateAssignment([source],body);
  assert.equal(result.status,200);
  assert.equal(result.lineItems[0].shipTo,'0010002870');
  assert.equal(result.lineItems[0].deliveryAddress,'Synthetic delivery address');
  assert.equal(result.lineItems[0].weight,21.36);
});
test('SAP policy rejects client-forged destination and invalid coordinates',()=>{
  const source={...row,ShipToParty:'0010002870',Address:'Synthetic delivery address',Latitude:'14.6628',Longitude:'120.9578'};
  assert.equal(validateAssignment([source],{...body,lineItems:[{...body.lineItems[0],shipTo:'9999999999'}]}).status,409);
  assert.equal(validateAssignment([{...source,Latitude:'91'}],body).status,409);
});
