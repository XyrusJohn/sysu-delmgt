// Mock ../api/config.js for socket.js and any other modules that use it
vi.mock('../api/config.js', () => ({
  API_CONFIG: {
    SOCKET_URL: 'http://localhost',
    API_URL: 'http://localhost',
    DRIVER_TRACKING_URL: 'http://localhost',
  },
}));

//  Mock other dependencies
vi.mock('../api/authService.js');
vi.mock('../api/sapService.js');
vi.mock('../components/MapManager.js');
vi.mock('../components/MapTrackingPanel.js');
vi.mock('../api/socket.js', () => ({
  socket: { on: vi.fn(), off: vi.fn() },
  getExistingDriverSocket: vi.fn(() => null),
  EVENTS: { POD_UPDATED: 'pod_updated' },
  getDriverSocket: vi.fn(),
  getProfileSocket: vi.fn(() => ({on: vi.fn()})),
  connectDriverSocket: vi.fn(),
}));

describe('R48 elapsed timestamp display', () => {
  test('missing and invalid role-request timestamps do not crash the dashboard', async () => {
    const {Dashboard} = await import('./dashboard.js');
    const dashboard = Object.create(Dashboard.prototype);
    expect(dashboard._formatElapsed(null)).toBe('just now');
    expect(dashboard._formatElapsed(new Date('invalid'))).toBe('just now');
  });
  test('database timestamp wrappers display the same elapsed time as Date values', async () => {
    const {Dashboard} = await import('./dashboard.js');
    const dashboard = Object.create(Dashboard.prototype);
    const date = new Date(Date.now() - 65 * 60000);
    expect(dashboard._formatElapsed({toDate: () => date})).toBe(dashboard._formatElapsed(date));
  });
});

describe('profile identity fields', () => {
  test('keeps the sign-in username separate from the editable display name', async () => {
    document.body.innerHTML = `
      <div id="profileModal" class="hidden">
        <input id="profileModalFirstName"><input id="profileModalMiddleName"><input id="profileModalLastName">
        <input id="profileModalUsername" readonly>
        <div id="profileModalRoleRequestPanel"></div><button id="profileModalRequest"></button>
        <div id="profileModalRoleSelectWrapper"></div><div id="profileModalRoleStaticWrapper"></div>
        <span id="profileModalRoleStatic"></span><div id="profileModalPendingBanner"></div>
        <img id="profileModalAvatarImg"><input id="profileModalPhotoUrl">
      </div>`;
    const {Dashboard} = await import('./dashboard.js');
    const dashboard = Object.create(Dashboard.prototype);

    dashboard._openProfileModal({username: 'web_developer_account', displayName: 'web_developer_account', role: 'super_admin'});

    expect(document.getElementById('profileModalFirstName').value).toBe('');
    expect(document.getElementById('profileModalMiddleName').value).toBe('');
    expect(document.getElementById('profileModalLastName').value).toBe('');
    expect(document.getElementById('profileModalUsername').value).toBe('web_developer_account');
    expect(document.getElementById('profileModalUsername').readOnly).toBe(true);
  });

  test('loads structured profile names into separate editable fields', async () => {
    document.body.innerHTML = `
      <div id="profileModal" class="hidden">
        <input id="profileModalFirstName"><input id="profileModalMiddleName"><input id="profileModalLastName">
        <input id="profileModalUsername" readonly><div id="profileModalRoleRequestPanel"></div>
        <button id="profileModalRequest"></button><div id="profileModalRoleSelectWrapper"></div>
        <div id="profileModalRoleStaticWrapper"></div><span id="profileModalRoleStatic"></span>
        <div id="profileModalPendingBanner"></div><img id="profileModalAvatarImg"><input id="profileModalPhotoUrl">
      </div>`;
    const {Dashboard} = await import('./dashboard.js');
    const dashboard = Object.create(Dashboard.prototype);

    dashboard._openProfileModal({username: 'river.driver', displayName: 'River M. Driver', role: 'admin',
      profile: {firstName: 'River', middleName: 'Morgan', lastName: 'Driver'}});

    expect(document.getElementById('profileModalFirstName').value).toBe('River');
    expect(document.getElementById('profileModalMiddleName').value).toBe('Morgan');
    expect(document.getElementById('profileModalLastName').value).toBe('Driver');
  });
});

describe('system diagnostics timestamp display', () => {
  test('refreshes a mobile account run immediately after its authenticated socket event', async () => {
    const {Dashboard} = await import('./dashboard.js');
    const {SystemErrorService} = await import('../api/systemErrorService.js');
    vi.spyOn(SystemErrorService, 'listDiagnosticRuns').mockResolvedValue({items: [
      {id: 'new-run', actorId: 'af9ae40b-9602-4dbd-b1ff-41d697022798', createdAt: {$timestamp: 2000}, details: {runId: 'new-ref'}},
    ], hasMore: false});
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.state = {mobileDiagnosticRuns: [
      {id: 'old-run', actorId: 'af9ae40b-9602-4dbd-b1ff-41d697022798', createdAt: {$timestamp: 1000}},
    ], mobileDiagnosticRunHistories: {}, mobileDiagnosticRunsExpanded: null, _activeDocsTab: 'overview'};

    await dashboard._refreshMobileDiagnosticRun({actorId: 'af9ae40b-9602-4dbd-b1ff-41d697022798', runId: 'new-ref'});

    expect(dashboard.state.mobileDiagnosticRuns).toHaveLength(1);
    expect(dashboard.state.mobileDiagnosticRuns[0].id).toBe('new-run');
    expect(SystemErrorService.listDiagnosticRuns).toHaveBeenCalledWith({actorId: 'af9ae40b-9602-4dbd-b1ff-41d697022798', limit: 1, offset: 0});
  });

  test('shows saved mobile diagnostic runs separately from incident logs', async () => {
    document.body.innerHTML = '<div id="docsListContainer"></div>';
    const {Dashboard} = await import('./dashboard.js');
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.state = {systemErrorLogs: [], mobileDiagnosticRuns: [{id: 'run-row', actorId: 'driver-1',
      eventCode: 'mobile_diagnostic_run', requestId: 'run-ref',
      details: {runId: 'run-ref', appVersion: '1.2.3', checks: [
        {name: 'sysu-go-api', status: 'pass', httpStatus: 200, durationMs: 12},
        {name: 'sysu-go-socket', status: 'warning', state: 'disconnected', durationMs: 0},
      ]}, createdAt: {$timestamp: Date.now()}}], systemErrorFilter: 'open',
      systemErrorLogsLoading: false, systemErrorLogsLoaded: true, systemErrorLogsError: null,
      mobileDiagnosticRunsError: null};
    dashboard._systemErrorSocketWired = true;

    dashboard._renderSystemErrorsView();

    const rendered = document.getElementById('docsListContainer').textContent;
    expect(rendered).toContain('SYSU Go mobile diagnostic runs');
    expect(rendered).toContain('sysu-go-api: pass');
    expect(rendered).toContain('HTTP 200');
    expect(rendered).toContain('sysu-go-socket: warning');
    expect(rendered).toContain('run-ref');
    expect(document.querySelector('[data-system-error-action="resolve"][data-id="run-row"]')).toBeNull();
  });

  test('shows one latest run per account, filters health state, and expands account history', async () => {
    document.body.innerHTML = '<div id="docsListContainer"></div>';
    const {Dashboard} = await import('./dashboard.js');
    const {SystemErrorService} = await import('../api/systemErrorService.js');
    const history = vi.spyOn(SystemErrorService, 'listDiagnosticRuns').mockResolvedValue({items: [{id: 'old-a', actorId: 'driver-a',
      details: {runId: 'older-run-a', appVersion: '1.0', checks: [{name: 'sysu-go-api', status: 'pass'}]},
      createdAt: {$timestamp: Date.now() - 1000}}], hasMore: false});
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.state = {systemErrorLogs: [], mobileDiagnosticRuns: [
      {id: 'latest-a', actorId: 'driver-a', details: {runId: 'latest-run-a', appVersion: '1.2',
        checks: [{name: 'sysu-go-api', status: 'fail', failureCode: 'NETWORK_UNREACHABLE'}]}, createdAt: {$timestamp: Date.now()}},
      {id: 'latest-b', actorId: 'driver-b', details: {runId: 'latest-run-b', appVersion: '1.2',
        checks: [{name: 'sysu-go-api', status: 'pass', httpStatus: 200}]}, createdAt: {$timestamp: Date.now()}},
    ], mobileDiagnosticRunsError: null, mobileDiagnosticRunsHasMore: false,
      mobileDiagnosticRunHistories: {}, mobileDiagnosticRunsExpanded: null,
      mobileDiagnosticRunsSearch: '', mobileDiagnosticRunsFilter: 'all', systemErrorFilter: 'open',
      systemErrorLogsLoading: false, systemErrorLogsLoaded: true, systemErrorLogsError: null};
    dashboard._systemErrorSocketWired = true;

    dashboard._renderSystemErrorsView();
    expect(document.querySelectorAll('[data-mobile-run-account]')).toHaveLength(2);

    const filter = document.querySelector('[data-mobile-runs-filter]');
    filter.value = 'issues';
    filter.dispatchEvent(new Event('change', {bubbles: true}));
    expect([...document.querySelectorAll('[data-mobile-run-account]')].filter(card => !card.hidden).map(card => card.dataset.searchText))
      .toEqual([expect.stringContaining('driver-a')]);

    const search = document.querySelector('[data-mobile-runs-search]');
    search.value = 'driver-a';
    search.dispatchEvent(new Event('input', {bubbles: true}));
    document.querySelector('[data-system-error-action="mobile-run-history"][data-actor-id="driver-a"]').click();
    await vi.waitFor(() => expect(document.getElementById('docsListContainer').textContent).toContain('older-run-a'));

    expect(history).toHaveBeenCalledWith({actorId: 'driver-a', limit: 20, offset: 1});
    history.mockRestore();
  });

  test('renders backend epoch timestamp wrappers as dates', async () => {
    document.body.innerHTML = '<div id="docsListContainer"></div>';
    const {Dashboard} = await import('./dashboard.js');
    const dashboard = Object.create(Dashboard.prototype);
    const timestamp = Date.now() - 60_000;
    dashboard.state = {
      systemErrorLogs: [{
        id: 'diagnostic-1', severity: 'error', eventCode: 'realtime-connection',
        source: 'web', message: 'Connection failed.', createdAt: {$timestamp: timestamp},
      }],
      systemErrorFilter: 'open',
      systemErrorLogsLoading: false,
      systemErrorLogsLoaded: true,
      systemErrorLogsError: null,
    };
    dashboard._systemErrorSocketWired = true;

    dashboard._renderSystemErrorsView();

    const rendered = document.getElementById('docsListContainer').textContent;
    expect(rendered).toContain(new Date(timestamp).toLocaleString());
    expect(rendered).not.toContain('Time unavailable');
    expect(document.querySelector('[data-system-error-action="run-diagnostics"]')?.textContent).toContain('Start diagnostics');
  });

  test('Start diagnostics runs checks and shows their outcome', async () => {
    document.body.innerHTML = '<div id="docsListContainer"></div>';
    const {Dashboard} = await import('./dashboard.js');
    const {SystemErrorService} = await import('../api/systemErrorService.js');
    const run = vi.spyOn(SystemErrorService, 'runDiagnostics').mockResolvedValue({runId: 'diag-test',
      startedAt: '2026-10-27T00:00:00.000Z', checks: [{name: 'sysu-go-api', status: 'fail', httpStatus: 503, durationMs: 8}]});
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.state = {systemErrorLogs: [{id: 'diagnostic-row', eventCode: 'frontend_operation_failure',
      source: 'web', message: 'Synthetic failure', createdAt: {$timestamp: Date.now()}}], systemErrorFilter: 'open',
      systemErrorLogsLoading: false, systemErrorLogsLoaded: true,
      systemErrorLogsError: null};
    dashboard._systemErrorSocketWired = true;
    dashboard._renderSystemErrorsView();

    document.querySelector('[data-system-error-action="run-diagnostics"]').click();
    await vi.waitFor(() => expect(document.getElementById('docsListContainer').textContent).toContain('HTTP 503'));

    expect(run).toHaveBeenCalledOnce();
    run.mockRestore();
  });

  test('shows plain guidance and keeps support details tucked away', async () => {
    document.body.innerHTML = '<div id="docsListContainer"></div>';
    const {Dashboard} = await import('./dashboard.js');
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.state = {
      systemErrorLogs: [
        {id: 'open-row', eventCode: 'frontend_operation_failure', source: 'web', operation: 'sap-sync', requestId: 'open-ref', createdAt: {$timestamp: Date.now()}},
        {id: 'resolved-row', eventCode: 'frontend_operation_failure', source: 'web', operation: 'sysu-app-api-health', requestId: 'resolved-ref', details: {failureCode: 'NETWORK_UNREACHABLE'}, resolvedAt: {$timestamp: Date.now()}, createdAt: {$timestamp: Date.now()}},
      ],
      systemErrorFilter: 'all', systemErrorLogsLoading: false,
      systemErrorLogsLoaded: true, systemErrorLogsError: null, user: {role: 'admin'},
    };
    dashboard._systemErrorSocketWired = true;

    dashboard._renderSystemErrorsView();

    expect(document.getElementById('docsListContainer').textContent).toContain('What to do:');
    expect(document.getElementById('docsListContainer').textContent).toContain('Do not repeat a trip or assignment');
    expect(document.getElementById('docsListContainer').textContent).toContain('Technical details');
    expect(document.querySelector('details summary')?.textContent).toBe('Technical details');
    expect(document.querySelector('[data-system-error-action="resolve"][data-id="open-row"]')).not.toBeNull();
    expect(document.querySelector('[data-system-error-action="delete"][data-id="resolved-row"]')).not.toBeNull();
    expect(document.querySelector('[data-system-error-action="delete"][data-id="open-row"]')).toBeNull();
  });

  test('shows a repeat count for grouped open incidents', async () => {
    document.body.innerHTML = '<div id="docsListContainer"></div>';
    const {Dashboard} = await import('./dashboard.js');
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.state = {systemErrorLogs: [{id: 'repeat-row', eventCode: 'frontend_operation_failure',
      source: 'web', operation: 'sap-sync', details: {occurrenceCount: 4, lastSeenAtMs: Date.now()},
      createdAt: {$timestamp: Date.now()}}], systemErrorFilter: 'open', systemErrorLogsLoading: false,
      systemErrorLogsLoaded: true, systemErrorLogsError: null};
    dashboard._systemErrorSocketWired = true;

    dashboard._renderSystemErrorsView();

    expect(document.getElementById('docsListContainer').textContent).toContain('Happened 4 times');
  });

  test('deletes one resolved row only after confirmation', async () => {
    document.body.innerHTML = '<div id="docsListContainer"></div>';
    const {Dashboard} = await import('./dashboard.js');
    const {SystemErrorService} = await import('../api/systemErrorService.js');
    const deleteResolved = vi.spyOn(SystemErrorService, 'deleteResolved').mockResolvedValue({success: true});
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const dashboard = Object.create(Dashboard.prototype);
    dashboard._activeDocsTab = 'system-errors';
    dashboard.state = {
      systemErrorLogs: [{id: 'resolved-row', eventCode: 'frontend_operation_failure', operation: 'sap-sync', requestId: 'ref-1', resolvedAt: {$timestamp: Date.now()}, createdAt: {$timestamp: Date.now()}}],
      systemErrorFilter: 'all', systemErrorLogsLoading: false,
      systemErrorLogsLoaded: true, systemErrorLogsError: null,
    };
    dashboard._systemErrorSocketWired = true;
    dashboard._renderSystemErrorsView();

    document.querySelector('[data-system-error-action="delete"]').click();
    await vi.waitFor(() => expect(dashboard.state.systemErrorLogs).toEqual([]));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('ref-1'));
    expect(deleteResolved).toHaveBeenCalledWith('resolved-row');
    deleteResolved.mockRestore();
    confirm.mockRestore();
  });
});

describe('Dashboard startup dependencies', () => {
  test('starts authentication without a global Leaflet script', async () => {
    const {Dashboard} = await import('./dashboard.js');
    const {AuthService} = await import('../api/authService.js');
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.config = {};
    dashboard._setupEventListeners = vi.fn();
    dashboard._listenToRoleRequests = vi.fn();
    dashboard._initMap = vi.fn();
    const originalLeaflet = globalThis.L;
    delete globalThis.L;
    try {
      await dashboard.init();
      expect(AuthService.subscribe).toHaveBeenCalled();
      expect(dashboard._setupEventListeners).toHaveBeenCalled();
    } finally {
      if (originalLeaflet === undefined) delete globalThis.L;
      else globalThis.L = originalLeaflet;
    }
  });

  test('replaces an unresponsive authentication splash with secure recovery actions', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="gatekeeper"><p id="loaderStatus">Loading</p></div>';
    const {Dashboard} = await import('./dashboard.js');
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.config = {gatekeeperId: 'gatekeeper'};
    dashboard._setupEventListeners = vi.fn();
    dashboard._listenToRoleRequests = vi.fn();
    dashboard._initMap = vi.fn();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await dashboard.init();
      await vi.advanceTimersByTimeAsync(15000);

      const gatekeeper = document.getElementById('gatekeeper');
      expect(gatekeeper.textContent).toContain('Dashboard could not start');
      expect(gatekeeper.querySelector('#retryDashboardStartup')).not.toBeNull();
      expect(gatekeeper.querySelector('#returnToDashboardSignIn')).not.toBeNull();
      expect(gatekeeper.getAttribute('role')).toBe('alert');
      expect(errorLog).toHaveBeenCalledWith('[startup] dashboard startup timed out', {
        stage: 'authentication and profile verification',
      });
    } finally {
      errorLog.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('Orders under-development workspace', () => {
  const renderNavigation = async () => {
    document.body.innerHTML = `
      <nav>
        <button id="rOrders"></button>
        <button id="rOverview"></button>
      </nav>
      <aside id="sidePanel"></aside>
      <div id="mainContent"></div><div id="usersContent"></div>
      <div id="sapContent"></div><div id="fleetContent"></div>
      <div id="ordersContent"></div><div id="trackingContent"></div>
      <div id="docsContent"></div><h1 id="viewTitle"></h1>
      <div id="underDevOverlay" aria-hidden="true">
        <h2 id="underDevTitle"></h2><p id="underDevDescription"></p>
      </div>
    `;
    const {Dashboard} = await import('./dashboard.js');
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.state = {activeView: 'overview'};
    dashboard.renderOrders = vi.fn();
    return dashboard;
  };

  test('shows the shared under-development notice in production', async () => {
    vi.stubEnv('PROD', true);
    const dashboard = await renderNavigation();

    await dashboard.handleNavClick('Orders');

    expect(dashboard.renderOrders).not.toHaveBeenCalled();
    expect(document.getElementById('ordersContent').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('underDevOverlay').style.opacity).toBe('1');
    expect(document.getElementById('underDevOverlay').getAttribute('aria-hidden')).toBe('false');
    expect(document.getElementById('underDevTitle').textContent).toBe('Orders is under development');
    expect(document.getElementById('underDevDescription').textContent).toBe('We are refining the Orders workspace before it becomes available.');
    vi.unstubAllEnvs();
  });

  test('also shows the shared under-development notice in local development builds', async () => {
    vi.stubEnv('PROD', false);
    const dashboard = await renderNavigation();

    await dashboard.handleNavClick('Orders');

    expect(dashboard.renderOrders).not.toHaveBeenCalled();
    expect(document.getElementById('ordersContent').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('underDevOverlay').style.opacity).toBe('1');
    expect(document.getElementById('underDevOverlay').getAttribute('aria-hidden')).toBe('false');
    expect(document.getElementById('underDevTitle').textContent).toBe('Orders is under development');
    vi.unstubAllEnvs();
  });
});

describe('Settings and theme preferences', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="themeToggle" aria-label="Toggle dark/light mode"></button>
      <svg id="iconLight"></svg><svg id="iconDark" class="hidden"></svg>
      <button data-theme-choice="dark" aria-pressed="true"></button>
      <button data-theme-choice="light" aria-pressed="false"></button>
      <div id="mainContent"></div><div id="usersContent"></div><div id="sapContent"></div>
      <div id="fleetContent"></div><div id="ordersContent"></div><div id="trackingContent"></div>
      <div id="docsContent"></div><section id="settingsContent" class="hidden"></section>
      <aside id="sidePanel" class="open"></aside><h2 id="viewTitle"></h2>
    `;
    localStorage.clear();
  });

  test('Settings opens as a real view instead of falling back to Overview', async () => {
    const {Dashboard} = await import('./dashboard.js');
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.state = {activeView: 'overview', theme: 'dark'};

    await dashboard.handleNavClick('Settings');

    expect(document.getElementById('settingsContent').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('mainContent').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('viewTitle').textContent).toBe('Settings');
    expect(document.getElementById('sidePanel').classList.contains('open')).toBe(false);
  });

  test('theme choices and the rail toggle stay in sync and persist across reloads', async () => {
    const {Dashboard} = await import('./dashboard.js');
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.state = {theme: 'dark'};
    localStorage.setItem('sysu-theme', 'light');

    dashboard._setupThemeControls();

    const darkChoice = document.querySelector('[data-theme-choice="dark"]');
    const lightChoice = document.querySelector('[data-theme-choice="light"]');
    const toggle = document.getElementById('themeToggle');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(lightChoice.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Switch to dark theme');

    darkChoice.click();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('sysu-theme')).toBe('dark');
    expect(darkChoice.getAttribute('aria-pressed')).toBe('true');

    toggle.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('sysu-theme')).toBe('light');
    expect(darkChoice.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Warehouse Base map tiles', () => {
  test('uses the minimal Esri basemap and displays map attribution', async () => {
    document.body.innerHTML = '<div id="warehouseBaseMap"></div>';
    const map = {
      on: vi.fn(),
      invalidateSize: vi.fn(),
      attributionControl: {setPosition: vi.fn(), setPrefix: vi.fn()},
    };
    const marker = { on: vi.fn(), setLatLng: vi.fn() };
    marker.addTo = vi.fn(() => marker);
    const circle = { setLatLng: vi.fn(), setRadius: vi.fn() };
    circle.addTo = vi.fn(() => circle);
    const leaflet = (await import('leaflet')).default;
    const mapSpy = vi.spyOn(leaflet, 'map').mockReturnValue(map);
    const divIconSpy = vi.spyOn(leaflet, 'divIcon').mockReturnValue({});
    const markerSpy = vi.spyOn(leaflet, 'marker').mockReturnValue(marker);
    const circleSpy = vi.spyOn(leaflet, 'circle').mockReturnValue(circle);
    vi.useFakeTimers();

    try {
      const {Dashboard} = await import('./dashboard.js');
      const {constrainMapToPhilippines, addMinimalMapTiles} = await import('../components/MapManager.js');
      const dashboard = Object.create(Dashboard.prototype);
      dashboard._initWarehouseBaseMap(14.67, 121.01, 100);

      expect(mapSpy).toHaveBeenCalledWith('warehouseBaseMap', expect.objectContaining({
        center: [14.67, 121.01],
        zoomSnap: 0,
        minZoom: 5,
        maxZoom: 19,
        maxBoundsViscosity: 1,
        maxBounds: expect.anything(),
        attributionControl: true,
      }));
      expect(map.attributionControl.setPosition).toHaveBeenCalledWith('bottomleft');
      expect(map.attributionControl.setPrefix).toHaveBeenCalledWith(false);
      expect(constrainMapToPhilippines).toHaveBeenCalledWith(map);
      expect(addMinimalMapTiles).toHaveBeenCalledWith(map, 'warehouseBaseMap');
      expect(marker.addTo).toHaveBeenCalledWith(map);
      expect(circle.addTo).toHaveBeenCalledWith(map);
    } finally {
      vi.useRealTimers();
      mapSpy.mockRestore();
      divIconSpy.mockRestore();
      markerSpy.mockRestore();
      circleSpy.mockRestore();
    }
  });
});

describe('User Management deletion state', () => {
  test('hides completed tombstones and identifies retryable account deletions', async () => {
    document.body.innerHTML = '<table><tbody id="userTableBody"></tbody></table>';
    const {Dashboard} = await import('./dashboard.js');
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.state = {
      user: {uid: 'admin-id', role: 'super_admin'},
      _activeUserTab: 'employees',
      _userSearchQuery: '',
    };
    dashboard.deleteUserRecord = vi.fn();

    dashboard._renderUsersTable([
      {id: 'completed-123456', role: 'pending', status: 'disabled', deletionState: 'complete'},
      {id: 'pending-654321', name: 'User', role: 'pending', status: 'disabled', deletionState: 'pending'},
      {id: 'named-789012', name: 'Legacy Profile Name', displayName: 'Dispatcher Preferred', username: 'dispatcher.login', role: 'admin', status: 'active'},
    ]);

    const body = document.getElementById('userTableBody');
    expect(body.textContent).not.toContain('completed-123456');
    expect(body.textContent).toContain('Account …654321');
    expect(body.textContent).toContain('Account ID ending 654321');
    expect(body.textContent).toContain('Deletion in progress');
    expect(body.textContent).toContain('Dispatcher Preferred');
    expect(body.textContent).toContain('dispatcher.login');
    expect(body.textContent).not.toContain('Legacy Profile Name');
    const retryButton = body.querySelector('[data-action="delete-user"]');
    expect(retryButton.textContent).toBe('Retry Delete');
    retryButton.click();
    expect(dashboard.deleteUserRecord).toHaveBeenCalledWith('pending-654321', 'Account …654321');
  });
});

describe('Documents master-record delete visibility', () => {
  test.each(['admin', 'super_admin'])('%s can see Delete for guards and truck companies', async (role) => {
    document.body.innerHTML = '<div id="guardListBody"></div><div id="tcListBody"></div>';
    const {Dashboard} = await import('./dashboard.js');
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.state = {
      user: {role},
      guardsLoading: false,
      guardsLoadError: false,
      _guards: { 'SG-001': {id:'SG-001', guardId:'SG-001', fullName:'Synthetic Guard', active:true} },
      _truckCompanies: { '01': {id:'01', companyCode:'01', name:'Synthetic Company', active:true} },
    };
    dashboard._showToast = vi.fn();

    dashboard._refreshGuardList();
    dashboard._refreshTcList();

    expect(document.querySelector('[data-action="guard-delete"]')).not.toBeNull();
    expect(document.querySelector('[data-action="tc-delete"]')).not.toBeNull();
  });

  test('other roles do not see permanent Delete actions', async () => {
    document.body.innerHTML = '<div id="guardListBody"></div><div id="tcListBody"></div>';
    const {Dashboard} = await import('./dashboard.js');
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.state = {
      user: {role:'fleet_manager'},
      guardsLoading: false,
      guardsLoadError: false,
      _guards: { 'SG-001': {id:'SG-001', guardId:'SG-001', fullName:'Synthetic Guard', active:true} },
      _truckCompanies: { '01': {id:'01', companyCode:'01', name:'Synthetic Company', active:true} },
    };

    dashboard._refreshGuardList();
    dashboard._refreshTcList();

    expect(document.querySelector('[data-action="guard-delete"]')).toBeNull();
    expect(document.querySelector('[data-action="tc-delete"]')).toBeNull();
  });
});

describe('filterSap', () => {
  let dashboard;

  beforeEach(async () => {
    //  Reset DOM
    document.body.innerHTML = '';

    //  Create the required elements for the sapTab buttons
    const filterDiv = document.createElement('div');
    filterDiv.innerHTML = `
      <button id="sapTabDelivered"></button>
      <button id="sapTabTransit"></button>
      <button id="sapTabFullyLoaded"></button>
      <button id="sapTabLoading"></button>
      <button id="sapTabAssigned"></button>
      <button id="sapTabForAssignment"></button>
    `;
    document.body.appendChild(filterDiv);

    //  Exercise the real class without starting live authentication/listeners.
    const { Dashboard } = await import('./dashboard.js');
    dashboard = Object.create(Dashboard.prototype);
    dashboard.state = {};

    //  Reset state
    dashboard.state.sapAssignments = {};
    dashboard.state.sapFilter = 'all';
    //  Mock _renderSapTable to track calls
    dashboard._renderSapTable = vi.fn();
    dashboard._syncSAP = vi.fn().mockResolvedValue(undefined);
  });

  test('sets filter to delivered and activates correct tab', () => {
    dashboard.filterSap('delivered');
    expect(dashboard.state.sapFilter).toBe('delivered');
    expect(dashboard._renderSapTable).toHaveBeenCalled();
    const activeTab = document.getElementById('sapTabDelivered');
    expect(activeTab.classList.contains('bg-db-item-active')).toBe(true);
    expect(activeTab.classList.contains('text-db-text')).toBe(true);
    expect(activeTab.classList.contains('active')).toBe(true);
    //  Ensure other tabs are not active
    const otherTab = document.getElementById('sapTabTransit');
    expect(otherTab.classList.contains('bg-db-item-active')).toBe(false);
  });

  test('sets filter to in_transit and activates correct tab', () => {
    dashboard.filterSap('in_transit');
    expect(dashboard.state.sapFilter).toBe('in_transit');
    expect(dashboard._renderSapTable).toHaveBeenCalled();
    const activeTab = document.getElementById('sapTabTransit');
    expect(activeTab.classList.contains('bg-db-item-active')).toBe(true);
    expect(activeTab.classList.contains('text-db-text')).toBe(true);
    expect(activeTab.classList.contains('active')).toBe(true);
  });

  test('sets filter to fully_loaded and activates correct tab', () => {
    dashboard.filterSap('fully_loaded');
    expect(dashboard.state.sapFilter).toBe('fully_loaded');
    expect(dashboard._renderSapTable).toHaveBeenCalled();
    const activeTab = document.getElementById('sapTabFullyLoaded');
    expect(activeTab.classList.contains('bg-db-item-active')).toBe(true);
    expect(activeTab.classList.contains('text-db-text')).toBe(true);
    expect(activeTab.classList.contains('active')).toBe(true);
  });

  test('sets filter to loading and activates correct tab', () => {
    dashboard.filterSap('loading');
    expect(dashboard.state.sapFilter).toBe('loading');
    expect(dashboard._renderSapTable).toHaveBeenCalled();
    const activeTab = document.getElementById('sapTabLoading');
    expect(activeTab.classList.contains('bg-db-item-active')).toBe(true);
    expect(activeTab.classList.contains('text-db-text')).toBe(true);
    expect(activeTab.classList.contains('active')).toBe(true);
  });

  test('sets filter to assigned and activates correct tab', () => {
    dashboard.filterSap('assigned');
    expect(dashboard.state.sapFilter).toBe('assigned');
    expect(dashboard._renderSapTable).toHaveBeenCalled();
    const activeTab = document.getElementById('sapTabAssigned');
    expect(activeTab.classList.contains('bg-db-item-active')).toBe(true);
    expect(activeTab.classList.contains('text-db-text')).toBe(true);
    expect(activeTab.classList.contains('active')).toBe(true);
  });

  test('sets filter to forAssignment and activates correct tab', () => {
    dashboard.filterSap('forAssignment');
    expect(dashboard.state.sapFilter).toBe('forAssignment');
    expect(dashboard._renderSapTable).toHaveBeenCalled();
    const activeTab = document.getElementById('sapTabForAssignment');
    expect(activeTab.classList.contains('bg-db-item-active')).toBe(true);
    expect(activeTab.classList.contains('text-db-text')).toBe(true);
    expect(activeTab.classList.contains('active')).toBe(true);
  });

  test('calls _renderSapTable when filter changes', () => {
    dashboard.filterSap('delivered');
    expect(dashboard._renderSapTable).toHaveBeenCalledTimes(1);
    dashboard.filterSap('in_transit');
    expect(dashboard._renderSapTable).toHaveBeenCalledTimes(2);
  });

  test('delivered filter sets sapFilter to "delivered" and renders', () => {
    //  Populate sapAssignments with mixed tripStatus values to mirror realistic state.
    //  (The actual filter dispatch happens in _renderSapTable, which is mocked here,
    //  so this test primarily verifies state side-effects and tab activation.)
    dashboard.state.sapAssignments = {
      'DISP-001': { driverName: 'Juan', truckPlate: 'ABC123', tripStatus: 'completed' },
      'DISP-002': { driverName: 'Pedro', truckPlate: 'DEF456', tripStatus: 'in_transit' },
      'DISP-003': { driverName: 'Maria', truckPlate: 'GHI789', tripStatus: null },
    };

    //  Activate the delivered filter — this sets state.sapFilter and triggers _renderSapTable.
    dashboard.filterSap('delivered');

    //  Assert state was set correctly and render was invoked.
    expect(dashboard.state.sapFilter).toBe('delivered');
    expect(dashboard._renderSapTable).toHaveBeenCalled();

    //  Assert the delivered tab became active (verifies tab mapping is 'delivered' → sapTabDelivered).
    const deliveredTab = document.getElementById('sapTabDelivered');
    expect(deliveredTab.classList.contains('active')).toBe(true);
  });

});

describe('SAP navigation default', () => {
  test('opens SAP on For Assignment and leaves other filters selectable', async () => {
    document.body.innerHTML = `
      <div id="sapContent"></div>
      <div id="underDevOverlay" aria-hidden="true"></div>
      <div id="sapFilterSpinner" class="hidden"></div>
      <button id="sapTabAll"></button><button id="sapTabDelivered"></button>
      <button id="sapTabTransit"></button><button id="sapTabFullyLoaded"></button>
      <button id="sapTabLoading"></button><button id="sapTabAssigned"></button>
      <button id="sapTabForAssignment"></button>
    `;
    const {Dashboard} = await import('./dashboard.js');
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.state = {activeView: 'overview'};
    dashboard._syncSAP = vi.fn().mockResolvedValue(undefined);
    dashboard._renderSapTable = vi.fn();

    await dashboard.handleNavClick('SAP');

    expect(dashboard.state.sapFilter).toBe('forAssignment');
    expect(document.getElementById('sapTabForAssignment').classList.contains('active')).toBe(true);
    expect(document.getElementById('sapTabDelivered').classList.contains('active')).toBe(false);
    expect(dashboard._renderSapTable).toHaveBeenCalledOnce();

    dashboard.filterSap('delivered');
    expect(dashboard.state.sapFilter).toBe('delivered');
    expect(document.getElementById('sapTabDelivered').classList.contains('active')).toBe(true);
  });
});

describe('SAP shipment feedback', () => {
  let Dashboard;
  let SAPService;
  let dashboard;

  beforeEach(async () => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <table><tbody id="sapBody"></tbody></table>
      <span id="sapStatAll"></span><span id="sapStatDel"></span>
      <span id="sapStatTransit"></span><span id="sapResultCount"></span>
      <span id="sapLastUpdate"></span><input id="sapSearch" />
    `;
    ({ Dashboard } = await import('./dashboard.js'));
    ({ SAPService } = await import('../api/sapService.js'));
    dashboard = Object.create(Dashboard.prototype);
    SAPService.state = { lastError: null };
  });

  const shipmentGroups = () => ({
    'DISP-001': [{
      SAPDispatchNumber: 'DISP-001',
      OBDNumber: 'OBD-001',
      TruckType: 'AUV',
      Driver: '',
      PlateNumber: '',
      ShipmentStart: '',
      Delivery: '',
    }],
  });

  test('shows a useful assigned-filter empty state instead of a blank table', () => {
    dashboard.state = {
      sapLoading: false,
      sapLoadError: false,
      sapGroupedByDispatch: shipmentGroups(),
      sapAssignments: {},
      sapFilter: 'assigned',
      sapSortKey: 'SAPDispatchNumber',
      sapSortDir: 1,
    };
    dashboard._loadSapDispatchDetails = vi.fn();

    dashboard._renderSapTable();

    expect(document.querySelector('#sapBody [role="status"]')?.textContent).toBe('No assigned shipments yet.');
    expect(document.getElementById('sapResultCount').textContent).toBe('0 dispatches');
    expect(document.getElementById('sapStatAll').textContent).toBe('1');
  });

  test('keeps the SAP outage warning and retry available when the current filter has no rows', () => {
    dashboard.state = {
      sapLoading: false,
      sapLoadError: true,
      sapGroupedByDispatch: shipmentGroups(),
      sapAssignments: {},
      sapFilter: 'assigned',
      sapSortKey: 'SAPDispatchNumber',
      sapSortDir: 1,
    };
    dashboard._loadSapDispatchDetails = vi.fn();
    dashboard._syncSAP = vi.fn();

    dashboard._renderSapTable();

    expect(document.querySelector('#sapBody [role="alert"]')?.textContent).toContain('Showing the last shipment list that loaded.');
    expect(document.querySelector('#sapBody [role="alert"]')?.textContent).toContain('Do not use this old list for new assignments.');
    expect(document.querySelector('#sapBody [role="status"]')?.textContent).toBe('No assigned shipments yet.');
    const retryButton = document.querySelector('#sapBody [data-action="sap-retry"]');
    retryButton.click();
    expect(dashboard._syncSAP).toHaveBeenCalledOnce();
    expect(retryButton.disabled).toBe(true);
    expect(retryButton.getAttribute('aria-busy')).toBe('true');
    expect(retryButton.querySelector('.animate-spin')).not.toBeNull();
    expect(retryButton.textContent).toBe('Retrying');
  });

  test('shows a retryable outage message instead of claiming there are no shipments', () => {
    dashboard.state = {
      sapLoading: false,
      sapLoadError: true,
      sapGroupedByDispatch: {},
      sapAssignments: {},
      sapFilter: 'all',
    };
    dashboard._syncSAP = vi.fn();

    dashboard._renderSapTable();

    expect(document.querySelector('#sapBody [role="alert"]')?.textContent).toContain('SYSU App could not be reached.');
    expect(document.querySelector('#sapBody [role="alert"]')?.textContent).toContain('Check your internet and try again.');
    expect(document.querySelector('#sapBody')?.textContent).not.toContain('No shipments available.');
    document.querySelector('[data-action="sap-retry"]').click();
    expect(dashboard._syncSAP).toHaveBeenCalledOnce();
  });

  test('identifies SAP outages and exposes the server reference in the shipment tab', () => {
    SAPService.state = {
      lastError: 'HTTP 503',
      lastErrorStatus: 503,
      lastRequestId: 'sap-request-123',
    };
    dashboard.state = {
      sapLoading: false,
      sapLoadError: true,
      sapGroupedByDispatch: {},
      sapAssignments: {},
      sapFilter: 'all',
    };
    dashboard._syncSAP = vi.fn();

    dashboard._renderSapTable();

    const notice = document.querySelector('#sapBody [role="alert"]');
    expect(notice.textContent).toContain('SAP is temporarily unavailable.');
    expect(notice.textContent).toContain('Do not make new assignments');
    expect(notice.textContent).toContain('sap-request-123');
  });

  test('keeps the last successful shipment snapshot after an SAP refresh failure', async () => {
    const lastSuccessfulShipments = [{ SAPDispatchNumber: 'DISP-001' }];
    SAPService.fetchShipments = vi.fn().mockResolvedValue([]);
    SAPService.state.lastError = 'Network unavailable';
    SAPService.state.lastErrorStatus = null;
    SAPService.state.lastRequestId = null;
    dashboard.state = {
      sapShipments: lastSuccessfulShipments,
      sapLoading: false,
      sapLoadError: false,
    };
    dashboard._rebuildShipmentGroups = vi.fn();
    dashboard._renderAll = vi.fn();
    dashboard._renderSapTable = vi.fn();
    dashboard._updateConnectionBadge = vi.fn();

    await dashboard._syncSAP();

    expect(dashboard.state.sapShipments).toBe(lastSuccessfulShipments);
    expect(dashboard.state.sapLoadError).toBe(true);
    expect(dashboard.state.sapLoadFailure.title).toBe('SYSU App could not be reached.');
    expect(dashboard._renderAll).toHaveBeenCalledOnce();
    expect(dashboard._rebuildShipmentGroups).not.toHaveBeenCalled();
  });

  test('clears the SAP outage state after a successful retry', async () => {
    const shipments = [{ SAPDispatchNumber: 'DISP-002' }];
    SAPService.fetchShipments = vi.fn().mockResolvedValue(shipments);
    SAPService.state.lastError = null;
    SAPService.state.lastErrorStatus = null;
    SAPService.state.lastRequestId = null;
    dashboard.state = { sapShipments: [], sapLoading: false, sapLoadError: true };
    dashboard._rebuildShipmentGroups = vi.fn();
    dashboard._renderAll = vi.fn();
    dashboard._updateConnectionBadge = vi.fn();

    await dashboard._syncSAP();

    expect(dashboard.state.sapShipments).toBe(shipments);
    expect(dashboard.state.sapLoadError).toBe(false);
    expect(dashboard.state.sapLoadFailure).toBeNull();
    expect(dashboard._renderAll).toHaveBeenCalledOnce();
  });
});

describe('SAP connection help', () => {
  let Dashboard;
  let SAPService;
  let dashboard;

  beforeEach(async () => {
    document.body.innerHTML = `
      <div id="sapConnBadge"><div class="rounded-full"></div><span id="sapConnStatus"></span>
        <button id="sapConnHelpButton" class="hidden" aria-expanded="false"></button>
        <div id="sapConnHelpText" class="hidden">Error connecting to SAP, please check your internet connection.</div>
      </div>`;
    ({Dashboard} = await import('./dashboard.js'));
    ({SAPService} = await import('../api/sapService.js'));
    dashboard = Object.create(Dashboard.prototype);
  });

  test('shows an actionable, toggleable help message only while SAP is disconnected', () => {
    SAPService.state.lastError = 'Network unavailable';
    dashboard._updateConnectionBadge();

    const button = document.getElementById('sapConnHelpButton');
    const helpText = document.getElementById('sapConnHelpText');
    expect(document.getElementById('sapConnStatus').textContent).toBe('Disconnected');
    expect(button.classList.contains('hidden')).toBe(false);
    expect(helpText.classList.contains('hidden')).toBe(true);

    button.addEventListener('click', () => dashboard._toggleSapConnectionHelp());
    button.click();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(helpText.classList.contains('hidden')).toBe(false);
    expect(helpText.textContent).toContain('SYSU App could not be reached.');
    expect(helpText.textContent).toContain('Check your internet and try again.');

    button.click();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(helpText.classList.contains('hidden')).toBe(true);

    SAPService.state.lastError = null;
    dashboard._updateConnectionBadge();
    expect(document.getElementById('sapConnStatus').textContent).toBe('Connected');
    expect(button.classList.contains('hidden')).toBe(true);
    expect(helpText.classList.contains('hidden')).toBe(true);
  });
});

describe('assignment empty states', () => {
  let Dashboard;
  let dashboard;

  beforeEach(async () => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="assignDriverModal" class="hidden">
        <span id="assignModalDispatchNum"></span><span id="assignModalTruckType"></span>
        <div id="assignModalDriverList"></div><button id="assignConfirmBtn"></button>
        <div id="requestOverridePanel" class="hidden"></div>
        <select id="requestOverrideReason"></select>
      </div>
    `;
    ({ Dashboard } = await import('./dashboard.js'));
    dashboard = Object.create(Dashboard.prototype);
  });

  test('explains when no queued driver can be assigned to a shipment', () => {
    dashboard.state = {
      queue: [], drivers: [], sapAssignments: {}, queueLoading: false,
      queueLoadError: false, assignmentsLoading: false, assignmentsLoadError: false,
    };
    dashboard._getAvailableDrivers = vi.fn(() => []);
    dashboard._resumeApprovedOverride = vi.fn().mockResolvedValue(undefined);
    dashboard._ensureAdminQueueSubscriptions = vi.fn();

    dashboard.openAssignModal('DISP-001', 'AUV');

    expect(document.querySelector('#assignModalDriverList [role="status"]')?.textContent).toContain('No queued or eligible assigned drivers match the AUV truck type.');
  });

  test('distinguishes a driver availability failure from a genuine no-match result', () => {
    dashboard.state = {
      queue: [], drivers: [], sapAssignments: {}, queueLoading: false,
      queueLoadError: true, assignmentsLoading: false, assignmentsLoadError: false,
    };
    dashboard._getAvailableDrivers = vi.fn(() => []);
    dashboard._resumeApprovedOverride = vi.fn().mockResolvedValue(undefined);
    dashboard._ensureAdminQueueSubscriptions = vi.fn();

    dashboard.openAssignModal('DISP-001', 'AUV');

    expect(document.querySelector('#assignModalDriverList [role="alert"]')?.textContent).toContain('Driver availability could not be loaded.');
    expect(document.querySelector('#assignModalDriverList [role="status"]')).toBeNull();
  });

  test('explains when a fleet driver has no matching unassigned shipment', () => {
    dashboard.state = {
      queue: [{ id: 'driver-1', driverName: 'Test Driver', truckType: 'AUV' }],
      sapGroupedByDispatch: {},
      sapAssignments: {},
      sapLoadError: false,
    };
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});

    dashboard.openAssignModalForDriver('driver-1', 'AUV');

    expect(document.querySelector('#assignModalDriverList [role="status"]')?.textContent).toContain('No unassigned shipments available.');
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  test('shows clean assignment instructions and a consistent confirm button state', () => {
    dashboard.state = {
      queue: [{id: 'driver-1', driverId: 'driver-uid', driverName: 'Erwin Centeno', plateNumber: 'ABC-123'}],
      sapGroupedByDispatch: {
        '0010140501': [{OBDNumber: 'OBD-1', TruckType: 'AUV', Driver: '', Route: 'Warehouse --> Customer'}],
      },
      sapAssignments: {},
      sapLoadError: false,
    };

    dashboard.openAssignModalForDriver('driver-1', 'AUV');

    const confirmButton = document.getElementById('assignConfirmBtn');
    expect(document.getElementById('assignModalDispatchNum').textContent).toBe('Erwin Centeno — Select Dispatch');
    expect(document.querySelector('#assignModalDriverList [data-assignment-instructions]')?.textContent)
      .toBe('1 dispatch available. Select it to assign it to Erwin Centeno.');
    expect(confirmButton.textContent).toBe('Select a dispatch above');
    expect(confirmButton.disabled).toBe(true);

    dashboard._selectFleetDispatch('0010140501', 'driver-1');

    expect(confirmButton.textContent).toBe('Confirm Assignment');
    expect(confirmButton.disabled).toBe(false);
  });
});

describe('dispatch request API polling and resume', () => {
  let Dashboard;
  let SAPAssignmentService;
  let dashboard;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({Dashboard} = await import('./dashboard.js'));
    ({SAPAssignmentService} = await import('../api/sapAssignmentService.js'));
    dashboard = Object.create(Dashboard.prototype);
  });

  test('a missing cancel request returned as HTTP 404 stops polling and refreshes the views', async () => {
    vi.useFakeTimers();
    const getRequest = vi.spyOn(SAPAssignmentService, 'getCancelRequest').mockRejectedValue(
      Object.assign(new Error('Request not found'), {status: 404, code: 'HTTP_404'}),
    );
    const done = new Promise((resolve) => {
      dashboard._clearPendingCancel = vi.fn(resolve);
    });
    dashboard._resetCancelSelect = vi.fn();
    dashboard._showAssignBanner = vi.fn();
    dashboard._refreshBothViews = vi.fn();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      dashboard._pollCancelRequest('DISP-1', 'cancel-1');
      await done;
      expect(getRequest).toHaveBeenCalledWith('cancel-1');
      expect(dashboard._resetCancelSelect).toHaveBeenCalledWith('DISP-1');
      expect(dashboard._showAssignBanner).toHaveBeenCalledWith('Cancel request is no longer available.', 'info');
      expect(dashboard._refreshBothViews).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      log.mockRestore();
      getRequest.mockRestore();
      vi.useRealTimers();
    }
  });

  test('a missing override request returned as HTTP 404 clears stale token state and stops polling', async () => {
    vi.useFakeTimers();
    const getRequest = vi.spyOn(SAPAssignmentService, 'getOverrideRequest').mockRejectedValue(
      Object.assign(new Error('Request not found'), {status: 404, code: 'HTTP_404'}),
    );
    dashboard.state = {
      overrideRequestId: 'override-1', overrideTokenId: 'stale-token',
      overrideRequestStatus: 'pending', resumedOverrideTargetId: 'driver-1',
    };
    dashboard._applyConfirmLockState = vi.fn();
    dashboard._showAssignBanner = vi.fn();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const done = new Promise((resolve) => {
      dashboard._applyConfirmLockState.mockImplementation(resolve);
    });

    try {
      dashboard._pollOverrideRequest();
      await done;
      expect(getRequest).toHaveBeenCalledWith('override-1');
      expect(dashboard.state).toMatchObject({
        overrideRequestId: null, overrideTokenId: null,
        overrideRequestStatus: null, resumedOverrideTargetId: null,
      });
      expect(dashboard._showAssignBanner).toHaveBeenCalledWith(
        'Bypass request is no longer available. Submit a new request.', 'error',
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      log.mockRestore();
      getRequest.mockRestore();
      vi.useRealTimers();
    }
  });

  test('resume selects the newest approved MySQL request using its $timestamp decision time', async () => {
    vi.useFakeTimers();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const listRequests = vi.spyOn(SAPAssignmentService, 'listOverrideRequests').mockResolvedValue([
      {requestId: 'old-request', requestedBy: 'user-1', requestedDriverId: 'driver-old', status: 'approved',
        tokenId: 'old-token', tokenExpiresAt: expiresAt, decidedAt: {$timestamp: 1_000}},
      {requestId: 'new-request', requestedBy: 'user-1', requestedDriverId: 'driver-new', status: 'approved',
        tokenId: 'new-token', tokenExpiresAt: expiresAt, decidedAt: {$timestamp: 2_000}},
    ]);
    dashboard.state = {user: {id: 'user-1'}, overrideRequestId: null, overrideTokenId: null};
    dashboard._unlockDriverRows = vi.fn();
    dashboard._showAssignBanner = vi.fn();

    try {
      await dashboard._resumeApprovedOverride('DISP-1');
      expect(listRequests).toHaveBeenCalledWith('DISP-1');
      expect(dashboard.state).toMatchObject({
        overrideRequestId: 'new-request', overrideTokenId: 'new-token',
        overrideRequestStatus: 'approved', resumedOverrideTargetId: 'driver-new',
      });
      expect(dashboard._unlockDriverRows).toHaveBeenCalledWith('driver-new');
    } finally {
      listRequests.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

