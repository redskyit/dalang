const puppeteer = require('puppeteer');
const State = require('./state');
const Jest = require('./minijest');

/**
* The Dalang API.
*
* @class Dalang
**/
class Dalang extends State {

  // internal

  constructor() {
	super();
  }

  get timeout() {
	return (this.state.timeout - Date.now());	// ms left until timeout
  }
  set timeout(ms) {
	this.state = { timeout: Date.now() + ms };	// when to timeout in ms
  }

  async _nodeInfo() {
	const { page, element } = this.state;
    return await page.evaluate(el => ({
		nodeName: el.nodeName,
		textContent: el.textContent,
		value: el.value,
		selectedValue: el.selectedValue,
	}), element);
  }

  async _boundingBox() {
	const box = await this.state.element.boundingBox();
	box.x = Math.round(box.x,0);
	box.y = Math.round(box.y,0);
	box.width = Math.round(box.width,0);
	box.height = Math.round(box.height,0);
	return box;
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

  config({ defaultTimeout = 30, chrome, headless = false, sloMo } = { }) {
	this.__config = {
		defaultTimeout,
		chrome: Object.assign({}, chrome),
		headless,
		sloMo,
	};
	console.log('CONFIG: ' + JSON.stringify(this.__config));
	this.timeout = defaultTimeout * 1000;
  }

  // browser control

  async start({ width, height, args }) {
	const { sloMo, headless, chrome } = this.__config;
	console.log(`LAUNCH: WIDTH ${width} HEIGHT ${height} HEADLESS ${headless} SLOMO ${sloMo} `);
	args = [].concat(args||[]);
	if (width && height) args.push(`--window-size=${width+chrome.x},${height+chrome.y}`);
	args.push('--disable-extensions');			/* TODO make these optional? */
	args.push('--disable-infobars');
	args.push('--test-type=ui');
	args.push('--enable-automation');
	args.push('--unlimited-storage');
	console.dir(args);
	const browser = await puppeteer.launch({ headless, sloMo, args });
	const pages = await browser.pages();
	if (pages.length === 0) {
    	pages.push(await browser.newPage());
	}
    this.state = { browser, pages, page: pages[0] };
	pages[0].setViewport({ width, height });
  }

  async browserInfo() {
	const { page } = this.state;
	const size = await page.waitForFunction(() => {
		return { w: window.innerWidth, h: window.innerHeight };
	});
	return size;
  }

  async get(url) {
    await this.state.page.goto(url);
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
    await page.waitForSelector(selector, { timeout: this.timeout });
    const element = await page.$(selector);
	this.state = { type: "test-id", selector: testid, element };
    return element;
  }

  // informational

  async info() {
	const { page, element, type, selector } = this.state;
	const box = await this._boundingBox();
    const info = await this._nodeInfo();
	console.log(`${type} "${selector}" info tag ${info.nodeName} at ${box.x},${box.y} size ${box.width},${box.height}`);
  }

  // checks

  async check(check) {
    const { tag, value, selectedValue, textContent } = await this._nodeInfo();
	const text = tag === 'INPUT' ? value : tag === 'SELECT' ? selectedValue : textContent;
	console.log(text);
	Jest.expect(text).toBe(check);
  }

  async at(x,y) {
	const { page, element } = this.state;
	const box = await this._boundingBox();
	console.dir(box);
	Jest.expect(box.x).toBe(x);
	Jest.expect(box.y).toBe(y);
  }

  // actions

  async send(text) {
    return await this.state.element.type(text);
  }
  async click() {
	const { page, element } = this.state;
	return await element.click();
  }
}

module.exports = new Dalang();
module.exports.Dalang = Dalang;
