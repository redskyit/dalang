const { StringTokeniser } = require('./tokeniser');
const fs = require('fs');
const path = require('path');
const T = require('./truthy');
const { spawn } = require('child_process');

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
    this.waits = [];
    this.state = {};
    this.console = [];
    this.epoch = Date.now();
  }

  log(token, message) {
    const s = ((Date.now()-this.epoch)/1000).toLocaleString('en-GB', { minimumIntegerDigits: 2, minimumFractionDigits: 3 });
    console.log(`${s} [${this.scripts[this.scripts.length-1].name},${token.lineno}] ${this.state.skip ? '// ' : ''}${message}`);
  }

  async open(fn, cwd) {
    return new Promise((ok,r) => {
      if (!path.isAbsolute(fn)) {
        fn = path.normalize(path.join(cwd, fn));
      }
      fs.readFile(fn, { encoding: "utf8" }, (err, data) => {
        if (err) r(err); 
        else {
          const tokeniser = new StringTokeniser({ });
          tokeniser.set(data);
          ok({ tokeniser, fn, dirname: path.dirname(fn) });
        }
      });
    });
  }

  async run(script, cwd) {
    this.scripts.push({ cwd: cwd, path: path, name: path.basename(script) });
    const { tokeniser, dirname } = await this.open(script, cwd);
    let token = tokeniser.next();
    let next;
    while (token.type !== EOF) {
      // console.log('run: ', token);
      // Parse this token
      try {
        next = await this.parseToken(token, tokeniser, { cwd: dirname });
      } catch(e) {
        this.exception = e;
      }

      // If there was an exception then display test failure
      if (this.exception) {
        token = this.exceptionToken || token;
        this.exceptionToken = null;
        console.error('');
        console.error(`--- Test Script Failure --- at line ${token.lineno} in ${script} [${token.token}]`);
        console.error(this.exception);
        console.error(`--- Test Script Failure --- at line ${token.lineno} in ${script}`);
        console.error('');
        break;
      }
      token = next ? next : tokeniser.next();
    }
    if (this.exception) {
      const onfail = this.aliases["--onfail"];
      if (onfail) await this.runAlias(onfail);
      await this.stop();
      throw this.exception;
    } else {
      const onsuccess = this.aliases["--onsuccess"];
      if (this.scripts.length == 1) {
        if (onsuccess) {
          await this.runAlias(onsuccess);
        }
        await this.stop();
      }
    }
    this.scripts.pop();
  }

  async runTokens(tokens, vars) {

    // tokeniser that returns tokens from an array, expanding vars if necessary
    const tokeniser = (function(tokens) {
      let i = 0,v;
      const expand = (token) => {
        let s = token.token;
        // Expand $name variables
        let a = s.match(/\$[a-z][a-zA-Z0-9]*/g);
        if (a) {
          a.forEach(match => {
            if (match === s) {
              // token is just $name, replace token with arg
              v = vars[match.substr(1)];
              s = v.token;
              token.type = v.type;
            } else {
              // part of larger string
              s = s.replace(match, vars[match.substr(1)]);
              token.type = STRING;
            }
          });
          token.token = s;
        }
        // Expand $I(name) and $(name) variables
        if (token.type === STRING) {
          a = s.match(/\$[I]*\([^) ]*\)/g);
          if (a) {
            a.forEach(match => {
              const a = match.split(/[()]/);
              v = vars[a[1]];
              if (a[0][1] === 'I') v.token = v.token|0;
              if (match === s) {
                // token is just the variable, token becomes the variable type
                s = v.token;
                token.type = v.type;
              } else {
                s = s.replace(match, v.token);
                token.type = STRING;
              }
            });
            token.token = s;
          }
        }
      };
      const get = () => {
          const token = i == tokens.length ? { token: "", type: EOF } : Object.assign({}, tokens[i]);
          if (vars && token.type === STRING) {
            expand(token);
          }
          return token;
      };
      return {
        next() {
          const token = get();
          if (token.type !== EOF) i++;
          return token;
        },
        peek() {
          return get();
        }
      }
    })(tokens);

    let token = tokeniser.next();
    let next;
    while (token.type !== EOF) {
      try {
        next = await this.parseToken(token, tokeniser);
      } catch(e) {
        this.exception = e;
        this.exceptionToken = token;
        throw e;
      }
      token = next ? next : tokeniser.next();
    }
  }

  async runAlias(alias, args) {
    this.scripts.push({ cwd: this.scripts[this.scripts.length-1].cwd, path: null, name: alias.name });
    await this.runTokens(alias.tokens, args);
    this.scripts.pop();
  }

  async exec(token, cmd, cwd) {

    // normalise path to command
    if (!path.isAbsolute(cmd.name)) {
      cmd.name = path.normalize(path.join(cwd, cmd.name));
    }
    this.log(token, `> ${cmd.name} ${cmd.args.join(' ')}`);

    return new Promise((ok,r) => {
      const proc = spawn(cmd.name, cmd.args, { cwd: this.scripts[0].cwd });
      let l = {};
      function out(n,d) {
        if (d) {
          const lines = d.toString().split('\n');
          if (l[n]) lines[0] = l[n] + lines[0];
          l[n] = lines.pop();
          lines.map(line => console.log(`${n}> ${line}`));
        } else if (l[n]) {
          console.log(`${n}> ${l[n]}`);
        }
      }
      proc.stdout.on('data', (data) => out('stdout',data));
      proc.stderr.on('data', (data) => out('stderr',data));
      proc.on('close', (code) => {
        out('stdout'); out('stderr');
        if (code !== 0) {
          this.log(token, `process exited with code ${code}`);
          r(code);
        } else {
          ok();
        }
      });
    });
  }

  async start(options) {
    const { dalang, page } = this;
    if (!page) {
      // need to start browser
      this.page = await dalang.start(options);
      this.captureConsole();
      return page;
    }
    return page;
  }

  async stop() {
    await this.dalang.close();
  }

  async captureConsole() {
    const { page } = this;
    page.on('console', msg => {
      this.console.push(msg);
    });
  }

  async dumpConsole() {
    this.console.map(msg => {
      console.log(msg.text());
    });
    this.console = [];
  }

  async parseToken(token, tokeniser, opts) {
    const { dalang, aliases, state } = this;
    const { skip } = state;
    const { cwd } = opts || {};
    let arg, alias, nextToken, fn, call, exec, initial, statement, u;

    // if automatice logging is enabled, then copy browser log to output
    if (state.autoLog) {
      this.dumpConsole();
    }

    // get the next token, throw unexpected EOF error if hit EOF
    const next = (type, expect, eof) => {
      token = tokeniser.next();
      // console.log('parseTokens: next ', token);
      if (eof !== false && token.type === EOF) {
        this.exceptionToken = token;
        throw new Error('Unexpected end of file');
      }
      if (type !== u && token.type !== type) {
        this.exceptionToken = token;
        throw new Error(`TypeError: ${token.token} should be type ${type} but is type ${token.type}`);
      }
      if (expect !== u && expect.indexOf(token.token) === -1) {
        this.exceptionToken = token;
        throw new Error(`UnexpectedToken: got ${token.token} expected ${expect}`);
      }
      return token;
    }

    // report unexpected token
    const Unexpected = (token) => {
      this.exceptionToken = token;
      throw new Error(`Unexpected token '${token.token}' at line ${token.lineno}`);
    }

    // consume an argument list, for example (a b c) or { a b c }
    const consume = (delim, offset) => {
      const arr = [];
      const nextToken = tokeniser.peek();
      if (nextToken.type === 2) {
        if (nextToken.token === delim[0]) {
          let nested = 0;
          next();   // consume peeked delim
          next();   // get first argument or close delim
          while ((nested > 0 && token.type !== EOF) || token.token !== delim[1]) {
            if (token.type === 2) {
              if (token.token === delim[0]) {
                nested ++;
              } else if (token.token === delim[1]) {
                nested --;
              }
            }
            token.lineno -= (offset - 1);
            arr.push(token);
            next();
          }
        }
      }
      return arr;
    }

    // parse a,b with range and wildcard support a1:a2,b *,b etc
    const parseAB = () => {       
      const ab = {};

      function getValue() {
        const arg = next();
        if (arg.type === SYMBOL && arg.token === '*') {
          return arg.token;
        } 
        if (arg.type === NUMBER) {
          if (arg.nextch === ':') {
            next();
            return [ arg.token, next(NUMBER).token ];
          }
          return arg.token;
        } 
        Unexpected(arg);
      }

      ab.a = getValue();
      next(SYMBOL, ',');
      ab.b = getValue();

      return ab;
    };

    const condition = (state, e) => {
      const { inif } = this.state;
      if (inif) {
        inif.result = state;
      } else {
        if (!state && e) throw e;
      }
    };

    // Parse token based on type
    switch (token.type) {
    case STRING:
      initial = token;
      statement = token.token;
      switch (token.token) {
      case "version":
        console.log(dalang.version());
        break;
      case "default":
        switch(next(STRING).token) {
        case "wait":
          state.defaultWait = next(NUMBER).token;
          this.log(initial, `${statement} wait ${state.defaultWait}`);
          break;
        case "screenshot":
          state.defaultScreenshot = next(STRING).token;
          this.log(initial, `${statement} screenshot ${state.defaultScreenshot}`);
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
          this.log(initial,`${statement} start`); 			// is a no-op we start later when we do browser size or get
          break;
        case "chrome":
          const chrome = browser.chrome = {};
          chrome.x = next(NUMBER).token;
          next(SYMBOL, ',');
          chrome.y = next(NUMBER).token;
          this.log(initial, `${statement} chrome ${JSON.stringify(chrome)}`);
          dalang.config({ chrome });
          break;
        case "size":
          const size = browser.size = {};
          size.width = next(NUMBER).token;
          next(SYMBOL, ',');
          size.height = next(NUMBER).token;
          this.log(initial,`${statement} size ${JSON.stringify(size)}`);
          await dalang.viewport(size);
          break;
        case "get":
          if (!browser.page) {
            browser.page = await this.start(Object.assign({}, browser.size, { args: this.options }));
          }
          const url = next(STRING).token;
          this.log(initial, `${statement} get "${url}"`);
          await dalang.get(url);
          break;
        case "close":
          if (browser.page) {
            await dalang.close();
            browser.page = null;
          }
          break;
        case "wait":
          state.browserWait = next(NUMBER).token;
          this.log(initial, `${statement} wait ${state.browserWait}`);
          break;
        default:
          Unexpected(token);
          break;
        }
        break;
      case "include":
        fn = next(STRING).token;
        this.log(initial,`${statement} "${fn}"`);
        if (!skip) await this.run(fn, cwd);
        break;
      case "call":
        call = { name: next(STRING).token };
        call.args = consume('{}', token.lineno).map(arg => arg.type == NUMBER ? arg.token :  "'" + arg.token + "'");
        this.log(initial, `${statement} ${call.name} { ${call.args.join(',')} }`);
        if (!skip) {
          try {
            await dalang.call(call.name, call.args);
          } catch(e) {
            console.dir(e);
          }
        }
        break;
      case "alias":
        initial = token;
        alias = { name: next(STRING).token };
        alias.args = consume('()', token.lineno);           // consume arguments
        alias.tokens = consume('{}', token.lineno);         // consume body
        this.log(initial,`${statement} ${alias.name} (${alias.args.map(a => a.token).join(' ')}) { ... }`);
        if (!skip) aliases[alias.name] = alias;
        break;
      case "test-id": case "field":
        arg = next(STRING).token;
        this.log(initial,`${statement} "${arg}"`);
        if (!skip) {
          try {
            await dalang.testid(arg, { wait: state.browserWait * 1000 });
            condition(true);
          } catch (e) {
            condition(false, e);
          }
        }
        break;
      case "select": 
        arg = next(STRING).token;
        this.log(initial,`${statement} "${arg}"`);
        if (!skip) {
          try {
            await dalang.select(arg, { wait: state.browserWait * 1000 });
            condition(true);
          } catch(e) {
            condition(false, e);
          }
        }
        break;
      case "xpath": 
        arg = next(STRING).token;
        this.log(initial,`${statement} "${arg}"`);
        if (!skip) {
          try {
            await dalang.xpath(arg, { wait: state.browserWait * 1000 });
            condition(true);
          } catch(e) {
            condition(false, e);
          }
        }
        break;
      case "log":
        arg = next(STRING).token;
        switch(arg) {
        case "auto":
          arg = next(STRING).token;
          this.log(initial,`${statement} auto ${arg}`);
          if (!skip) state.autoLog = T(arg);
          break;
        case "dump":
          this.log(initial,`${statement} dump`);
          if (!skip) await this.dumpConsole(); 
          break;
        default:
          Unexpected(token);
          break;
        }
        break;
      case "dump":
        this.log(initial,statement);
        if (!skip) await dalang.dump(); 
        break;
      case "info": 
        this.log(initial,statement);
        if (!skip) await dalang.info(); 
        break;
      case "click": case "click-now":     // TODO: For now, click and click-now are the same
        this.log(initial,statement);
        if (!skip) {
          try {
            await dalang.click(); 
            condition(true);
          } catch(e) {
            condition(false,e);
          }
        }
        break;
      case "screenshot": 
        arg = next(STRING).token;
        this.log(initial,`${statement} "${arg}"`);
        if (!skip) await dalang.screenshot(arg);
        break;
      case "sleep": 
        arg = next(NUMBER).token;
        this.log(initial,`${statement} ${arg}`);
        if (!skip) await dalang.sleep(arg); 
        break;
      case "tag": 
        arg = next(STRING).token;
        this.log(initial,`${statement} "${arg}"`);
        if (!skip) {
          try {
            await dalang.tag(arg);
            condition(true);
          } catch(e) {
            condition(false,e);
          }
        }
        break;
      case "not":
        this.log(initial,statement);
        if (!skip) await dalang.not();
        break;
      case "displayed":
        this.log(initial,statement);
        if (!skip) {
          try {
            await dalang.displayed();
            condition(true);
          } catch(e) {
            condition(false,e);
          }
        }
        break;
      case "enabled":
        this.log(initial,statement);
        if (!skip) {
          try {
            await dalang.enabled();
            condition(true);
          } catch(e) {
            condition(false,e);
          }
        }
        break;
      case "selected":
        this.log(initial,statement);
        if (!skip) {
          try {
            await dalang.selected();
            condition(true);
          } catch(e) {
            condition(false,e);
          }
        }
        break;
      case "at": 
        const { a: x, b: y } = parseAB();
        this.log(initial,`${statement} ${x},${y}`);
        if (!skip) {
          try { 
            await dalang.at(x,y);
            condition(true);
          } catch(e) {
            condition(false,e);
          }
        }
        break;
      case "size": 
        const { a: width, b: height } = parseAB();
        this.log(initial,`${statement} ${typeof width === "object" ? width.join(':') : width},${typeof height === "object" ? height.join(':') : height }`);
        if (!skip) {
          try {
            await dalang.size(width,height);
            condition(true);
          } catch(e) {
            condition(false,e);
          }
        }
        break;
      case "check":
        arg = next(STRING).token;
        this.log(initial,`${statement} "${arg}"`);
        if (!skip) {
          try {
            await dalang.check(arg);
            condition(true);
          } catch(e) { 
            condition(false,e);
          }
        }
        break;
      case "checksum":
        arg = next(STRING).token;
        this.log(initial,`${statement} "${arg}"`);
        if (!skip) {
          try {
            dalang.checksum(arg);
            condition(true);
          } catch(e) {
            condition(false,e);
          }
        }
        break;
      case "wait":
        arg = next(NUMBER).token;
        this.log(initial,`${statement} ${arg}`);
        if (!skip) {
          this.epoch = Date.now();
          await dalang.wait(arg);
        }
        break;
      case "echo":
        arg = next(STRING).token;
        if (!skip) this.log(initial,`// ${arg}`);
        else this.log(initial,`${keyword} "$arg"`);
        break;
      case "set":
        arg = next(STRING).token;
        this.log(initial,`${statement} "${arg}"`);
        if (!skip) {
          await dalang.clear();
          await dalang.send(arg);
        }
        break;
      case "send":
        arg = next(STRING).token;
        this.log(initial,`${statement} "${arg}"`);
        if (!skip) {
          await dalang.send(arg);
        }
        break;
      case "push":
        arg = next(STRING).token;
        switch (arg) {
        case "wait":
          this.log(initial, `${statement} ${arg}`);
          if (!skip) this.waits.push(dalang.timeout);
          break;
        default:
          this.log(initial, `${statement} ${arg}`);
          Unexpected(token);
          break;
        }
        break;
      case "pop":
        arg = next(STRING).token;
        switch (arg) {
        case "wait":
          this.log(initial, `${statement} ${arg}`);
          if (!skip) dalang.timeout = this.waits.pop();
          break;
        default:
          this.log(initial, `${statement} ${arg}`);
          Unexpected(token);
          break;
        }
        break;
      case "exec":
        initial = token;
        exec = { name: next(STRING).token };
        exec.args = consume('()', token.lineno);           // consume arguments (...)
        if (!exec.args.length) {
          exec.args = consume('{}', token.lineno);         // consume arguments {...} (old style)
        }
        exec.args = exec.args.map(arg => arg.token);
        this.log(initial,`${statement} ${exec.name} ${exec.args.join(' ')}`);
        if (!skip) {
          try {
            await this.exec(initial, exec, cwd);
            condition(true);
          } catch(e) {
            condition(false,e);
          }
        }
        break;
      case "if":
        this.log(initial,`${statement}`);
        state.inif = {};
        state.skip = false;
        break;
      case "then":
        this.log(initial,`${statement}`);
        if (!state.inif) Unexpected(initial);
        if (!state.inif.result) state.skip = true;
        break;
      case "endif":
        state.skip = false;
        state.inif = null;
        this.log(initial,`${statement}`);
        break;
      case "fail":
        arg = next(STRING).token;
        this.log(initial,`${statement} "${arg}"`);
        if (!skip) throw arg;
        break;
      default:
        alias = aliases[statement];
        if (alias === undefined) {
          Unexpected(token);
        } else {
          const values = [];  // argument values
          arg = {};           // map of tokens that equate to named arguments
          alias.args.forEach(token => values.push((arg[token.token] = next()).token));          // pick up any arguments
          this.log(initial,`${statement} ${values.join(' ')}`);
          if (!skip) await this.runAlias(alias, arg);
        }
      }
      break;
    }

    // sometimes we will read one token too many, so we return it as the next token,
    // which will be given straight back to parseToken
    return nextToken;   
  }
}

module.exports = DalangParser;
	
/* vim: set ai ts=2 sw=2 expandtab smarttab softtabstop=2 : */
