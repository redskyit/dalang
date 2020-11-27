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
          const tokeniser = new StringTokeniser();
          tokeniser.set(data);
          ok({ tokeniser, fn, dirname: path.dirname(fn) });
        }
      });
    });
  }

  logException(token, exception) {
    const script = this.scripts[this.scripts.length-1];
    console.log('');
    console.log(`--- Test Script Failure --- at line ${token.lineno} in ${script.name} [${token.token}]`);
    console.log(exception);
    console.log(`--- Stack Trace ---`);
    console.log(`${script.cwd}`);
    console.log(`  at line ${token.lineno} in ${script.name} [${token.token}]`);
    let lineno = script.lineno;
    for (let i = this.scripts.length - 2; i >= 0; i--) {
      console.log(`  at line ${lineno} in ${this.scripts[i].name}`);
      lineno = this.scripts[i].lineno;
    }
    console.log('');
  }

  // Consume and run tokens until EOF
  async _run(tokeniser, cwd) {
    let token = tokeniser.next();
    let next;
    while (token.type !== EOF) {
      // console.log('run: ', token);
      // Parse this token
      try {
        next = await this.parseToken(token, tokeniser, cwd && { cwd });
        if (this.aborting) break;
      } catch(e) {
        this.exceptionToken = token;
        throw e;
      }
      token = next ? next : tokeniser.next();
    }
  }

  async runString(script, name, cwd, lineno) {
    const tokeniser = new StringTokeniser({},script);
    this.scripts.push({ cwd, name, lineno });
    try {
      await this._run(tokeniser, cwd);
    } catch(e) {
      this.logException(this.exceptionToken, e);
      this.aborting = true;   // tells parents to abort
    }
    this.scripts.pop();
  }

  async run(script, cwd, lineno) {
    const { tokeniser, dirname } = await this.open(script, cwd);
    cwd = dirname;      // the scripts cwd is relative to it
    this.scripts.push({ cwd, name: path.basename(script), lineno });

    // Run the script
    try {
      await this._run(tokeniser, cwd);
    } catch(e) {
      this.logException(this.exceptionToken, e);
      this.aborting = true;   // tells parents to abort
    }

    // If leaving top level script, then run success/fail and stop browser
    if (this.scripts.length === 1) {
      if (this.aborting) {
        this.aborting = false;  // clear aborting flag else final aliases won't run
        const onfail = this.aliases["--onfail"];
        if (onfail) await this.runAlias(onfail);
      } else {
        const onsuccess = this.aliases["--onsuccess"];
        if (onsuccess) {
          await this.runAlias(onsuccess);
        }
      }
      await this.stop();
    }

    // remove script from stack
    this.scripts.pop();
  }

  async runTokens(tokens, opts = {}) {
    const { vars } = opts;

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
              if (a[0][1] === 'I') {
                v.token = v.token|0;
                v.type = NUMBER;
              }
              if (match === s) {
                // token is just the variable, token becomes the variable type
                if (token.quote) {
                  s = ""+v.token;
                } else {
                  s = v.token;
                  token.type = v.type;
                }
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

    await this._run(tokeniser, opts.cwd);
  }

  async runAlias(alias, args = null, lineno = 0) {
    this.scripts.push({ cwd: this.scripts[this.scripts.length-1].cwd, name: alias.name, lineno });
    try {
      await this.runTokens(alias.tokens, { vars: args });
    } catch(e) {
      this.logException(this.exceptionToken, e);
      this.aborting = true;
    }
    this.scripts.pop();
  }

  async exec(token, cmd, cwd) {

    const buffers = { stdout: '', stderr: '' };

    // normalise path to command
    cmd.full = path.isAbsolute(cmd.name) ? cmd.name : path.normalize(path.join(cwd, cmd.name));
    this.log(token, `> ${cmd.full} ${cmd.args.join(' ')}`);

    return new Promise((ok,r) => {
      const proc = spawn(cmd.full, cmd.args, { cwd: process.cwd() });
      let l = {};
      function out(n,s) {
        if (s) {
          buffers[n] += s;
          const lines = s.split('\n');
          if (l[n]) lines[0] = l[n] + lines[0];
          l[n] = lines.pop();
          lines.map(line => console.log(`${n}> ${line}`));
        } else if (l[n]) {
          console.log(`${n}> ${l[n]}`);
        }
      }
      proc.stdout.on('data', (data) => out('stdout',data.toString()));
      proc.stderr.on('data', (data) => out('stderr',data.toString()));
      proc.on('close', (code) => {
        out('stdout'); out('stderr');
        if (code !== 0) {
          const e = `process exited with code ${code}`;
          this.log(token, e);
          r(e);
        } else {
          ok(buffers);
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
    }
    return page;
  }

  async stop() {
    console.log('parser: dalang.close()');
    await this.dalang.close();
    console.log('parser: closed');
  }

  async connect({ websocket } = {}) {
    const { dalang, page } = this;
    if (!page) {
      this.page = await dalang.connect({ websocket });
      this.captureConsole();
    }
    return page;
  }

  async captureConsole() {
    const { page } = this;
    page.on('console', msg => {
      this.console.push(msg);
    });
  }

  async dumpConsole() {
    this.console.map(msg => {
      switch(msg.type()) {
      case 'log': case 'debug': case 'info': case 'error': case 'warning':
        console.log(msg.text());
        break;
      default:
        console.log(`${msg.type()}> ${msg.text()}`);
        break;
      }
    });
    this.console = [];
  }

  async parseToken(token, tokeniser, opts) {

    const { dalang, aliases, state } = this;
    const { skip } = state;
    const { cwd } = opts || {};
    let arg, alias, nextToken, fn, call, exec, initial, statement, u, charCode;

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
    const consume = (delim, offset, sep) => {
      const arr = [];
      const nextToken = tokeniser.peek();
      if (nextToken.type === SYMBOL) {
        if (nextToken.token === delim[0]) {
          let nested = 0;
          next();   // consume peeked delim
          next();   // get first argument or close delim
          while ((nested > 0 && token.type !== EOF) || token.token !== delim[1]) {
            if (token.type === SYMBOL) {
              if (token.token === delim[0]) {
                nested ++;
              } else if (token.token === delim[1]) {
                nested --;
              }
            } 
            // add this token, unless its a level 0 separator
            if (nested > 0 || !sep || sep.indexOf(token.token) === -1) {
              token.lineno -= (offset - 1);
              arr.push(token);
            }
            next();
          }
        }
      }
      return arr;
    }

    // parse a,b with range and wildcard support a1:a2,b *,b etc
    const parseAB = (complex = true) => {       
      const ab = {};

      function getValue() {
        const arg = next();
        if (complex && arg.type === SYMBOL && arg.token === '*') {
          return arg.token;
        } 
        if (arg.type === NUMBER) {
          if (complex && arg.nextch === ':') {
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

    const parseXY = (s) => {
      const a = s.split(',');
      return { x: a[0]|0, y: a[1]|0 };
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
        let option, pref, value, chrome, size;
        switch(next(STRING).token) {
        case "option":
          option = next(STRING).token;
          this.log(initial, `browser option ${pref} ${value}`);
          this.options.push(option);
          break;
        case "prefs":
          pref = next(STRING).token;
          value = next(STRING).token;
          this.log(initial, `TODO: browser prefs ${pref} ${value}`);
          this.prefs.push({ pref, value });
          break;
        case "start":
          browser = this.browser = {};
          dalang.config({ sloMo: 0 });
          this.log(initial,`${statement} start`); 			// is a no-op we start later when we do browser size or get
          break;
        case "connect":
          const websocket = next(STRING).token;
          browser = this.browser = { websocket };
          dalang.config({ sloMo: 0 });
          browser.page = await this.start(Object.assign({}, this.options, { websocket }));
          break;
        case "chrome":
          chrome = browser.chrome = {};
          chrome.x = next(NUMBER).token;
          next(SYMBOL, ',');
          chrome.y = next(NUMBER).token;
          this.log(initial, `${statement} chrome ${JSON.stringify(chrome)}`);
          dalang.config({ chrome });
          break;
        case "size":
          if (!browser) browser = this.browser = {};
          size = browser.size = {};
          size.width = next(NUMBER).token;
          next(SYMBOL, ',');
          size.height = next(NUMBER).token;
          this.log(initial,`${statement} size ${JSON.stringify(size)}`);
          await dalang.viewport(size);
          break;
        case "get":
          if (!browser) browser = this.browser = {};
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
        case "back":
          this.log(initial, `${statement} back`);
          await dalang.refresh();
          break;
        case "forward":
          this.log(initial, `${statement} forward`);
          await dalang.refresh();
          break;
        case "refresh":
          this.log(initial, `${statement} refresh`);
          await dalang.refresh();
          break;
        // New to dalang, not supported by ScriptDriver 
        case "send":
          arg = next(STRING).token;
          await dalang.browser(arg, JSON.parse(next(STRING).token));
          break;
        case "headless":
          value = next(NUMBER).token;
          this.log(initial, `browser headless ${value}`);
          dalang.config({ headless: !!value });
          break;
        default:
          Unexpected(token);
          break;
        }
        break;
      case "include":
        fn = next(STRING).token;
        this.log(initial,`${statement} "${fn}"`);
        if (!skip) await this.run(fn, cwd, initial.lineno);
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
      case "alias": case "function":    // function is an alias for alias, but implies arguments
        initial = token;
        alias = { name: next(STRING).token };
        alias.lineno = initial.lineno;
        alias.args = consume('()', token.lineno, ',');      // consume arguments
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
            const start = Date.now();
            await dalang.at(x,y);
            console.log(`dalang.at took ${(Date.now()-start)/1000}s`);
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
            const start = Date.now();
            await dalang.check(arg);
            console.log(`dalang.check took ${(Date.now()-start)/1000}s`);
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
            await dalang.checksum(arg);
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
      case "clear":
        this.log(initial,`${statement}`);
        if (!skip) {
          await dalang.clear();
        }
        break;
      case "send":
        arg = next(STRING).token;
        this.log(initial,`${statement} "${arg}"`);
        if (!skip) {
          await dalang.send(arg);
        }
        break;
      case "press":
        arg = next(STRING).token;
        this.log(initial,`${statement} "${arg}"`);
        if (!skip) {
          await dalang.press(arg);
        }
        break;
      case "sendkey":
        arg = next(STRING).token;
        switch(arg) {
        case "Enter": charCode = 13; break;
        case "Tab": charCode = 9; break;
        case "Space": charCode = 32; break;
        default:
          charCode = arg|0;
          break;
        }
        this.log(initial,`${statement} ${arg}`);
        if (!skip) {
          await dalang.sendkey(charCode);
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
      case "exec": case "exec-include":
        initial = token;
        exec = { name: next(STRING).token };
        exec.args = consume('()', token.lineno, ',');           // consume arguments (...)
        if (!exec.args.length) {
          exec.args = consume('{}', token.lineno);         // consume arguments {...} (old style)
        }
        exec.args = exec.args.map(arg => arg.token);
        this.log(initial,`${statement} ${exec.name} ${exec.args.join(' ')}`);
        if (!skip) {
          let output;
          try {
            output = await this.exec(initial, exec, cwd);
            if (output && statement === 'exec-include') {
                await this.runString(output.stdout, exec.name, cwd, initial.lineno);
            }
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
      case "mouse":
        if (next(SYMBOL).token !== '{') Unexpected(token);
        this.log(token,`${statement} {`);
        next();
        await dalang.mouseInit();
        await dalang.mouseCenter();
        while (!(token.type === SYMBOL && token.token === '}')) {
          switch(token.token) {
          case "body":
            this.log(token,`${token.token}`);
            await dalang.mouseBody();
            break;
          case "origin": 
            this.log(token,`${token.token}`);
            await dalang.mouseMoveTo({ x: 0, y: 0 });
            break;
          case "0,0":
            this.log(token,`"${token.token}"`);
            await dalang.mouseMoveTo({ x: 0, y: 0 });
            break;
          case "center": case "centre":
            this.log(token,`${token.token}`);
            await dalang.mouseCenter();
            break;
          case "click":
            this.log(token,`${token.token}`);
            await dalang.mouseClick();
            break;
          case "down":
            this.log(token,`${token.token}`);
            await dalang.mouseDown();
            break;
          case "up":
            this.log(token,`${token.token}`);
            await dalang.mouseUp();
            break;
          case "sleep":
            arg = next(NUMBER).token;
            this.log(initial,`sleep ${arg}`);
            await dalang.sleep(arg); 
            break;
          default:
            if (token.type !== STRING) Unexpected(token);
            this.log(token,`"${token.token}"`);
            await dalang.mouseMoveBy(parseXY(token.token));
            break;
          }
          next();
        }
        dalang.mouseDispose();
        break;
      case "while":
        initial = token;
        arg = { tokens: consume('{}', token.lineno) };
        this.log(initial, initial.token + ` { ${arg.tokens.map(token => token.token).join(' ')} }`);
        let done;
        while (!done) {
          try {
            await this.runTokens(arg.tokens);
          } catch(e) {
            done = true;
          }
        }
        break;
      case "scroll-into-view":
        this.log(token, token.token);
        await dalang.scrollIntoView();
        break;
      case "wait-for":
        arg = next(STRING).token;
        this.log(initial,`${statement} "${arg}"`);
        switch(arg) {
        case "navigation":
          await dalang.waitForNavigation();
          break;
        }
        break;
      default:
        initial = token;
        alias = aliases[statement];
        if (alias === undefined) {
          Unexpected(initial);
        } else {
          const values = [];  // argument values
          arg = {};           // map of tokens that equate to named arguments
          alias.args.forEach(token => values.push((arg[token.token] = next()).token));          // pick up any arguments
          this.log(initial,`${statement} ${values.join(' ')}`);
          if (!skip) await this.runAlias(alias, arg, initial.lineno);
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
