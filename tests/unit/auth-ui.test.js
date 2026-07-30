const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');

class TestClassList {
  constructor(initial = '') {
    this.classes = new Set(initial.split(/\s+/).filter(Boolean));
  }

  add(...classes) {
    classes.forEach((className) => this.classes.add(className));
  }

  remove(...classes) {
    classes.forEach((className) => this.classes.delete(className));
  }

  contains(className) {
    return this.classes.has(className);
  }

  toggle(className, force) {
    const shouldAdd = force === undefined ? !this.classes.has(className) : Boolean(force);
    if (shouldAdd) this.classes.add(className);
    else this.classes.delete(className);
    return shouldAdd;
  }

  toString() {
    return Array.from(this.classes).join(' ');
  }
}

class TestElement {
  constructor(id, className = '') {
    this.id = id;
    this.value = '';
    this.innerHTML = '';
    this.textContent = '';
    this.disabled = false;
    this.listeners = {};
    this.classList = new TestClassList(className);
  }

  addEventListener(type, handler) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(handler);
  }

  dispatchEvent(event) {
    const handlers = this.listeners[event.type] || [];
    handlers.forEach((handler) => handler(event));
  }

  appendChild(child) {
    this.child = child;
    return child;
  }

  remove() {}
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function response(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body
  };
}

function createHarness(fetchImpl) {
  const elements = new Map();
  const ids = [
    'login-container',
    'setup-container',
    'setup-error-container',
    'dashboard-container',
    'main-footer',
    'login-password',
    'login-username',
    'login-setup-link',
    'login-create-account-link',
    'setup-login-link',
    'retry-setup-status-btn',
    'setup-submit-btn',
    'setup-username',
    'setup-password',
    'setup-fullname',
    'setup-phone',
    'toast-container'
  ];

  ids.forEach((id) => elements.set(id, new TestElement(id, id === 'setup-container' || id === 'login-setup-link' ? 'hidden' : '')));
  elements.get('setup-username').value = 'OwnerUser';
  elements.get('setup-password').value = 'secret1';
  elements.get('setup-fullname').value = 'Owner User';

  const documentListeners = {};
  const context = {
    console,
    fetch: fetchImpl,
    setTimeout: (fn) => {
      if (typeof fn === 'function') fn();
      return 1;
    },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    localStorage: {
      removeItem: () => {}
    },
    document: {
      getElementById: (id) => elements.get(id) || null,
      createElement: () => new TestElement('created'),
      addEventListener: (type, handler) => {
        documentListeners[type] = documentListeners[type] || [];
        documentListeners[type].push(handler);
      }
    }
  };
  context.window = context;

  vm.createContext(context);
  vm.runInContext(appSource, context);

  return {
    context,
    elements,
    run: (code) => vm.runInContext(code, context),
    screen: () => vm.runInContext('authUiState.currentScreen', context),
    setupRequired: () => vm.runInContext('authUiState.setupRequired', context),
    fireDOMContentLoaded: async () => {
      for (const handler of documentListeners.DOMContentLoaded || []) {
        await handler();
      }
    }
  };
}

describe('Auth UI setup flow', () => {
  it('successful setup shows Login and a delayed setupRequired=true response cannot overwrite it', async () => {
    const status = deferred();
    const calls = [];
    const harness = createHarness((url) => {
      calls.push(url);
      if (url === '/api/setup/status') return status.promise;
      return Promise.resolve(response({ success: true }, true, 201));
    });

    const statusPromise = harness.run('checkSetupStatus()');
    await harness.run('handleSetup({ preventDefault() {} })');
    assert.equal(harness.screen(), 'login');
    assert.equal(harness.setupRequired(), false);

    status.resolve(response({ success: true, setupRequired: true }));
    await statusPromise;

    assert.equal(harness.screen(), 'login');
    assert.equal(calls.filter((url) => url === '/api/setup').length, 1);
  });

  it('multiple setup-status calls use only the latest response', async () => {
    const first = deferred();
    const second = deferred();
    let statusCalls = 0;
    const harness = createHarness((url) => {
      if (url !== '/api/setup/status') return Promise.reject(new Error(`Unexpected URL ${url}`));
      statusCalls += 1;
      return statusCalls === 1 ? first.promise : second.promise;
    });

    const firstPromise = harness.run('checkSetupStatus()');
    const secondPromise = harness.run('checkSetupStatus()');

    second.resolve(response({ success: true, setupRequired: false }));
    await secondPromise;
    first.resolve(response({ success: true, setupRequired: true }));
    await firstPromise;

    assert.equal(harness.screen(), 'login');
    assert.equal(harness.setupRequired(), false);
  });

  it('the Setup Login link opens Login without default form/navigation behavior', () => {
    const harness = createHarness(() => Promise.resolve(response({ success: true, setupRequired: true })));
    harness.run('authUiState.setupRequired = true; showAuthScreen("setup"); setupAuthNavigationHandlers();');

    const event = {
      type: 'click',
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      }
    };

    harness.elements.get('setup-login-link').dispatchEvent(event);

    assert.equal(event.defaultPrevented, true);
    assert.equal(event.propagationStopped, true);
    assert.equal(harness.screen(), 'login');
  });

  it('an existing owner shows Login directly and hides Create Account', async () => {
    const harness = createHarness(() => Promise.resolve(response({ success: true, setupRequired: false, hasOwner: true })));

    await harness.run('checkSetupStatus()');

    assert.equal(harness.screen(), 'login');
    assert.equal(harness.elements.get('login-setup-link').classList.contains('hidden'), true);
  });

  it('the Login Create Account link is disabled once setup status is false', () => {
    const harness = createHarness(() => Promise.resolve(response({ success: true, setupRequired: false })));
    harness.run('authUiState.setupRequired = false; showAuthScreen("login"); setupAuthNavigationHandlers();');

    harness.elements.get('login-create-account-link').dispatchEvent({
      type: 'click',
      preventDefault() {},
      stopPropagation() {}
    });

    assert.equal(harness.screen(), 'login');
    assert.equal(harness.elements.get('login-setup-link').classList.contains('hidden'), true);
  });

  it('account creation is submitted only once while a request is in flight', async () => {
    const setup = deferred();
    const calls = [];
    const harness = createHarness((url) => {
      calls.push(url);
      if (url === '/api/setup') return setup.promise;
      return Promise.resolve(response({ success: true, setupRequired: true }));
    });

    const firstSubmit = harness.run('handleSetup({ preventDefault() {} })');
    const secondSubmit = harness.run('handleSetup({ preventDefault() {} })');
    setup.resolve(response({ success: true }, true, 201));
    await Promise.all([firstSubmit, secondSubmit]);

    assert.equal(calls.filter((url) => url === '/api/setup').length, 1);
    assert.equal(harness.screen(), 'login');
  });
});
