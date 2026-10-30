import {beforeEach, expect, test, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {io as clientIo} from 'socket.io-client';

vi.mock('../api/socket.js', () => ({EVENTS: {}, socket: {}, getDriverSocket: vi.fn(), getProfileSocket: vi.fn(() => null), connectDriverSocket: vi.fn()}));
vi.mock('../api/authService.js', () => ({AuthService: {}}));
vi.mock('../api/podService.js', () => ({PodService: {getPod: vi.fn()}}));
vi.mock('../api/sapService.js', () => ({SAPService: {fetchShipments: vi.fn(), fetchDispatchDetails: vi.fn(), parseDate: value => value || '—'}}));
import {Dashboard} from './dashboard.js';
import {getDriverSocket} from '../api/socket.js';
import {SAPService} from '../api/sapService.js';
import {PodService} from '../api/podService.js';
import * as MapManager from '../components/MapManager.js';
import {obdDeliveryStatus, queueDriverDisplayName, groupObdRowsByShipTo, driverAssignmentFields, mergeAssignmentGroups} from './shipmentDisplay.js';

//  Enable the sibling-repository integration path with SYSU_CROSS_REPO_TEST=1.
const goServerFixture = process.env.SYSU_CROSS_REPO_TEST === '1'
  ? createRequire(import.meta.url)('../../../../sysu-go/backend/tests/helpers/serverFixture.cjs').serverFixture
  : null;

const dispatch = '0010136559';
const stored = (tripStatus = 'returning_to_base') => ({
  driverId: 'test-driver', driverName: 'Test Driver', truckPlate: 'TEST-123', truckType: '4w', tripStatus,
  lineItems: [
    {obdNumber: '6801001522', customerName: 'Test Customer', actualDelDate: '/Date(1788912000000)/', quantity: 4, volume: 0.022, deliveryStatus: 'All Delivered', isPodCompleted: true, podImageUrl: 'saved_in_subcollection'},
    {obdNumber: '6801001523', customerName: 'Second Customer', quantity: 6, isPodCompleted: true, podImageUrl: 'saved_in_subcollection'},
  ],
});
let dashboard;
test.each([
  ['All Delivered', true, 'Delivered'],
  ['Rejected', true, 'Rejected'],
  ['Delivered w/ Rejection', true, 'Delivered w/ rejection'],
  ['  ALL DELIVERED  ', true, 'Delivered'],
  ['All Delivered', false, 'Pending POD'],
  [undefined, true, 'Unknown'],
  ['<img src=x onerror=alert(1)>', true, 'Unknown'],
  [42, true, 'Unknown'],
])('OBD outcome %s with completion %s displays %s', (deliveryStatus, isPodCompleted, expected) => {
  expect(obdDeliveryStatus({deliveryStatus, isPodCompleted})).toBe(expected);
});

test('absent POD data stays pending', () => {
  expect(obdDeliveryStatus(undefined)).toBe('Pending POD');
});

test('sidebar operations summary counts unique active, returning, and queued drivers', () => {
  document.body.insertAdjacentHTML('beforeend', '<span id="fleetStatTransit"></span><span id="fleetStatQueue"></span><span id="fleetStatReturning"></span>');
  dashboard.state.sapAssignments = {
    transitA: {driverId: 'driver-a', tripStatus: 'in_transit'},
    transitB: {driverId: 'driver-a', tripStatus: 'in_transit'},
    returning: {driverId: 'driver-b', tripStatus: 'returning_to_base'},
  };
  dashboard.state.liveTracking = {
    'driver-a': {driverId: 'driver-a', tripStatus: 'in_transit'},
    'driver-c': {driverId: 'driver-c', status: 'returning_to_base'},
  };
  dashboard.state.queue = [
    {id: 'queue-a', driverId: 'driver-d', status: 'waiting', registrationComplete: true},
    {id: 'queue-b', driverId: 'driver-d', status: 'waiting', registrationComplete: true},
    {id: 'queue-c', driverId: 'driver-e', status: 'waiting', registrationComplete: false},
    {id: 'queue-d', driverId: 'driver-f', status: 'completed', registrationComplete: true},
  ];

  dashboard._renderFleetOperations();

  expect(document.getElementById('fleetStatTransit').textContent).toBe('1');
  expect(document.getElementById('fleetStatQueue').textContent).toBe('1');
  expect(document.getElementById('fleetStatReturning').textContent).toBe('2');
});

test('Driver Directory searches company and name without status labels and focuses valid zero coordinates', () => {
  document.body.insertAdjacentHTML('beforeend', '<input id="driverDirectorySearch"><span id="fleetDirectoryCount"></span><div id="fleetTree"></div>');
  dashboard.state.drivers = [
    {id: 'driver-a', name: 'Alice Driver', truckingCompany: 'Acme Transit'},
    {id: 'driver-b', name: 'Bob Driver', truckingCompany: 'Beta Freight'},
    {id: 'driver-c', name: 'Casey Driver'},
  ];
  dashboard.state.liveTracking = {
    'driver-a': {driverId: 'driver-a', lat: 0, lng: 0, status: 'online'},
  };
  dashboard._renderFleetTree();

  const tree = document.getElementById('fleetTree');
  expect(document.getElementById('fleetDirectoryCount').textContent).toBe('3 drivers');
  expect(tree.textContent).toContain('Other');
  expect(tree.textContent).not.toMatch(/\b(Online|Offline|In transit|Returning|Stopped|Stale)\b/);
  const focus = vi.spyOn(MapManager, 'focusOnLocation');
  tree.querySelector('[data-focus-driver="driver-a"]').click();
  expect(focus).toHaveBeenCalledWith(0, 0);
  focus.mockRestore();

  const search = document.getElementById('driverDirectorySearch');
  search.value = 'beta';
  search.dispatchEvent(new Event('input'));
  expect(tree.textContent).toContain('Bob Driver');
  expect(tree.textContent).toContain('Beta Freight');
  expect(tree.textContent).not.toContain('Alice Driver');
  expect(tree.querySelector('details').open).toBe(true);
  expect(document.getElementById('fleetDirectoryCount').textContent).toBe('1 driver');
});

test('Driver Directory preserves expanded company groups during live refreshes', () => {
  document.body.insertAdjacentHTML('beforeend', '<input id="driverDirectorySearch"><span id="fleetDirectoryCount"></span><div id="fleetTree"></div>');
  dashboard.state.drivers = [
    {id: 'driver-a', name: 'Alice Driver', truckingCompany: 'Acme Transit'},
    {id: 'driver-b', name: 'Bob Driver', truckingCompany: 'Beta Freight'},
  ];
  dashboard._renderFleetTree();

  const tree = document.getElementById('fleetTree');
  tree.querySelector('[data-company="Acme Transit"]').open = true;
  dashboard.state.liveTracking = {'driver-a': {driverId: 'driver-a', status: 'online'}};
  dashboard._renderFleetTree();

  expect(tree.querySelector('[data-company="Acme Transit"]').open).toBe(true);
  expect(tree.querySelector('[data-company="Beta Freight"]').open).toBe(false);
});

test('Driver Directory restores expanded groups after a search with no matches', () => {
  document.body.insertAdjacentHTML('beforeend', '<input id="driverDirectorySearch"><span id="fleetDirectoryCount"></span><div id="fleetTree"></div>');
  dashboard.state.drivers = [
    {id: 'driver-a', name: 'Alice Driver', truckingCompany: 'Acme Transit'},
    {id: 'driver-b', name: 'Bob Driver', truckingCompany: 'Beta Freight'},
  ];
  dashboard._renderFleetTree();

  const tree = document.getElementById('fleetTree');
  tree.querySelector('[data-company="Acme Transit"]').open = true;
  const search = document.getElementById('driverDirectorySearch');
  search.value = 'no matching driver';
  search.dispatchEvent(new Event('input'));
  expect(tree.querySelector('details')).toBeNull();

  search.value = '';
  search.dispatchEvent(new Event('input'));
  expect(tree.querySelector('[data-company="Acme Transit"]').open).toBe(true);
  expect(tree.querySelector('[data-company="Beta Freight"]').open).toBe(false);
});

test('live scans show skeleton rows while the initial location snapshot is loading', () => {
  document.body.insertAdjacentHTML('beforeend', '<div id="tableWrap" class="flex-1 min-h-0 overflow-hidden"></div>');
  dashboard.state.liveScansLoading = true;

  dashboard._renderLiveScansTable();

  const container = document.getElementById('tableWrap');
  expect(container.querySelector('[aria-label="Loading live scans"]')).not.toBeNull();
  expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
  expect(container.firstElementChild.classList.contains('overflow-y-auto')).toBe(true);
  expect(container.textContent).not.toContain('No active drivers');
});

test('dashboard navigation omits the standalone tracking entry and obsolete live-scan filters', () => {
  const html = readFileSync(resolve(globalThis.process.cwd(), 'dashboard.html'), 'utf8');

  expect(html).not.toContain('id="rTracking"');
  expect(html).not.toContain('id="lTracking"');
  expect(html).not.toContain('data-tab="transit"');
  expect(html).not.toContain('data-tab="delivered"');
  expect(html).toContain('id="liveScansResizeHandle"');
  expect(html).toContain('data-tab="all"');
});

test('Live Scans panel defaults expanded and its handle collapses and restores it', () => {
  document.body.insertAdjacentHTML('beforeend', `
    <div id="mainContent">
      <section id="resizePanel" style="height: 0px">
        <button id="liveScansResizeHandle" aria-expanded="true"></button>
        <div id="liveScansHeader"><span data-live-scans-detail></span><div id="shipmentTabs"></div></div>
        <div id="tableWrap"></div>
      </section>
    </div>`);

  dashboard._initLiveScansPanel();
  const panel = document.getElementById('resizePanel');
  const handle = document.getElementById('liveScansResizeHandle');

  expect(panel.style.height).toBe('240px');
  expect(handle.getAttribute('aria-expanded')).toBe('true');
  handle.click();
  expect(panel.style.height).toBe('56px');
  expect(handle.getAttribute('aria-expanded')).toBe('false');
  expect(document.getElementById('tableWrap').classList.contains('hidden')).toBe(true);
  handle.click();
  expect(panel.style.height).toBe('240px');
  expect(document.getElementById('tableWrap').classList.contains('hidden')).toBe(false);
});

test('Live Scans resize handle supports pointer dragging and keyboard adjustments', () => {
  document.body.insertAdjacentHTML('beforeend', `
    <div id="mainContent">
      <section id="resizePanel" style="height: 240px">
        <button id="liveScansResizeHandle" aria-expanded="true"></button>
        <div id="liveScansHeader"><span data-live-scans-detail></span><div id="shipmentTabs"></div></div>
        <div id="tableWrap"></div>
      </section>
    </div>`);

  dashboard._initLiveScansPanel();
  const handle = document.getElementById('liveScansResizeHandle');
  const panel = document.getElementById('resizePanel');
  handle.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true, button: 0, clientY: 100}));
  window.dispatchEvent(new MouseEvent('pointermove', {clientY: 50}));
  window.dispatchEvent(new MouseEvent('pointerup'));
  handle.click();
  expect(panel.style.height).toBe('290px');

  handle.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}));
  expect(panel.style.height).toBe('266px');
  handle.dispatchEvent(new KeyboardEvent('keydown', {key: 'Home', bubbles: true}));
  expect(panel.style.height).toBe('56px');
});

test('Live Scans resize handle does not swallow clicks after an outside release or canceled drag', async () => {
  document.body.insertAdjacentHTML('beforeend', `
    <div id="mainContent">
      <section id="resizePanel" style="height: 240px">
        <button id="liveScansResizeHandle" aria-expanded="true"></button>
        <div id="liveScansHeader"><span data-live-scans-detail></span><div id="shipmentTabs"></div></div>
        <div id="tableWrap"></div>
      </section>
    </div>`);

  dashboard._initLiveScansPanel();
  const handle = document.getElementById('liveScansResizeHandle');
  const panel = document.getElementById('resizePanel');
  handle.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true, button: 0, clientY: 100}));
  window.dispatchEvent(new MouseEvent('pointermove', {clientY: 70}));
  window.dispatchEvent(new MouseEvent('pointerup'));
  await new Promise(resolve => setTimeout(resolve, 0));
  handle.click();
  expect(panel.style.height).toBe('56px');

  handle.click();
  handle.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true, button: 0, clientY: 100}));
  window.dispatchEvent(new MouseEvent('pointermove', {clientY: 70}));
  window.dispatchEvent(new Event('pointercancel'));
  handle.click();
  expect(panel.style.height).toBe('56px');
});

test('live scan rows resolve generic socket metadata from the active assignment', () => {
  document.body.insertAdjacentHTML('beforeend', '<div id="tableWrap" class="flex-1 min-h-0 overflow-hidden"></div>');
  dashboard.state.liveScansLoading = false;
  dashboard.state.liveScans['driver-uid'] = {
    driverId: 'driver-uid', name: 'Driver', lat: 14.5, lng: 121, status: 'online', lastSeen: Date.now(),
  };
  dashboard.state.sapAssignments = {
    '0010123456': {driverId: 'driver-uid', driverName: 'Synthetic Driver', truckPlate: 'SYN-123', tripStatus: 'in_transit'},
  };

  dashboard._renderLiveScansTable();

  const row = document.querySelector('#tableWrap tbody tr');
  expect(row.closest('.overflow-y-auto')).not.toBeNull();
  expect(row.children[0].textContent).toBe('0010123456');
  expect(row.children[1].textContent).toContain('Synthetic Driver');
  expect(row.children[2].textContent).toBe('SYN-123');
});

test('live location is removed when its linked assignment becomes completed', () => {
  const remove = vi.spyOn(MapManager, 'removeMarker');
  const now = Date.now();
  dashboard.state.liveTracking['driver-uid'] = {driverId: 'driver-uid', sapDocId: dispatch, lat: 14.5, lng: 121, timestamp: now - 1000};
  dashboard.state.liveScans['driver-uid'] = {...dashboard.state.liveTracking['driver-uid']};
  dashboard.state.sapAssignments[dispatch] = {driverId: 'driver-uid', tripStatus: 'completed'};

  dashboard._reconcileLiveScansWithAssignments(dashboard.state.sapAssignments);

  expect(dashboard.state.liveTracking['driver-uid']).toBeUndefined();
  expect(dashboard.state.liveScans['driver-uid']).toBeUndefined();
  expect(remove).toHaveBeenCalledWith('driver-uid', 'map');
  expect(dashboard._applyTrackingUpdate({driverId: 'driver-uid', sapDocId: dispatch, lat: 14.5, lng: 121, timestamp: now}, 'location')).toBeNull();
  remove.mockRestore();
});

test('SYSU Go socket fixes update Overview state and the map marker', async () => {
  const handlers = new Map();
  getDriverSocket.mockReturnValue({
    connected: true,
    on: vi.fn((event, handler) => handlers.set(event, handler)),
  });
  const updateMarker = vi.spyOn(MapManager, 'updateMarker');

  await dashboard._setupDriverLocationSocket();
  handlers.get('update_admin_map')({
    driverId: 'live-driver',
    lat: 14.7,
    lng: 121.2,
    status: 'online',
    timestamp: Date.now(),
  });

  expect(dashboard.state.liveTracking['live-driver']).toMatchObject({lat: 14.7, lng: 121.2});
  expect(updateMarker).toHaveBeenCalledWith(expect.objectContaining({
    driverId: 'live-driver', lat: 14.7, lng: 121.2,
  }), 'map');
  clearInterval(dashboard._locationAgeTimer);
  updateMarker.mockRestore();
});

test.skipIf(!goServerFixture)('authenticated Go GPS saves move the real Overview Leaflet marker over Socket.IO', async () => {
  const fixture = await goServerFixture();
  const sockets = [];
  let mapStarted = false;
  const connect = async uid => {
    const client = clientIo(fixture.url, {
      autoConnect: false, transports: ['websocket'], reconnection: false,
      auth: {token: fixture.token(uid)},
    });
    sockets.push(client);
    const ready = new Promise((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    client.connect();
    await ready;
    return client;
  };
  try {
    document.body.insertAdjacentHTML('beforeend', '<div id="map"></div>');
    const container = document.getElementById('map');
    Object.defineProperties(container, {
      clientWidth: {configurable: true, value: 1200},
      clientHeight: {configurable: true, value: 700},
    });
    container.getBoundingClientRect = () => ({width: 1200, height: 700, left: 0, top: 0, right: 1200, bottom: 700});
    MapManager.initLeafletMap('map');
    mapStarted = true;
    dashboard.state.sapAssignments = {'own-a': {driverId: 'driver-a', tripStatus: 'in_transit'}};
    dashboard.state.sapDocCache['own-a'] = {shipmentNumber: 'own-a', tripStatus: 'in_transit'};
    const staff = await connect('staff-a');
    getDriverSocket.mockReturnValue(staff);
    await dashboard._setupDriverLocationSocket();
    const driver = await connect('driver-a');
    const sendFix = async (lat, timestamp) => {
      const received = new Promise(resolve => staff.once('update_admin_map', resolve));
      const accepted = new Promise((resolve, reject) => {
        driver.timeout(3000).emit('driver_moving', {
          driverId: 'driver-a', sapDocId: 'own-a', lat, lng: 121,
          timestamp, accuracyMeters: 5,
        }, (error, response) => error ? reject(error) : resolve(response));
      });
      const [event, response] = await Promise.all([received, accepted]);
      expect(response.ok).toBe(true);
      expect(event).toMatchObject({driverId: 'driver-a', sapDocId: 'own-a', lat, lng: 121});
      expect(fixture.state.savedLocation).toMatchObject({driverId: 'driver-a', sapAssignmentId: 'own-a', lat, lng: 121});
    };
    const firstTime = Date.now() - 1000;
    await sendFix(14.5, firstTime);
    const marker = MapManager.markers['driver-a'];
    expect(marker.getLatLng().lat).toBe(14.5);
    await sendFix(14.6, firstTime + 500);
    expect(MapManager.markers['driver-a']).toBe(marker);
    expect(marker.getLatLng().lat).toBe(14.6);
    expect(dashboard.state.liveTracking['driver-a'].lat).toBe(14.6);
  } finally {
    clearInterval(dashboard._locationAgeTimer);
    sockets.forEach(client => client.close());
    if (mapStarted) MapManager.disposeLeafletMap('map');
    await fixture.close();
  }
}, 10000);

test('live location remains visible while its assignment is returning to base', () => {
  const location = {driverId: 'driver-uid', sapDocId: dispatch, lat: 14.5, lng: 121, timestamp: Date.now()};
  dashboard.state.liveTracking['driver-uid'] = location;
  dashboard.state.liveScans['driver-uid'] = {...location};
  dashboard.state.sapAssignments[dispatch] = {driverId: 'driver-uid', tripStatus: 'returning_to_base'};

  dashboard._reconcileLiveScansWithAssignments(dashboard.state.sapAssignments);

  expect(dashboard.state.liveTracking['driver-uid']).toBe(location);
  expect(dashboard.state.liveScans['driver-uid'].sapDocId).toBe(dispatch);
});

test('when one linked shipment completes, live tracking follows another active shipment for the driver', () => {
  const location = {driverId: 'driver-uid', sapDocId: 'old-dispatch', lat: 14.5, lng: 121, timestamp: Date.now() - 1000};
  dashboard.state.liveTracking['driver-uid'] = location;
  dashboard.state.liveScans['driver-uid'] = {...location};
  dashboard.state.sapAssignments = {
    'old-dispatch': {driverId: 'driver-uid', tripStatus: 'completed'},
    'next-dispatch': {driverId: 'driver-uid', tripStatus: 'in_transit'},
  };

  dashboard._reconcileLiveScansWithAssignments(dashboard.state.sapAssignments);

  expect(dashboard.state.liveTracking['driver-uid'].sapDocId).toBe('next-dispatch');
  expect(dashboard.state.liveScans['driver-uid'].shipmentNumber).toBe('next-dispatch');
  expect(dashboard._applyTrackingUpdate({driverId: 'driver-uid', sapDocId: 'old-dispatch', lat: 14.6, lng: 121.1,
    timestamp: Date.now() + 1}, 'location')).toBeNull();
  const linkedLocation = dashboard.state.liveTracking['driver-uid'];
  expect(dashboard._applyTrackingUpdate({driverId: 'driver-uid', status: 'completed', timestamp: Date.now() + 2}, 'status')).toBeNull();
  expect(dashboard.state.liveTracking['driver-uid']).toBe(linkedLocation);
});

test('same Ship-To customer and location collapse to additive summary with expandable OBD details', () => {
  const location = {
    ShipToParty: '0010002870', ShipToPartyName: 'Robinsons Supermarket - Malabon',
    Address: 'Ca Road DagatDagatan Cor., 1475, Letre M', Latitude: 14.6628, Longitude: 120.9578,
  };
  const rows = [
    {...location, OBDNumber: '6051578245', Amount: '5539.31', Volume: '0.045', Weight: '21.360', Quantity: '7.000'},
    {...location, ShipToPartyName: '  ROBINSONS   SUPERMARKET - MALABON ', Latitude: '14.662800', Longitude: '120.957800', OBDNumber: '6051578246', Amount: '5539.31', Volume: '0.045', Weight: '21.360', Quantity: '7.000'},
  ];
  dashboard.state.sapGroupedByDispatch[dispatch] = rows;
  dashboard.state.sapAssignments[dispatch] = {
    tripStatus: 'in_transit',
    lineItems: [
      {obdNumber: '6051578245', isPodCompleted: true, deliveryStatus: 'All Delivered', podImageUrl: 'saved_in_subcollection'},
      {obdNumber: '6051578246', isPodCompleted: true, deliveryStatus: 'Rejected', podImageUrl: 'saved_in_subcollection'},
    ],
  };

  dashboard.openSapDispatchDetail(dispatch);

  const lines = document.getElementById('sapDtlOBDLines');
  const [summaryRow, detailsRow] = lines.querySelectorAll(':scope > tr');
  expect(lines.querySelectorAll(':scope > tr')).toHaveLength(2);
  expect(summaryRow.children[0].textContent).toContain('2 OBDs');
  expect([...summaryRow.children].map(cell => cell.textContent)).toContain('PHP 11,078.62');
  expect([...summaryRow.children].map(cell => cell.textContent)).toContain('0.090');
  expect([...summaryRow.children].map(cell => cell.textContent)).toContain('42.720');
  expect([...summaryRow.children].map(cell => cell.textContent)).toContain('14.000');
  expect(summaryRow.querySelector('[data-pod-status]').textContent).toBe('Mixed');
  expect(document.getElementById('sapDtlTotalAmount').textContent).toBe('PHP 11,078.62');
  expect(detailsRow.hidden).toBe(true);
  expect(detailsRow.textContent).toContain('6051578245');
  expect(detailsRow.textContent).toContain('6051578246');
  expect(detailsRow.querySelectorAll('[data-pod-status]')).toHaveLength(2);
  expect([...detailsRow.querySelectorAll('[data-pod-status]')].map(cell => cell.textContent)).toEqual(['Delivered', 'Rejected']);
  expect(summaryRow.querySelectorAll('[data-obd-group-preview]')).toHaveLength(1);
  expect(summaryRow.querySelector('[data-obd-group-preview]').textContent).toBe('Preview');
  const expectedColumns = ['OBD Number', 'Amount', 'Volume (m³)', 'Weight (kg)', 'Quantity', 'Ship-To', 'Customer Name', 'Delivery Address', 'Latitude', 'Longitude', 'POD Preview', 'Delivery Status'];
  expect([...summaryRow.querySelectorAll(':scope > td')].map(cell => cell.dataset.label)).toEqual(expectedColumns);
  expect(detailsRow.querySelectorAll('button[title="Preview POD"]')).toHaveLength(0);
  const previewGroup = vi.spyOn(dashboard, 'openObdPodGroupPreview').mockResolvedValue();
  summaryRow.querySelector('[data-obd-group-preview]').click();
  expect(previewGroup).toHaveBeenCalledWith(0);

  const toggle = summaryRow.querySelector('[data-obd-group-toggle]');
  toggle.click();
  expect(detailsRow.hidden).toBe(false);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  toggle.click();
  expect(detailsRow.hidden).toBe(true);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
});

test('OBDs with missing location data or different customer locations are not merged', () => {
  const rows = [
    {ShipToParty: '1', ShipToPartyName: 'Same', Address: 'Address A', OBDNumber: 'a'},
    {ShipToParty: '1', ShipToPartyName: 'Same', Address: 'Address B', OBDNumber: 'b'},
    {ShipToParty: '1', ShipToPartyName: 'Different customer', Address: 'Address A', OBDNumber: 'c'},
    {ShipToParty: '1', ShipToPartyName: 'Same', OBDNumber: 'd'},
    {ShipToParty: '1', ShipToPartyName: 'Same', OBDNumber: 'e'},
  ];
  expect(groupObdRowsByShipTo(rows).map(group => group.map(row => row.OBDNumber))).toEqual([['a'], ['b'], ['c'], ['d'], ['e']]);
});

test('destination grouping requires complete identity and uses six-decimal coordinate equivalence', () => {
  const destination = {ShipToParty: '1', ShipToPartyName: 'Same', Address: 'Address A', Latitude: 14.6628001, Longitude: 120.9578001};
  const rows = [
    {...destination, OBDNumber: 'a'},
    {...destination, Latitude: '14.6628004', Longitude: '120.9578004', OBDNumber: 'b'},
    {...destination, Latitude: '', OBDNumber: 'c'},
    {...destination, Longitude: '181', OBDNumber: 'd'},
  ];
  expect(groupObdRowsByShipTo(rows).map(group => group.map(row => row.OBDNumber))).toEqual([['a', 'b'], ['c'], ['d']]);
});

test('assignment queue name falls back to the matching driver profile by UID', () => {
  const drivers = [{id: 'driver-uid', name: 'Profile Driver'}];
  expect(queueDriverDisplayName({id: 'queue-doc', driverId: 'driver-uid'}, drivers)).toBe('Profile Driver');
  expect(queueDriverDisplayName({id: 'driver-uid'}, drivers)).toBe('Profile Driver');
  expect(queueDriverDisplayName({id: 'driver-uid', driverName: 'Queue Driver'}, drivers)).toBe('Queue Driver');
  expect(queueDriverDisplayName({id: 'missing'}, drivers)).toBe('Unknown Driver');
  dashboard.state.drivers = drivers;
  dashboard.state.queue = [{id: 'queue-doc', driverId: 'driver-uid', truckType: '4W', status: 'waiting'}];
  expect(dashboard._getAvailableDrivers('4W')[0].driverName).toBe('Profile Driver');
});

test.each([
  ['assigned', 1],
  ['loading', 1],
  ['loaded', 1],
  ['fully_loaded', 1],
  ['completed', 0],
  ['in_transit', 0],
  ['returning_to_base', 0],
])('assignment history with status %s yields %i selectable drivers', (tripStatus, expectedCount) => {
  dashboard.state.queue = [{id: 'queue-doc', driverId: 'driver-uid', truckType: 'AUV', status: 'waiting', isAssigned: true}];
  dashboard.state.sapAssignments = {
    previous: {driverId: 'driver-uid', queueId: 'queue-doc', driverName: 'Profile Driver', truckType: 'AUV', tripStatus},
  };

  const available = dashboard._getAvailableDrivers('auv');

  expect(available).toHaveLength(expectedCount);
  if (expectedCount) {
    expect(available[0]._fromAssignment).toBe(true);
    expect(available[0]._hasActiveLoad).toBe(false);
  }
});

test('a pre-transit assignment in another queue session cannot make a new scan selectable', () => {
  dashboard.state.queue = [{id: 'new-queue-doc', driverId: 'driver-uid', truckType: 'AUV', status: 'waiting', isAssigned: false, registrationComplete: true}];
  dashboard.state.sapAssignments = {
    previous: {driverId: 'driver-uid', queueId: 'old-queue-doc', truckType: 'AUV', tripStatus: 'loading'},
  };

  expect(dashboard._getAvailableDrivers('auv')).toHaveLength(0);
});

test('an in-transit queue status locks assignment even if an assignment snapshot is stale', () => {
  dashboard.state.queue = [{id: 'queue-doc', driverId: 'driver-uid', truckType: 'AUV', status: 'in_transit', isAssigned: true}];
  dashboard.state.sapAssignments = {
    previous: {driverId: 'driver-uid', queueId: 'queue-doc', truckType: 'AUV', tripStatus: 'loaded'},
  };

  expect(dashboard._getAvailableDrivers('auv')).toHaveLength(0);
});

test('new QR queue session is visible despite a completed prior session', () => {
  dashboard.state.queue = [{id: 'new-queue-doc', driverId: 'driver-uid', truckType: 'AUV', status: 'waiting', isAssigned: false, registrationComplete: true}];
  dashboard.state.sapAssignments = {
    previous: {driverId: 'driver-uid', queueId: 'old-queue-doc', truckType: 'AUV', tripStatus: 'completed'},
  };

  const available = dashboard._getAvailableDrivers('auv');

  expect(available).toHaveLength(1);
  expect(available[0].id).toBe('new-queue-doc');
  expect(available[0]._fromAssignment).toBe(false);
});

test('completed current QR queue session is neither Queue nor Assigned', () => {
  dashboard.state.queue = [{id: 'queue-doc', driverId: 'driver-uid', truckType: 'AUV', status: 'waiting', isAssigned: false, registrationComplete: true}];
  dashboard.state.sapAssignments = {
    previous: {driverId: 'driver-uid', queueId: 'queue-doc', truckType: 'AUV', tripStatus: 'completed'},
  };

  expect(dashboard._getAvailableDrivers('auv')).toHaveLength(0);
});

test('assigned driver truck type falls back to queue matched by auth UID', () => {
  dashboard.state.queue = [{id: 'auto-queue-doc', driverId: 'driver-uid', truckType: 'AUV', status: 'waiting', isAssigned: true}];
  dashboard.state.drivers = [];
  dashboard.state.sapAssignments = {
    previous: {driverId: 'driver-uid', queueId: 'auto-queue-doc', tripStatus: 'assigned'},
  };

  const available = dashboard._getAvailableDrivers('auv');

  expect(available).toHaveLength(1);
  expect(available[0].truckType).toBe('AUV');
  expect(available[0]._fromAssignment).toBe(true);
});

test('completed history from separate accounts with the same display name stays out of Assigned', () => {
  dashboard.state.queue = [
    {id: 'old-queue-a', driverId: 'uid-a', truckType: 'AUV', status: 'loading', isAssigned: true},
    {id: 'old-queue-b', driverId: 'uid-b', truckType: 'AUV', status: 'loading', isAssigned: true},
    {id: 'new-queue-a', driverId: 'uid-a', truckType: 'AUV', status: 'waiting', isAssigned: false, registrationComplete: true},
  ];
  dashboard.state.sapAssignments = {
    oldA: {driverId: 'uid-a', queueId: 'old-queue-a', driverName: 'Same Name', truckPlate: 'SYN-123', tripStatus: 'completed'},
    oldB: {driverId: 'uid-b', queueId: 'old-queue-b', driverName: 'Same Name', truckPlate: 'SYN-123', tripStatus: 'completed'},
  };

  const available = dashboard._getAvailableDrivers('auv');
  expect(available).toHaveLength(1);
  expect(available[0].id).toBe('new-queue-a');
  expect(available[0]._fromAssignment).toBe(false);
});

test('Assigned uses the current QR queue ID when an older queue exists for the same UID', () => {
  dashboard.state.queue = [
    {id: 'old-queue', driverId: 'driver-uid', truckType: 'AUV', status: 'loading', isAssigned: true},
    {id: 'current-queue', driverId: 'driver-uid', truckType: 'AUV', status: 'loading', isAssigned: true},
  ];
  dashboard.state.sapAssignments = {
    old: {driverId: 'driver-uid', queueId: 'old-queue', truckType: 'AUV', tripStatus: 'completed'},
    current: {driverId: 'driver-uid', queueId: 'current-queue', truckType: 'AUV', tripStatus: 'loaded'},
  };

  const available = dashboard._getAvailableDrivers('auv');
  expect(available).toHaveLength(1);
  expect(available[0].id).toBe('current-queue');
  expect(available[0].driverId).toBe('driver-uid');
  expect(available[0]._fromAssignment).toBe(true);
});

test('legacy assignment without queueId needs an explicit dispatch link to its current queue', () => {
  dashboard.state.queue = [{id: 'queue-doc', driverId: 'driver-uid', truckType: 'AUV', status: 'loading', isAssigned: true}];
  dashboard.state.sapAssignments = {
    current: {driverId: 'driver-uid', truckType: 'AUV', tripStatus: 'loaded'},
  };
  expect(dashboard._getAvailableDrivers('auv')).toHaveLength(0);

  dashboard.state.queue[0].assignedShipment = 'current';
  expect(dashboard._getAvailableDrivers('auv')[0].id).toBe('queue-doc');
});

test('two open assigned sessions for one UID cannot produce an ambiguous Assigned row', () => {
  dashboard.state.queue = [
    {id: 'queue-one', driverId: 'driver-uid', truckType: 'AUV', status: 'loading', isAssigned: true},
    {id: 'queue-two', driverId: 'driver-uid', truckType: 'AUV', status: 'loading', isAssigned: true},
  ];
  dashboard.state.sapAssignments = {
    one: {driverId: 'driver-uid', queueId: 'queue-one', truckType: 'AUV', tripStatus: 'assigned'},
    two: {driverId: 'driver-uid', queueId: 'queue-two', truckType: 'AUV', tripStatus: 'assigned'},
  };

  expect(dashboard._getAvailableDrivers('auv')).toHaveLength(0);
});
beforeEach(() => {
  document.body.innerHTML = '<table><tbody id="sapBody"></tbody><tbody id="sapDtlOBDLines"></tbody></table><input id="sapSearch"><span id="sapStatAll"></span><span id="sapStatDel"></span><span id="sapStatTransit"></span><span id="sapResultCount"></span><div id="sapDispatchDetail" class="hidden"><div id="sapDtlDataWarning" role="alert" hidden><span></span><button data-action="sap-detail-retry"></button></div><span id="sapDtlPlanDate"></span><span id="sapDtlActualDate"></span><span id="sapDtlTotalAmount"></span><span id="sapDtlTotalVolume"></span><span id="sapDtlTotalWeight"></span><span id="sapDtlTotalQty"></span></div>';
  dashboard = new Dashboard();
  dashboard.state.sapLoading = false;
  dashboard.state.driversLoading = false;
  dashboard.state.queueLoading = false;
  dashboard.state.assignmentsLoading = false;
  dashboard.state.guardsLoading = false;
  dashboard.state.truckCompaniesLoading = false;
  dashboard.state.sapAssignments = {[dispatch]: stored()};
  SAPService.fetchShipments.mockResolvedValue([]);
  SAPService.fetchDispatchDetails.mockResolvedValue({});
});
test('fleet, orders, and directory show loading, then empty or error states after subscription settles', () => {
  dashboard.state.sapAssignments = {};
  document.body.insertAdjacentHTML('beforeend', '<div id="fleetContent"><div id="fleetBody"></div></div><div id="ordersBody"></div><div id="fleetTree"></div><span id="fleetDirectoryCount"></span>');
  dashboard.state.driversLoading = true;
  dashboard.state.queueLoading = true;
  dashboard.state.assignmentsLoading = true;
  dashboard._renderFleetTree();
  dashboard.renderFleet();
  dashboard.renderOrders();
  expect(document.querySelector('[aria-label="Loading driver directory"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Loading fleet queue"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Loading assignments"]')).not.toBeNull();
  dashboard.state.driversLoading = false;
  dashboard.state.queueLoading = false;
  dashboard.state.assignmentsLoading = false;
  dashboard.state.driversLoadError = true;
  dashboard._renderFleetTree();
  dashboard.renderFleet();
  dashboard.renderOrders();
  expect(document.getElementById('fleetTree').textContent).toContain('unavailable');
  expect(document.getElementById('fleetBody').textContent).toContain('No drivers in queue');
  expect(document.getElementById('ordersBody').textContent).toContain('No confirmed assignments yet');
});
test('guard and truck-company lists keep loading separate from empty and error states', () => {
  document.body.insertAdjacentHTML('beforeend', '<div id="guardListBody"></div><div id="tcListBody"></div>');
  dashboard.state.guardsLoading = true;
  dashboard.state.truckCompaniesLoading = true;
  dashboard._refreshGuardList();
  dashboard._refreshTcList();
  expect(document.querySelector('[aria-label="Loading security guards"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Loading truck companies"]')).not.toBeNull();
  dashboard.state.guardsLoading = false;
  dashboard.state.truckCompaniesLoading = false;
  dashboard.state.guardsLoadError = true;
  dashboard._refreshGuardList();
  dashboard._refreshTcList();
  expect(document.getElementById('guardListBody').textContent).toContain('unavailable');
  expect(document.getElementById('tcListBody').textContent).toContain('No truck companies yet');
});
test('role requests show a skeleton before initial socket data and an error after failure', () => {
  document.body.insertAdjacentHTML('beforeend', '<div id="docsListContainer"></div>');
  dashboard.state.roleRequestsLoading = true;
  dashboard._renderRoleRequestsInDocs();
  expect(document.querySelector('[aria-label="Loading role requests"]')).not.toBeNull();
  dashboard.state.roleRequestsLoading = false;
  dashboard.state.roleRequestsLoadError = true;
  dashboard._renderRoleRequestsInDocs();
  expect(document.getElementById('docsListContainer').textContent).toContain('unavailable');
});
test('SAP table distinguishes initial loading from a confirmed empty response', async () => {
  dashboard.state.sapAssignments = {};
  dashboard.state.sapLoading = true;
  dashboard._renderSapTable();
  expect(document.querySelector('[aria-label="Loading shipments"]')).not.toBeNull();
  expect(document.getElementById('sapBody').textContent).not.toContain('No shipments available');
  await dashboard._syncSAP(true);
  dashboard._renderSapTable();
  expect(document.querySelector('[aria-label="Loading shipments"]')).toBeNull();
  expect(document.getElementById('sapBody').textContent).toContain('No shipments available');
});
async function render(filter = 'all') {
  await dashboard._syncSAP(true);
  dashboard.state.sapFilter = filter;
  dashboard._renderSapTable();
  return document.getElementById('sapBody');
}

test('stored assignment renders when absent from the unassigned SAP feed', async () => {
  const body = await render();
  expect(body.textContent).toContain('10136559');
  expect(body.textContent).toContain('Test Driver');
  expect(document.getElementById('sapStatAll').textContent).toBe('1');
});
test('completed trips remain visible in Delivered even with no SAP rows', async () => {
  dashboard.state.sapAssignments[dispatch] = stored('completed');
  expect((await render('delivered')).textContent).toContain('Test Driver');
});
test('returning shipment with all OBD PODs complete appears in Delivered with OBD previews', async () => {
  expect((await render('delivered')).textContent).toContain('Test Driver');
  expect(document.getElementById('sapStatDel').textContent).toBe('1');
  dashboard.openSapDispatchDetail(dispatch);
  const detail = document.getElementById('sapDtlOBDLines');
  expect(detail.textContent).toContain('6801001522');
  expect(detail.textContent).toContain('6801001523');
  expect(detail.textContent).toContain('Test Customer');
  expect(detail.querySelectorAll('button')).toHaveLength(2);
});
test('returning shipment with an incomplete OBD is not labelled delivered', async () => {
  dashboard.state.sapAssignments[dispatch].lineItems[1].isPodCompleted = false;
  const body = await render('delivered');
  expect(body.textContent).not.toContain('Test Driver');
  expect(document.getElementById('sapStatDel').textContent).toBe('0');
});

test('detail shows each OBD outcome beside its preview and refreshes after POD or retake', async () => {
  const lines = dashboard.state.sapAssignments[dispatch].lineItems;
  lines[1].deliveryStatus = 'Rejected';
  lines.push({...lines[0], obdNumber: 'synthetic-third', deliveryStatus: 'Delivered w/ Rejection'});
  await render();
  dashboard.openSapDispatchDetail(dispatch);
  const statuses = () => [...document.querySelectorAll('[data-pod-status]')].map(el => el.textContent);
  expect(statuses()).toEqual(['Delivered', 'Rejected', 'Delivered w/ rejection']);
  for (const cell of document.querySelectorAll('[data-pod-status]')) {
    expect(cell.previousElementSibling.querySelector('button')).not.toBeNull();
    expect(cell.parentElement.children).toHaveLength(12);
  }
  lines[0].isPodCompleted = false;
  dashboard._rebuildShipmentGroups();
  dashboard._refreshOpenDispatchDetail();
  expect(statuses()[0]).toBe('Pending POD');
  lines[0].isPodCompleted = true;
  lines[0].deliveryStatus = 'Rejected';
  dashboard._refreshOpenDispatchDetail();
  expect(statuses()[0]).toBe('Rejected');
  dashboard.closeSapDispatchModal();
  dashboard._refreshOpenDispatchDetail();
  expect(document.getElementById('sapDispatchDetail').classList.contains('hidden')).toBe(true);
});
test('SAP detail enrichment failure is disclosed and can retry without losing saved POD rows', async () => {
  dashboard._rebuildShipmentGroups();
  SAPService.fetchDispatchDetails.mockRejectedValueOnce(new Error('temporary outage'));

  dashboard.openSapDispatchDetail(dispatch);
  await dashboard._loadSapDispatchDetails([dispatch]);

  expect(document.getElementById('sapDtlDataWarning').hidden).toBe(false);
  expect(document.getElementById('sapDtlOBDLines').textContent).toContain('6801001522');
  expect(document.getElementById('sapDtlOBDLines').textContent).toContain('Delivered');

  SAPService.fetchDispatchDetails.mockResolvedValue({
    [dispatch]: [{SAPDispatchNumber: dispatch, OBDNumber: '6801001522', ShipToPartyName: 'Enriched Customer'}],
  });
  document.querySelector('[data-action="sap-detail-retry"]').click();
  await vi.waitFor(() => {
    expect(document.getElementById('sapDtlDataWarning').hidden).toBe(true);
    expect(document.getElementById('sapDtlOBDLines').textContent).toContain('Enriched Customer');
  });
});
test('SAP detail mismatches are disclosed while preserving saved shipment rows', async () => {
  dashboard._rebuildShipmentGroups();
  SAPService.fetchDispatchDetails.mockResolvedValue({
    data: {[dispatch]: []},
    warnings: [{dispatchKey: dispatch, code: 'SAP_DETAIL_MISMATCH', expectedCount: 2, receivedCount: 1, missingCount: 1}],
  });
  dashboard.openSapDispatchDetail(dispatch);
  await dashboard._loadSapDispatchDetails([dispatch]);
  expect(document.getElementById('sapDtlDataWarning').hidden).toBe(false);
  expect(document.getElementById('sapDtlDataWarning').textContent).toContain('1 of 2 expected detail rows');
  expect(document.getElementById('sapDtlOBDLines').textContent).toContain('6801001522');
});
test('SAP detail retry indicator stops when SAP responds with the same mismatch', async () => {
  dashboard._rebuildShipmentGroups();
  const mismatchResponse = {
    data: {[dispatch]: []},
    warnings: [{dispatchKey: dispatch, code: 'SAP_DETAIL_MISMATCH', expectedCount: 4, receivedCount: 0, missingCount: 4}],
  };
  SAPService.fetchDispatchDetails.mockResolvedValue(mismatchResponse);
  dashboard.openSapDispatchDetail(dispatch);
  await dashboard._loadSapDispatchDetails([dispatch]);

  SAPService.fetchDispatchDetails.mockResolvedValue(mismatchResponse);
  const retryButton = document.querySelector('[data-action="sap-detail-retry"]');
  retryButton.click();
  await vi.waitFor(() => {
    expect(retryButton.disabled).toBe(false);
    expect(retryButton.textContent).toBe('Retry details');
  });
  expect(document.getElementById('sapDtlDataWarning').textContent).toContain('0 of 4 expected detail rows');
});
test('only fresh SAP shipments appear in For Assignment, with no duplicate assigned rows', async () => {
  SAPService.fetchShipments.mockResolvedValue([
    {SAPDispatchNumber: dispatch, OBDNumber: '6801001522', TruckType: '4w', Driver: '', PgiStatus: 'X'},
    {SAPDispatchNumber: '0010000001', OBDNumber: '000123', TruckType: '4w', Driver: '', PgiStatus: 'X'},
  ]);
  const body = await render('forAssignment');
  expect(body.textContent).toContain('10000001');
  expect(body.textContent).not.toContain('Test Driver');
  expect(document.getElementById('sapStatAll').textContent).toBe('2');
});
test.each(['all', 'forAssignment'])('temporary review dispatch appears in %s as view-only', async filter => {
  SAPService.fetchShipments.mockResolvedValue([{
    SAPDispatchNumber: '0010139586', OBDNumber: '000000', TruckType: '', Driver: 'F. PAANO',
    PlateNumber: 'NLC 1406', ShipmentStart: 'PT11H41M00S', ForwardingAgent: '0050000128', PgiStatus: 'X',
  }]);
  const body = await render(filter);
  expect(body.textContent).toContain('10139586');
  expect(body.textContent).toContain('F. PAANO');
  expect(body.textContent).toContain('NLC 1406');
  expect(body.textContent).toContain('Review only');
  expect(body.querySelector('button')).toBeNull();
});
test('search matches any OBD and escapes user text', async () => {
  dashboard.state.sapAssignments[dispatch].driverName = '<img src=x onerror=alert(1)>';
  document.getElementById('sapSearch').value = '6801001523';
  const body = await render();
  expect(body.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(body.querySelector('img')).toBeNull();
});
test('removing an assignment removes its display fallback on the next refresh', async () => {
  await render();
  delete dashboard.state.sapAssignments[dispatch];
  expect((await render()).textContent).not.toContain('Test Driver');
});
test('In Transit filter and counter use the stored trip lifecycle', async () => {
  dashboard.state.sapAssignments[dispatch] = stored('in_transit');
  expect((await render('in_transit')).textContent).toContain('Test Driver');
  expect(document.getElementById('sapStatTransit').textContent).toBe('1');
});
test.each([
  ['all', 'in_transit'], ['in_transit', 'in_transit'], ['delivered', 'completed'],
  ['assigned', 'assigned'], ['loading', 'loading'], ['fully_loaded', 'fully_loaded'], ['planned', 'assigned'],
])('assigned SAP line details remain visible in the %s filter', async (filter, tripStatus) => {
  dashboard.state.sapAssignments[dispatch] = stored(tripStatus);
  dashboard.state.sapAssignments[dispatch].lineItems[0].actualDelDate = '';
  const detailRows = [
    {SAPDispatchNumber:dispatch, OBDNumber:'6801001522', Route:'Route A --> Destination A', PlanningDate:'2026-10-17', ActualDelDate:'/Date(1788912000000)/', Amount:'1234.5', Volume:'9.25', Weight:'44.5', ShipToParty:'00500001', ShipToPartyName:'Test Customer', Address:'Synthetic delivery address', Latitude:0, Longitude:'121.123456'},
    {SAPDispatchNumber:dispatch, OBDNumber:'6801001523', Route:'Route A --> Destination A', PlanningDate:'2026-10-17', ActualDelDate:'/Date(1788912000000)/', Amount:'250', Volume:'3', Weight:'12', ShipToParty:'00500002', ShipToPartyName:'Second Customer', Address:'Second synthetic address', Latitude:'14.5', Longitude:'120.9'},
  ];
  SAPService.fetchDispatchDetails.mockResolvedValue({[dispatch]:detailRows});
  dashboard.state.sapFilter = filter;
  await dashboard._loadSapDispatchDetails([dispatch]);

  const body = document.getElementById('sapBody');
  expect(body.textContent).toContain('Destination A');
  expect(body.textContent).toContain('2026-10-17');
  dashboard.openSapDispatchDetail(dispatch);
  const lines = document.getElementById('sapDtlOBDLines');
  expect(lines.textContent).toContain('1,234.50');
  expect(lines.textContent).toContain('00500001');
  expect(lines.textContent).toContain('Synthetic delivery address');
  expect(lines.textContent).toContain('0.000000');
  expect(lines.textContent).toContain('121.123456');
  expect(document.getElementById('sapDtlPlanDate').textContent).toBe('2026-10-17');
  expect(document.getElementById('sapDtlActualDate').textContent).toContain('2026');
});
test('assigned detail keeps repeated stored OBD rows and quantities when SAP overlaps', async () => {
  const assignment = dashboard.state.sapAssignments[dispatch];
  assignment.lineItems.push({...assignment.lineItems[0], quantity: 2});
  SAPService.fetchShipments.mockResolvedValue([{SAPDispatchNumber: dispatch, OBDNumber: '6801001522', TruckType: '4w', Quantity: 999}]);
  await render();
  dashboard.openSapDispatchDetail(dispatch);
  expect(document.getElementById('sapDtlOBDLines').querySelectorAll('tr')).toHaveLength(3);
  expect(document.getElementById('sapDtlOBDLines').textContent).not.toContain('999');
});
test('stored dispatch labels and inline callback IDs cannot inject markup or script', async () => {
  const unsafeKey = "001'<img src=x onerror=alert(1)>";
  dashboard.state.sapAssignments = {[unsafeKey]: stored()};
  const body = await render();
  expect(body.querySelector('img')).toBeNull();
  const link = body.querySelector('[onclick]');
  expect(link.getAttribute('onclick')).toBe(`window.dashboard.openSapDispatchDetail('${encodeURIComponent(unsafeKey).replaceAll("'", '%27')}')`);
});
test('stored assignment action attributes cannot inject event handlers', async () => {
  const key = '001" onmouseover="alert(1)';
  dashboard.state.sapAssignments = {[key]: stored('assigned')};
  const body = await render('assigned');
  expect(body.querySelector('[onmouseover]')).toBeNull();
  expect(body.querySelector('select').dataset.dispatch).toBe(key);
});
test.each([1791476416000, {seconds: 1791476416}, undefined])('POD preview handles stored capture time %j without crashing', async podCapturedAt => {
  const assignment = dashboard.state.sapAssignments[dispatch];
  assignment.lineItems[0].podImageUrl = 'data:image/png;base64,AAAA';
  assignment.lineItems[0].podCapturedAt = podCapturedAt;
  document.body.insertAdjacentHTML('beforeend', '<div id="podPreviewModal" class="hidden"><img id="podPreviewImg"><span id="podTimestamp"></span><span id="podVerifiedTimestamp"></span></div>');
  dashboard._currentDispatchKey = dispatch;
  PodService.getPod.mockClear();
  await expect(dashboard.openObdPodPreview('6801001522')).resolves.toBeUndefined();
  expect(document.getElementById('podPreviewModal').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('podTimestamp').textContent).not.toContain('Invalid Date');
  dashboard.closePodPreview();
});
test('POD preview stays closed after a forbidden fetch and succeeds when retried', async () => {
  const assignment = dashboard.state.sapAssignments[dispatch];
  assignment.lineItems[0].podImageUrl = 'saved_in_subcollection';
  document.body.insertAdjacentHTML('beforeend', '<div id="podPreviewModal" class="hidden"><img id="podPreviewImg"><span id="podTimestamp"></span><span id="podVerifiedTimestamp"></span></div>');
  dashboard._currentDispatchKey = dispatch;
  const notifyFailure = vi.spyOn(dashboard, '_notifyFailure').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  PodService.getPod.mockRejectedValueOnce(Object.assign(new Error('Driver account required'), {status: 403}));
  PodService.getPod.mockResolvedValueOnce({base64Image: 'data:image/png;base64,RETRIED'});

  await dashboard.openObdPodPreview('6801001522');

  const modal = document.getElementById('podPreviewModal');
  expect(modal.classList.contains('hidden')).toBe(true);
  expect(notifyFailure).toHaveBeenCalledWith('pod-preview', expect.objectContaining({status: 403}), expect.any(String));

  await dashboard.openObdPodPreview('6801001522');

  expect(PodService.getPod).toHaveBeenCalledTimes(2);
  expect(modal.classList.contains('hidden')).toBe(false);
  expect(document.getElementById('podPreviewImg').src).toBe('data:image/png;base64,RETRIED');
  dashboard.closePodPreview();
  notifyFailure.mockRestore();
  warn.mockRestore();
});

test('group POD preview shows one delivery-point photo and every OBD status from one summary action', async () => {
  const location = {
    ShipToParty: '0010002870', ShipToPartyName: 'Same Customer', Address: 'Same Address', Latitude: 14.6, Longitude: 121,
  };
  const rows = [
    {...location, OBDNumber: 'OBD-1'},
    {...location, OBDNumber: 'OBD-2'},
  ];
  dashboard.state.sapGroupedByDispatch[dispatch] = rows;
  dashboard.state.sapAssignments[dispatch] = {
    tripStatus: 'in_transit',
    lineItems: [
      {obdNumber: 'OBD-1', podImageUrl: 'data:image/png;base64,AAAA', podCapturedAt: 1791476416000, isPodCompleted: true, deliveryStatus: 'All Delivered'},
      {obdNumber: 'OBD-2', podImageUrl: 'data:image/png;base64,BBBB', podCapturedAt: 1791476417000, isPodCompleted: true, deliveryStatus: 'Rejected'},
    ],
  };
  document.body.insertAdjacentHTML('beforeend', '<div id="podPreviewModal" class="hidden"><h2 id="podPreviewTitle"></h2><div id="podPreviewSingleContent"><img id="podPreviewImg"></div><div id="podPreviewGallery" hidden></div></div>');

  dashboard.openSapDispatchDetail(dispatch);
  document.querySelector('[data-obd-group-preview]').click();
  await Promise.resolve();
  await Promise.resolve();

  const modal = document.getElementById('podPreviewModal');
  const gallery = document.getElementById('podPreviewGallery');
  expect(modal.classList.contains('flex')).toBe(true);
  expect(document.getElementById('podPreviewTitle').textContent).toBe('POD Preview · 2 OBDs');
  expect(gallery.hidden).toBe(false);
  expect(gallery.querySelectorAll('img')).toHaveLength(1);
  expect(gallery.querySelector('img').src).toBe('data:image/png;base64,BBBB');
  expect(gallery.textContent).toContain('OBD-1 · Delivered');
  expect(gallery.textContent).toContain('OBD-2 · Rejected');
  dashboard.closePodPreview();
});
test('driver assignment fields preserve SAP destination identity and physical metrics without amount', () => {
  const fields = driverAssignmentFields({ShipToParty: '0010002870', Address: ' Synthetic address ', Latitude: '14.662800',
    Longitude: '120.957800', Volume: '0.045', Weight: '21.360', Amount: '5539.31'});
  expect(fields).toEqual({shipTo: '0010002870', deliveryAddress: 'Synthetic address', latitude: 14.6628,
    longitude: 120.9578, volume: 0.045, weight: 21.36});
  const merged = mergeAssignmentGroups({}, {dispatch: {lineItems: [{obdNumber: 'OBD-1', customerName: 'Synthetic', quantity: 7, ...fields}]}});
  expect(merged.dispatch[0]).toMatchObject({ShipToParty: '0010002870', Address: 'Synthetic address',
    Latitude: 14.6628, Longitude: 120.9578, Volume: 0.045, Weight: 21.36});
});
test('missing SAP location identity is not fabricated for driver grouping', () => {
  expect(driverAssignmentFields({ShipToParty: '0010002870', Address: '', Latitude: '', Longitude: '', Volume: '', Weight: ''}))
    .toEqual({shipTo: '0010002870', deliveryAddress: undefined, latitude: undefined, longitude: undefined, volume: undefined, weight: undefined});
});
