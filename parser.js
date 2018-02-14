const { StringTokeniser } = require('./tokeniser');
const fs = require('fs');

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
  }

  async open(fn) {
	return new Promise((ok,r) => {
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
	const tokeniser = await this.open(script);
	let token = tokeniser.next();
	while (token.type !== EOF) {
		// console.log(token);
		try {
			await this.parseToken(token, tokeniser);
		} catch(e) {
			console.log(e);
			break;
		}
		token = tokeniser.next();
	}
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

	// get the next token, throw unexpected EOF error if hit EOF
	function next(type, expect) {
		token = tokeniser.next();
		// console.log(token);
		if (token.type === EOF) {
			throw new Error('Unexpected end of file');
		}
		if (type !== undefined && token.type !== type) {
			throw new Error(`TypeError: ${token.token} should be type ${type} but is type ${token.type}`);
		}
		if (expect !== undefined && token.token !== expect) {
			throw new Error(`UnexpectedToken: got ${token.token} expected ${expect}`);
		}
		return token;
	}

	function Unexpected(token) {
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
				console.log('browser start'); 			// is a no-op we start later when we do browser size or get
				break;
			case "chrome":
				const chrome = browser.chrome = {};
				chrome.x = next(NUMBER).token;
				next(SYMBOL, ',');
				chrome.y = next(NUMBER).token;
				console.log('browser chrome ' + JSON.stringify(chrome));
				dalang.config({ chrome });
				break;
			case "size":
				const size = browser.size = {};
				size.width = next(NUMBER).token;
				next(SYMBOL, ',');
				size.height = next(NUMBER).token;
				console.log('browser size ' + JSON.stringify(size));
				break;
			case "get":
				if (!browser.page) {
					browser.page = await this.start(Object.assign({}, browser.size, { args: this.options }));
				}
				await dalang.get(next(STRING).token);
				break;
			case "close":
				if (browser.page) {
					await dalang.close();
				}
				break;
			default:
				Unexpected(token);
			}
			break;
		case "include":
			console.log('TODO include ' + next(STRING).token);
			break;
		case "alias":
			const alias = { name: next(STRING).token, args: [], tokens: [] };
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
				alias.tokens.push(token);
			}
			aliases[alias.name] = alias;
			break;
		case "test-id": await dalang.testid(next(STRING).token); break;
		case "select": await dalang.select(next(STRING).token); break;
		case "xpath": await dalang.xpath(next(STRING).token); break;
		case "info": await dalang.info(); break;
		case "click": await dalang.click(); break;
		case "screenshot": await dalang.screenshot(next(STRING).token); break;
		case "sleep": await dalang.sleep(next(NUMBER).token); break;
		case "tag": await dalang.tag(next(STRING).token); break;
		case "at": 
			const x = next(NUMBER).token; 
			next(SYMBOL,',');
			const y = next(NUMBER).token; 
			await dalang.at(x,y);
			break;
		case "size": 
			const width = next(NUMBER).token; 
			next(SYMBOL,',');
			const height = next(NUMBER).token; 
			await dalang.size(width,height);
			break;
		default:
			if (aliases[token.token] === undefined) {
				Unexpected(token);
			} else {
				console.log(`TODO: run alias ${token.token}`);
			}
		}
		break;
	}
  }

}

module.exports = DalangParser;
