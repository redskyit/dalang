const puppeteer = require('puppeteer');
const crc32 = require('crc').crc32;
const State = require('./state');
const Jest = require('./minijest');
const Parser = require('./parser');
const VERSION = require('./version');
const { exec } = require('child_process');
const ps = require('ps-node');

/**
* The Dalang API.
*
* @class Dalang
**/
class Dalang extends State {

  // internal

  constructor() {
    super();
    this.__config = {
      defaultTimeout: 30,
      extraTimeout: 0,
      waitMultiplier: 1,
      chrome: { x: 0, y: 0 },
      selenium: false,              // ScriptDriver compatible
      headless: true,
      sloMo: 0,
    };
    this.timeout = this.__config.defaultTimeout * 1000;
  }

  version() {
    return VERSION;
  }

  async run(script, config = {}) {
    Object.assign(this.__config, config);
    const parser = new Parser(this, { wordChars: /[A-Za-z0-9$#_\-]/ });
    await Jest.test(script, async () => {
      await parser.run(script, config.cwd || process.cwd()).catch(e => {
        // handle failure
        console.log('parser exception');
        console.log(e);
      });
    });
  }

  get timeout() {
    return (this.state.timeout - Date.now());	// ms left until timeout
  }
  set timeout(ms) {
    this.state = { timeout: Date.now() + ms };	// when to timeout in ms
  }

  _assertions(element = this.state.element) {
    if (!element) throw new Error('Fatal error, no current selection');
  }

  async _nodeInfo(element = this.state.element) {
    const { page, infoElement } = this.state;
    let { info } = this.state;
    if (infoElement !== element) {
      this.state.infoElement = element;
      this._assertions(element);
      try {
        info = this.state.info = await page.evaluate(el => dalang._nodeInfo(el), element);
      } catch(e) {
        console.log(e);     // probably due to a bug in dalang
        throw e;
      }
    }
    return info;
  }

  async _boundingBox(element = this.state.element) {
    this._assertions(element);
    const box = await element.boundingBox();
    return box ? box : { x: 0, y: 0, width: 0, height: 0 };
  }

  // test interface
  async test(name, f) {
    Jest.test(name, f);
  }

  // puppeteer interface:
  //  dalang.puppeteer(async (browser, page) => { ... })
  async puppeteer(f) {
    await f(this.state.browser, this.state.page);
  }

  // configuration

  config(config) {
    this.__config = Object.assign(this.__config, config);
    console.log('CONFIG: ' + JSON.stringify(this.__config));
  }

  arg(arg) {
    const args = this.__config.args;
    if (args.indexOf(arg) === -1) args.push(arg);
  }

  // browser control

  async start({ width, height, args } = {}) {
    const { sloMo, headless, chrome } = this.__config;
    console.log(`LAUNCH: WIDTH ${width} HEIGHT ${height} HEADLESS ${headless} SLOMO ${sloMo} `);
    args = [].concat(args||[]);
    this.config({ args });
    if (width && height) this.arg(`--window-size=${width+chrome.x},${height+chrome.y}`);
    args.push('--no-startup-window');
    args.push('--disable-dev-shm-usage');
    args.push('--disable-crash-reporter');
    args.push('--disable-breakpad');      // crash reporter can cause browser.close() to hang
    console.dir(args);
    const browser = await puppeteer.launch({ headless, sloMo, args });
    console.log('browser endpoint ' + browser.wsEndpoint());
    browser.on('disconnected', () => console.log(`browser disconnected`));
    const pages = await browser.pages();
    if (pages.length === 0) {
        pages.push(await browser.newPage());
    }
    this.state = { browser, pages, page: pages[0] };
    if (width && height) await this.viewport({ width, height });
    return pages[0];
  }

  async viewport({ width, height }) {
    const { page, browser } = this.state;
    if (page) {
      await page.setViewport({ width, height });
      const { _connection } = browser;
      const { chrome } = this.__config;
      height += chrome.y;
      width += chrome.x;
      const { targetInfos: [{ targetId }]} = await _connection.send('Target.getTargets');
      const { windowId } = await _connection.send('Browser.getWindowForTarget', { targetId });
      await _connection.send('Browser.setWindowBounds', { bounds: { height, width }, windowId });
    }
  }

  async browser(command, args) {
      await this.state.browser._connection.send(command, args);
  }

  async browserInfo() {
    const { page } = this.state;
    const size = await page.waitForFunction(() => {
      return { w: window.innerWidth, h: window.innerHeight };
    });
    return size;
  }

  async _injectDalangBrowserAPI() {
    await this.state.page.evaluate(`
      window.dalang = {
        _nodeInfo: function(el) {
          const start = Date.now();
          const info = {
            nodeName: el.nodeName.toLowerCase(),
            testid: el.getAttribute('test-id'),
            value: el.value,
            selectedValue: el.selectedValue,
            displayed: this.isShown(el),
            enabled: !el.disabled,
            selected: el.checked,        // TODO how do we do this in puppeteer?
          };
          info.textContent = info.displayed ? dalang.getVisibleText(el) : '';
          info.outerHTML = el.outerHTML;
          info.took = Date.now() - start;
          return info;
        },
        _isBlock: function(el) {
          var display = getComputedStyle(el).display;
          if (display) {
            switch (display) {
              case "block": return true;
              case "inherit": break;
              default: return false;
            }
          }
          switch(node.nodeName) {
          case "SPAN": case "B": case "I":
            return false;
          }
          return true;
        },
        getVisibleText: function(el) {
          var text = '', s, cns = el.childNodes;
          for (var i = 0; i < cns.length; i++) { 
            var node = cns[i];
            var sep = ' ';
            if (node.nodeType == 1) {
              switch(node.nodeName) {
              case "STYLE": case "SCRIPT": break;
              default:
                s = this.getVisibleText(node);
                if (this._isBlock(node)) sep = '\\n';
                break;
              }
            } else if (node.nodeType == 3) {
              s = node.textContent;
            } else {
              s = '';
            }
            s = s.replace(/[\\n]+/g,'\\n').replace(/^[ \\t\\n]+|[ \\t\\n]+$/,'');   // trim only soft space
            if (s) {
              text = (text && text + sep) + s;
            }
          }
          return text.replace(String.fromCharCode(160),' ');
        },
        _parentsDisplayed: function (el) {
          if (el = el.parentElement) {
            const style = window.getComputedStyle(el);
            if (style.display === 'none') return false;
            return this._parentsDisplayed(el);
          }
          return true;
        },
        // https://github.com/SeleniumHQ/selenium/blob/e09e28f016c9f53196cf68d6f71991c5af4a35d4/javascript/atoms/dom.js#L437
        // Attempting to emulate as closely as necessary the isShown function in selenium
        isShown: function(el) {
          if (el.nodeName === "BODY") return true;                                          // BODY always shown
          if (el.nodeName === "INPUT" && el.type.toLowerCase() === "hidden") return false;  // hidden input fields are hidden
          if (el.nodeName === "NOSCRIPT") return false;                                     // noscript element is hidden
          const style = window.getComputedStyle(el);
          if (style.visibility === 'invisible' || style.visibility === 'collapsed') return false;  // invisible is hidden
          if (style.display === 'none') return false;                                       // display none is hidden
          if (!this._parentsDisplayed(el)) return false;                                    // parents are display none
          if (style.opacity == 0) return false;                                             // opacity 0 is hidden
          if (el.offsetWidth == 0 || el.offsetHeight == 0) return false;                    // not positive size is hidden
          return true;
        }
      };
    `);
  }

  async get(url) {
    await this.state.page.goto(url);
    await this._injectDalangBrowserAPI();
  }

  async kill() {
    ps.lookup({ command: 'Chromium' }, (e, procs) => {
      procs.forEach(proc => {
        if (proc.args[0] === 'Framework.framework/Helpers/crashpad_handler') {
          console.dir(proc);
        }
      });
    });
    console.log(`kill $(ps -ef | awk '/puppeteer\/.local-chromium.*crashpad_handler/ { print $2; exit 0; }')`);
    exec(`kill $(ps -ef | awk '/puppeteer\/.local-chromium.*crashpad_handler/ { print $2; exit 0; }')`);
  }

  async close() {
    console.log('close browser');
    const timer = setTimeout(() => this.kill(),5000);
    this.state.closing = true;
    await this.state.browser.close();
    console.log('done close browser');
    clearTimeout(timer);
  }

  // timing

  async sleep(s) {
    return new Promise(resolve => setTimeout(resolve,s*1000));
  }

  wait(s) {
    const { defaultTimeout, extraTimeout, waitMultiplier } = this.__config;
    this.timeout = ((s == undefined ? defaultTimeout : s) + extraTimeout) * waitMultiplier * 1000;
  }
  
  async _selector(selector, type, opts = {}, wait, $) {
    const { page, not } = this.state;
    if (this.state.element) {
      this.state.element.dispose();
      this.state.element = null;
    }
    if (wait) {
      const options = { timeout: opts.wait || this.timeout };
      if (options.timeout === 0) options.timeout = 1;           // waitForSelector timeout 0 means forever
      try {
        await wait(page, options);
      } catch(e) {
        if (!this.state.not) {
          console.log('throw exception ' + e);
          throw e;
        }
        this.state.not = false;
      }
    }
    const element = await $(page);
    if (!not & !element) {
      console.log('throw exception failed to select element');
      throw new Error('failed to select element');
    }
    this.state = { type: type, selector, element, selopts: opts };
    return element;
  }

  // selectors

  /**
  * Wait for and select element identified by a css selector.
  *	@select
  * @param selector {string} css selector
  **/
  async select(selector, opts) {
    return await this._selector(
        selector, 'selector', opts,
        async (page, opts) => await page.waitForSelector(selector, opts),
        async (page) => await page.$(selector)
      );
  }

  /**
  * Wait for and select element identified by a xpath locator.
  *	@xpath
  * @param xpath {string} xpath
  **/
  async xpath(xpath, opts) {
    return await this._selector(
        xpath, 'xpath', opts,
        async (page, opts) => await page.waitForXPath(xpath, opts),
        async (page) => await page.$x(xpath)
      );
  }

  /**
  * Wait for and select element identified by test-id
  *	@testid
  * @param testid {string} test id
  **/
  async testid(testid, opts) {
    const selector = `*[test-id='${testid}']`;
    return await this._selector(
        testid, 'test-id', opts,
        async (page, opts) => await page.waitForSelector(selector, opts),
        async (page) => await page.$(selector)
      );
  }

  /**
  * Set current element to the active (focused) element.
  * @active
  **/
  async active() {
    return await this._selector(
        null, 'active', opts, null,
        async (page) => await page.evaluate('document.activeElement')
      );
  }

  // informational

  async info({ type = this.state.type, element = this.state.element, selector = this.state.selector } = {}) {
    this._assertions(element);
    const { page } = this.state;
    const box = await this._boundingBox(element);
    const info = await this._nodeInfo(element);
    const value = await this.__getValue(info);
    console.log(`${type} "${selector}" info tag ${info.nodeName}`
                + ` ${info.displayed ? '' : 'not '}displayed`
                + ` at ${Math.round(box.x)},${Math.round(box.y)} size ${Math.round(box.width,0)},${Math.round(box.height)}`
                + ` ${info.enabled ? '' : 'not '}enabled`
                + ` ${info.selected ? '' : 'not '}selected`
                + (value.indexOf('\n') == -1 ? ` check "${value}"` : ` checksum "crc32:${crc32(value).toString(10)}"`)
              );
  }

  async dump() {
    // find all test-ids and run info on them
    const { page } = this.state;
    const type = 'test-id';
    const els = await page.$$('*[test-id]');
    for (let element of els) {
      const selector = await page.evaluate(el => el.getAttribute('test-id'), element);
      await this.info({ type, selector, element });
    }
  }

  async call(name, args) {
    return await this.state.page.evaluate(`window.RegressionTest.test("${name}", [ ${args.join(',')} ])`);
  }

  // The wait timeout.  
  // When a wait timer is set in dalang (wait S) at point of being set, the timer starts.
  // commands that run following a wait timer being set will have their timeout calculates 
  // as the time remaining on our wait timer.  So for instance, we say wait 5 then we do
  // something that takes 2 seconds, we have 3 seconds left, so the next thing we do will
  // have a timeout set for 3 seconds, that takes 1 second, so the next thing has a timeout
  // of 2 seconds and so on.  The test script fails when the wait timer reaches 0.  The
  // wait timer can be reset at any time, so with 2 seconds left, if we do wait 5, we now
  // have 5 seconds left to do our tests.
  // The reason for what might seem an overly complicated wait timer, is that setting a
  // single timeout for all checks to use (say, everything times out in 30 seconds) means
  // that we have to wait at least 30 seconds for a test to fail, when in most cases, it
  // can be classed as a failure if it takes anything more than a few seconds.  The wait
  // mechanism allows for a very flexible timeout system that allows the test designer to
  // easily set appropriate wait timeouts for subsequent checks.
  async __waitFor(thing) {
    let exception;
    do {
      try {
        await thing();
        return;
      } catch(e) {
        exception = e;
        await this.sleep(0.1);
        await this._reselect();
      }
    } while(this.timeout > 0);
    console.log('wait timeout expired');
    throw exception || new Error('wait timeout expired');
  }

  async _reselect() {
    const { type, selector, selopts } = this.state;
    switch(type) {
    case "select":
      await this.select(selector, selopts);
      break;
    case "xpath":
      await this.xpath(selector, selopts);
      break;
    case "test-id":
      await this.testid(selector, selopts);
      break;
    case "active":
      await this.active();
      break;
    }
    this.state.infoElement = null;  // force _nodeInfo() to requery details
    await this.info();
  }

  async __getValue(info) {
      const { nodeName, value, selectedValue, textContent } = info || await this._nodeInfo();
      return nodeName === 'input' || nodeName === 'select' || nodeName === 'textarea' ? value : textContent;
  }

  // checks

  not() {
    this.state.not = true;
  }

  jest() {
    // returns a jest test object that does a not test if not is set.
    const jest = this.state.not ? Jest.dont() : Jest;
    this.state.not = false;
    return jest;
  }

  async selected() {
    this._assertions();
    const Jest = this.jest();
    try {
      await this.__waitFor(async () => {
        const info = await this._nodeInfo();
        Jest.expect(info.selected).toBe(true);
      });
    } catch(e) {
      throw e;
    }
  }

  async displayed() {
    this._assertions();
    const Jest = this.jest();
    try {
      await this.__waitFor(async () => {
        const info = await this._nodeInfo();
        Jest.expect(info.displayed).toBe(true);
      });
    } catch(e) {
      throw e;
    }
  }

  async enabled() {
    this._assertions();
    const Jest = this.jest();
    try {
      await this.__waitFor(async () => {
        const info = await this._nodeInfo();
        Jest.expect(info.enabled).toBe(true)
      });
    } catch(e) {
      throw e;
    }
  }

  async check(check) {
    this._assertions();
    const Jest = this.jest();
    try {
      await this.__waitFor(async () => {
        const text = await this.__getValue();
        Jest.expect(text).toBe(check);
      });
    } catch(e) {
      throw e;
    }
  }

  async checksum(sum) {
    this._assertions();
    const Jest = this.jest();
    try {
      await this.__waitFor(async () => {
        const text = await this.__getValue();
        if (sum.startsWith('crc32:')) {
          Jest.expect('crc32:'+crc32(text).toString(10)).toBe(sum);
        } else {
          throw new Error('Unknown checksum type');
        }
      });
    } catch(e) {
      throw e;
    }
  }

  async at(x, y) {
    const Jest = this.jest();
    const { page, element } = this.state;
    this._assertions(element);
    try {
      await this.__waitFor(async () => {
        const box = await this._boundingBox();
        if (x !== '*' && x !== undefined) {
          if (typeof x === "number") {
            // fuzzy logic, because box can be fraction, but tests use integers, rounding is unreliable
            Jest.expect(box.x).toBeWithin(x,1);
          } else {
            Jest.expect(box.x).toBeInRange(x[0], x[1]);
          }
        }
        if (y !== '*' && y !== undefined) {
          if (typeof y === "number") {
            Jest.expect(box.y).toBeWithin(y,1);
          } else {
            Jest.expect(box.y).toBeInRange(y[0], y[1]);
          }
        }
      });
    } catch(e) {
      throw e;
    }
  }

  async size(width, height) {
    const Jest = this.jest();
    const { page, element } = this.state;
    this._assertions(element);
    try {
      await this.__waitFor(async () => {
        const box = await this._boundingBox();
        if (width !== '*' && width !== undefined) {
          if (typeof width === "number") {
            Jest.expect(box.width).toBeWithin(width,1);
          } else {
            Jest.expect(box.width).toBeInRange(width[0], width[1]);
          }
        }
        if (height !== '*' && height !== undefined) {
          if (typeof height === "number") {
            Jest.expect(box.height).toBeWithin(height,1);
          } else {
            Jest.expect(box.width).toBeInRange(width[0], width[1]);
          }
        }
      });
    } catch(e) {
      throw e;
    }
  }

  async tag(name) {
    this._assertions();
    const Jest = this.jest();
    try {
      await this.__waitFor(async () => {
        const info = await this._nodeInfo();
        Jest.expect(info.nodeName).toBe(name.toLowerCase());
      });
    } catch(e) {
      throw e;
    }
  }

  // actions

  async clear() {
    const { page, element } = this.state;
    this._assertions(element);
    try {
      return await page.evaluate(el => el.value = '', element);
    } catch(e) {
      throw e;
    }
  }

  async send(text) {
    this._assertions();
    try {
      return await this.state.element.type(text);
    } catch(e) {
      throw e;
    }
  }

  async click() {
    const { page, element } = this.state;
    this._assertions(element);
    try {
      await this.__waitFor(async () => {
        switch (element._remoteObject.className) {
        case 'HTMLButtonElement':
          await element.click({ delay: 0 });
          break;
        case 'HTMLDivElement':
        default:
          await page.evaluate(el => el.click(), element);
          break;
        }
      });
    } catch(e) {
      throw e;
    }
  }

  async screenshot(fn) {
    const { page } = this.state;
    await page.screenshot({ path: fn });
  }

  async scrollIntoView() {
    const { page, element } = this.state;
    this._assertions(element);
    await page.evaluate(el => el.scrollIntoView(true), element);
  }

  mouseInit() {
    this.state.mouse = {};
  }

  async mouseBody() {
    const { page, element, mouse } = this.state;
    if (mouse.element) mouse.element.dispose();
    mouse.element = await page.$('body');
  }

  async mouseCenter() {
    const { page, mouse, element } = this.state;
    const box = await (mouse.element || element).boundingBox();
    await this.mouseMoveTo(mouse.pos = { x: (box.width/2) | 0, y: (box.height/2) | 0 });
  }

  async mouseClick() {
    const { page, mouse, element } = this.state;
    const box = await (mouse.element || element).boundingBox();
    await page.mouse.click(box.x + mouse.pos.x, box.y + mouse.pos.y);
  }

  async mouseDown() {
    const { page } = this.state;
    await page.mouse.down();
  }

  async mouseMoveTo(xy) {
    const { page, mouse, element } = this.state;
    const box = await (mouse.element || element).boundingBox();
    mouse.pos = Object.assign({}, xy);
    await page.mouse.move(box.x + xy.x, box.y + xy.y);
  }

  async mouseMoveBy(xy) {
    const { page, mouse, element } = this.state;
    const box = await (mouse.element || element).boundingBox();
    mouse.pos.x += xy.x;
    mouse.pos.y += xy.y;
    await page.mouse.move(box.x + mouse.pos.x, box.y + mouse.pos.y);
  }

  async mouseUp() {
    const { page } = this.state;
    await page.mouse.up();
  }

  mouseDispose() {
    const { element, mouse } = this.state;
    if (mouse.element) mouse.element.dispose();
    this.state.mouse = null;
  }

  async refresh() {
    const { page } = this.state;
    await page.evaluate('location.reload()');
    await page.waitForNavigation({ waitUntil: 'networkidle0' });
    await this._injectDalangBrowserAPI();
  }

}

module.exports = new Dalang();
module.exports.Dalang = Dalang;

/* vim: set ai ts=2 sw=2 expandtab smarttab softtabstop=2 : */
