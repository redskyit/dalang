const puppeteer = require('puppeteer');
const State = require('./state');
const Jest = require('./minijest');
const Parser = require('./parser');
const VERSION = require('./version');

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
      chrome: { x: 0, y: 0 },
      headless: true,
      sloMo: 0,
    };
    this.timeout = this.__config.defaultTimeout * 1000;
  }

  version() {
    return VERSION;
  }

  async run(script, config) {
    const parser = new Parser(this, { wordChars: /[A-Za-z0-9$#_\-]/ });
    await Jest.test(script, async () => {
      await parser.run(script, config.cwd || process.cwd()).catch(e => {
        // handle failure
        console.error(e);
      });
    });
  }

  get timeout() {
    return (this.state.timeout - Date.now());	// ms left until timeout
  }
  set timeout(ms) {
    this.state = { timeout: Date.now() + ms };	// when to timeout in ms
  }

  async _nodeInfo(element = this.state.element) {
    const { page } = this.state;
    const info = await page.evaluate(el => {
      const info = {
        nodeName: el.nodeName.toLowerCase(),
        testid: el.getAttribute('test-id'),
        value: el.value,
        selectedValue: el.selectedValue,
        displayed: dalang.isShown(el),           // was el.style.display !== 'none',
        enabled: !el.disabled,
        selected: el.checked,                         // TODO how do we do this in puppeteer?
      };
      info.textContent = info.displayed ? dalang.getVisibleText(el) : "";
      return info;
    }, element);
    return info;
  }

  async _boundingBox(element = this.state.element) {
    const box = await element.boundingBox();
    if (box) {
      box.x = Math.round(box.x,0);
      box.y = Math.round(box.y,0);
      box.width = Math.round(box.width,0);
      box.height = Math.round(box.height,0);
      return box;
    }
    return { x: 0, y: 0, width: 0, height: 0 };
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
    console.dir(args);
    const browser = await puppeteer.launch({ headless, sloMo, args });
    const pages = await browser.pages();
    if (pages.length === 0) {
        pages.push(await browser.newPage());
    }
    this.state = { browser, pages, page: pages[0] };
    if (width && height) this.viewport({ width, height });
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

  async browserInfo() {
    const { page } = this.state;
    const size = await page.waitForFunction(() => {
      return { w: window.innerWidth, h: window.innerHeight };
    });
    return size;
  }

  async _initDalangBrowserAPI() {
    await this.state.page.evaluate(`
      window.dalang = {
        getVisibleText: function(el) {
          var text = '', s, cns = el.childNodes;
          for (var i = 0; i < cns.length; i++) { 
            var node = cns[i];
            if (node.nodeType == 1) {
              s = this.getVisibleText(node);
            } else if (node.nodeType == 3) {
              s = node.textContent;
            } else {
              s = '';
            }
            if (s) text = (text && text + ' ') + s.replace(/^[ ]+|[ ]+$/,'');   // trim only soft space
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
    await this._initDalangBrowserAPI();
  }

  async close() {
    await this.state.browser.close();
  }

  // timing

  async sleep(s) {
    return new Promise(resolve => setTimeout(resolve,s*1000));
  }

  wait(s) {
    this.timeout = (s||this.__config.defaultTimeout) * 1000;
  }
  
  // selectors

  /**
  * Wait for and select element identified by a css selector.
  *	@select
  * @param selector {string} css selector
  **/
  async select(selector) {
    const { page } = this.state;
    await page.waitForSelector(selector, { timeout: this.timeout });
    const element = await page.$(selector);
    this.state = { type: "selector", selector, element };
    return element;
  }

  /**
  * Wait for and select element identified by a xpath locator.
  *	@xpath
  * @param xpath {string} xpath
  **/
  async xpath(xpath) {
    const { page } = this.state;
    const options = { timeout: this.timeout };
    await page.waitForXPath(xpath, options);
    const element = await page.$x(xpath);
    this.state = { type: "xpath", selector: xpath, element };
    return element;
  }

  /**
  * Wait for and select element identified by test-id
  *	@testid
  * @param testid {string} test id
  **/
  async testid(testid) {
    const { page } = this.state;
    const selector = `*[test-id='${testid}']`;
    try {
      await page.waitForSelector(selector, { timeout: this.timeout });
    } catch(e) {
      console.dir(e);
      throw e;
    }
    const element = await page.$(selector);
    this.state = { type: "test-id", selector: testid, element };
    return element;
  }

  // informational

  async info({ type = this.state.type, element = this.state.element, selector = this.state.selector } = {}) {
    const { page } = this.state;
    const box = await this._boundingBox(element);
    const info = await this._nodeInfo(element);
    const value = await this.__getValue(info);
    console.log(`${type} "${selector}" info tag ${info.nodeName}`
                + ` ${info.displayed ? '' : 'not '}displayed`
                + ` at ${box.x},${box.y} size ${box.width},${box.height}`
                + ` ${info.enabled ? '' : 'not '}enabled`
                + ` ${info.selected ? '' : 'not '}selected`
                + ` check "${value}"`);
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

  async log() {
    // todo
    // console.log('TODO: implement browser log dump');
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
    while (this.timeout > 0) {
      try {
        await thing();
        return;
      } catch(e) {
        if (this.timeout <= 0) {
          console.error(e);
          throw e;
        }
        await this.sleep(0.1);
      }
    }
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

  async at(x, y) {
    const Jest = this.jest();
    const { page, element } = this.state;
    try {
      await this.__waitFor(async () => {
        const box = await this._boundingBox();
        if (x !== '*' && x !== undefined) {
          if (typeof x === "number") {
            Jest.expect(box.x).toBe(x);
          } else {
            Jest.expect(box.x).toBeInRange(x[0], x[1]);
          }
        }
        if (y !== '*' && y !== undefined) {
          if (typeof y === "number") {
            Jest.expect(box.y).toBe(y);
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
    try {
      await this.__waitFor(async () => {
        const box = await this._boundingBox();
        if (width !== '*' && width !== undefined) {
          if (typeof width === "number") {
            Jest.expect(box.width).toBe(width);
          } else {
            Jest.expect(box.width).toBeInRange(width[0], width[1]);
          }
        }
        if (height !== '*' && height !== undefined) {
          if (typeof height === "number") {
            Jest.expect(box.height).toBe(height);
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
    const Jest = this.jest();
    const info = await this._nodeInfo();
    Jest.expect(info.nodeName).toBe(name.toLowerCase());
  }

  // actions

  async clear() {
    const { page, element } = this.state;
    try {
      return await page.evaluate(el => el.value = '', element);
    } catch(e) {
      throw e;
    }
  }

  async send(text) {
    try {
      return await this.state.element.type(text);
    } catch(e) {
      throw e;
    }
  }

  async click() {
    const { page, element } = this.state;
    return await element.click();
  }

  async screenshot(fn) {
    const { page } = this.state;
    await page.screenshot({ path: fn });
  }
}

module.exports = new Dalang();
module.exports.Dalang = Dalang;

/* vim: set ai ts=2 sw=2 expandtab smarttab softtabstop=2 : */
