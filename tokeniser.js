// Simple String Tokeniser

const EOF = -1;
const NUMBER = 0;
const STRING = 1;
const SYMBOL = 2;
const SPACE = 3;

class Lexicaliser {
  constructor(options) {
    this.options = options;
  }
  type(ch,pos) {
    const { wordChars, whiteSpace } = this.options;
    if (!ch) return EOF;
    if (ch.match(/[0-9.]/)) return NUMBER;
    if (pos === 0 && ch === '-') return NUMBER;
    if (ch.match(wordChars)) return STRING;
    if (ch.match(whiteSpace)) return SPACE;
    return SYMBOL;
  }
  word(ch) {
    return ch.match(this.options.wordChars);
  }
}

class Tokeniser {
  constructor({
    quoteChar = '"',
    slashStarComments = true,
    slashSlashComments = true,
    whiteSpace = /[ 	\n]/,
    wordChars = /[A-Za-z0-9$#_\-]/
  } = {}) {
    this.options = { qc: quoteChar, sstc: slashStarComments, sslc: slashSlashComments };
    this.lexicaliser = new Lexicaliser({ whiteSpace, wordChars });
    this.lineno = 1;
  }
  getch() {
    if (this.lastch === "\n") this.lineno ++;
    this.lastch = this.get();
    return this.lastch;
  }
  next() {
    const { wordChars, qc, sstc, sslc } = this.options;
    const l = this.lexicaliser;
    let ch = this.nextch === undefined ? this.getch() : this.nextch;
    let token = this.token = '';
    let nextch = this.nextch = undefined;
    let type = this.type = EOF;
    while (l.type(ch) === SPACE) {			// consume white space
      ch = this.getch();
    }
    while (ch !== undefined) {
      const chtype = l.type(ch, token.length);
      if ((type === EOF||type === NUMBER) && chtype === NUMBER) {
        token += ""+ch;
        type = NUMBER;
      } else if (chtype === STRING || l.word(ch)) {
        token += ch;
        type = STRING;
      } else if (chtype === SPACE) {
        nextch = ch;
        break;
      } else {
        if (token.length && ch !== qc) {
          // a symbol terminate an existing token (unless its a quote)
          nextch = ch;
          break;
        }
        nextch = this.getch();
        if (ch === qc) {			// start of quoted string
          type = STRING;
          if (nextch === qc) {
            nextch = this.getch();
          } else {
            token += nextch;
            while (ch = this.getch()) {
              if (ch === qc) {
                nextch = this.getch();
                break;
              }
              token += ch;
            }
          }
          if (nextch && l.word(nextch)) {
            ch = nextch;
            nextch = undefined;
            continue;
          }
        } else if (ch === '/') {
          if (sslc && nextch === '/') {
            // consume // comments
            while (ch = this.getch()) {
              if (ch === "\n") {
                this.nextch = ch;
                break;
              }
            }
            if (ch) return this.next();
            token = '';
            type = EOF;
          } else if (sstc && nextch === '*') {
            // consume /* ... */ comments
            while (ch = this.getch()) {
              if (ch === "*") {
                ch = this.getch();
                if (ch === '/') {
                  break;
                }
              }
              if (ch === "\n") this.lineno++;
            }
            if (ch) return this.next();
            token = '';
            type = EOF;
          }
        } else {
          token = ch;
          type = SYMBOL;
        }
        break;
      }
      ch = this.getch();
    }
    this.token = token;
    this.type = type;
    this.nextch = nextch;
    if (type === NUMBER) {
      token = parseFloat(token);
    }
    return { token, type, nextch, lineno: this.lineno };
  }
}

class StringTokeniser extends Tokeniser {
  constructor(options, string) {
    super(options);
	if (string) set(string);
  }
  set(string) {
	this.string = string;
	this.pos = 0;
  }
  get() {
    return this.string[this.pos++];
  }
}

StringTokeniser.EOF = Tokeniser.EOF = EOF;
StringTokeniser.NUMBER = Tokeniser.NUMBER = NUMBER;
StringTokeniser.STRING = Tokeniser.STRING = STRING;
StringTokeniser.SYMBOL = Tokeniser.SYMBOL = SYMBOL;

if (typeof module !== "undefined") module.exports = { Tokeniser, StringTokeniser };
