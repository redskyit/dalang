const { StringTokeniser } = require('./tokeniser');
const fs = require('fs');
const path = require('path');

const { EOF, STRING, NUMBER, SYMBOL } = StringTokeniser;

/**
* @class DalangParser
**/
class DalangParser extends StringTokeniser {

  constructor(dalang, options) {
    super(options);
    this.dalang = dalang;
    this.aliases = {};
    this.options = [];
    this.prefs = [];
    this.scripts = [];
  }

  log(token, message) {
    console.log(`[${this.scripts[this.scripts.length-1]},${token.lineno}] ${message}`);
  }

  async open(fn) {
    return new Promise((ok,r) => {
      if (!path.isAbsolute(fn)) {
        fn = path.normalize(path.join(path.dirname(process.argv[1]), fn));
      }
      console.log('PARSER: open: ' + fn);
      fs.readFile(fn, { encoding: "utf8" }, (err, data) => {
        if (err) r(err); 
        else {
          const tokeniser = new StringTokeniser({ });
          tokeniser.set(data);
          ok(tokeniser, fn);
        }
      });
    });
  }

  async run(script) {
    this.scripts.push(script);
    const tokeniser = await this.open(script);
    let token = tokeniser.next();
    while (token.type !== EOF) {
      // console.log('run: ', token);
      // Parse this token
      try {
        await this.parseToken(token, tokeniser);
      } catch(e) {
        this.exception = e;
      }

      // If there was an exception then display test failure
      if (this.exception) {
        token = this.exceptionToken || token;
        console.error('');
        console.error(`--- Test Script Failure --- at line ${token.lineno} in ${script}`);
        console.error(this.exception);
        console.error(`--- Test Script Failure --- at line ${token.lineno} in ${script}`);
        console.error('');
        break;
      }
      token = tokeniser.next();
    }
    if (this.exception) {
      const onfail = this.aliases["--onfail"];
      if (onfail) await this.runAlias(onfail);
      throw this.exception;
    } else {
      const onsuccess = this.aliases["--onsuccess"];
      if (this.scripts.length == 1) {
        if (onsuccess) {
          await this.runAlias(onsuccess);
        } else {
          await this.dalang.close();
        }
      }
    }
    this.scripts.pop();
  }

  async runTokens(tokens) {

    // tokeniser that returns tokens from an array
    const tokeniser = (function(tokens) {
      let i = 0;
      return {
        next() {
          const token = i == tokens.length ? { token: "", type: EOF } : tokens[i++];
          // console.log('runTokens: tokeniser ', token);
          return token;
        }
      }
    })(tokens);

    let token = tokeniser.next();
    while (token.type !== EOF) {
      try {
        await this.parseToken(token, tokeniser);
      } catch(e) {
        this.exception = e;
        this.exceptionToken = token;
        break;
      }
      token = tokeniser.next();
    }
  }

  async runAlias(alias) {
    console.log(`run alias ${alias.name}`);
    this.scripts.push(alias.name);
    await this.runTokens(alias.tokens);
    this.scripts.pop();
  }

  async start(options) {
    const { dalang, page } = this;
    if (!page) {
      // need to start browser
      return this.page = await dalang.start(options);
    }
    return page;
  }

  async parseToken(token, tokeniser) {
    const { dalang, aliases } = this;
    let arg, alias;

    // get the next token, throw unexpected EOF error if hit EOF
    const next = (type, expect) => {
      token = tokeniser.next();
      // console.log('parseTokens: next ', token);
      if (token.type === EOF) {
        this.exceptionToken = token;
        throw new Error('Unexpected end of file');
      }
      if (type !== undefined && token.type !== type) {
        this.exceptionToken = token;
        throw new Error(`TypeError: ${token.token} should be type ${type} but is type ${token.type}`);
      }
      if (expect !== undefined && token.token !== expect) {
        this.exceptionToken = token;
        throw new Error(`UnexpectedToken: got ${token.token} expected ${expect}`);
      }
      return token;
    }

    const Unexpected = (token) => {
      this.exceptionToken = token;
      throw new Error(`Unexpected token '${token.token}' at line ${token.lineno}`);
    }

    // Parse token based on type
    switch (token.type) {
    case STRING:
      switch (token.token) {
      case "version":
        console.log(dalang.version());
        break;
      case "default":
        switch(next(STRING).token) {
        case "wait":
          console.log(`TODO: default wait ${next(NUMBER).token}`);
          break;
        default:
          Unexpected(token);
        }
        break;
      case "browser":
        let { browser } = this;
        switch(next(STRING).token) {
        case "option":
          const option = next(STRING).token;
          console.log(`TODO: browser option ${option}`);
          this.options.push(option);
          break;
        case "prefs":
          const pref = next(STRING).token;
          const value = next(STRING).token;
          console.log(`TODO: browser prefs ${pref} ${value}`);
          this.prefs.push({ pref, value });
          break;
        case "start":
          browser = this.browser = {};
          dalang.config({ headless: false, sloMo: 150 });
          this.log(token,'browser start'); 			// is a no-op we start later when we do browser size or get
          break;
        case "chrome":
          const chrome = browser.chrome = {};
          chrome.x = next(NUMBER).token;
          next(SYMBOL, ',');
          chrome.y = next(NUMBER).token;
          this.log(token, 'browser chrome ' + JSON.stringify(chrome));
          dalang.config({ chrome });
          break;
        case "size":
          const size = browser.size = {};
          size.width = next(NUMBER).token;
          next(SYMBOL, ',');
          size.height = next(NUMBER).token;
          this.log(token,'browser size ' + JSON.stringify(size));
          break;
        case "get":
          if (!browser.page) {
            browser.page = await this.start(Object.assign({}, browser.size, { args: this.options }));
          }
          const url = next(STRING).token;
          this.log(token, `browser get "${url}"`);
          await dalang.get(url);
          break;
        case "close":
          if (browser.page) {
            await dalang.close();
            browser.page = null;
          }
          break;
        case "wait":
          browser.wait = next(NUMBER).token;          // not needed?
          break;
        default:
          Unexpected(token);
          break;
        }
        break;
      case "include":
        const fn = next(STRING).token;
        this.log(token,`include "${fn}"`);
        await this.run(fn);
        break;
      case "alias":
        alias = { name: next(STRING).token, args: [], tokens: [] };
        let ln = token.lineno;
        let ob = next(SYMBOL).token;
        if (ob === '(') {
          // consume arguments
          while (next().token != ')') {
            alias.args.push(token.token);
          }
          ob = next(SYMBOL).token;
        }
        if (ob !== '{') Unexpected(token);
        // consume tokens up to closing '}'
        while (next().token != '}') {
          token.lineno -= ln;
          alias.tokens.push(token);
        }
        aliases[alias.name] = alias;
        this.log(token,`alias ${alias.name} ...`);
        break;
      case "test-id": 
        arg = next(STRING).token;
        this.log(token,`test-id "${arg}"`);
        await dalang.testid(arg);
        break;
      case "select": 
        arg = next(STRING).token;
        this.log(token,`select "${arg}"`);
        await dalang.select(arg);
        break;
      case "xpath": 
        arg = next(STRING).token;
        this.log(token,`xpath "${arg}"`);
        await dalang.xpath(arg);
        break;
	  case "log":
        this.log(token,'log');
        await dalang.log(); 
        break;
      case "dump":
        this.log(token,'dump');
        await dalang.dump(); 
        break;
      case "info": 
        this.log(token,'info');
        await dalang.info(); 
        break;
      case "click": 
        this.log(token,'click');
        await dalang.click(); 
        break;
      case "screenshot": 
        arg = next(STRING).token;
        this.log(token,`screenshot "${arg}"`);
        await dalang.screenshot(arg);
        break;
      case "sleep": 
        arg = next(NUMBER).token;
        this.log(token,`sleep ${arg}`);
        await dalang.sleep(arg); 
        break;
      case "tag": 
        arg = next(STRING).token;
        this.log(token,`tag "${arg}"`);
        await dalang.tag(arg);
        break;
      case "at": 
        const x = next(NUMBER).token; 
        next(SYMBOL,',');
        const y = next(NUMBER).token; 
        this.log(token,`at ${x},${y}`);
        try { await dalang.at(x,y); } catch(e) { throw e; }
        break;
      case "size": 
        const width = next(NUMBER).token; 
        next(SYMBOL,',');
        const height = next(NUMBER).token; 
        this.log(token,`size ${width},${height}`);
        try { await dalang.size(width,height).catch(e => { throw e }); } catch(e) { throw e; }
        break;
      case "check":
        const text = next(STRING).token;
        this.log(token,`check "${text}"`);
        try { await dalang.check(text); } catch(e) { 
          console.error('check failed');
          throw e; 
        }
        break;
      case "wait":
        arg = next(NUMBER).token;
        this.log(token,`wait ${arg}`);
        await dalang.wait(arg);
        break;
      case "echo":
        arg = next(STRING).token;
        this.log(token,`// ${arg}`);
        break;
      default:
        alias = aliases[token.token];
        if (alias === undefined) {
          Unexpected(token);
        } else {
          this.log(token,`found alias ${token.token}`);
          await this.runAlias(alias);
        }
      }
      break;
    }
  }
}

module.exports = DalangParser;
	
/* vim: set ai ts=2 sw=2 expandtab smarttab softtabstop=2 : */
