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
    quoteChars = '"\'',
    slashStarComments = true,
    slashSlashComments = true,
    whiteSpace = /[\t \n]/,
    wordChars = /[A-Za-z0-9$#_\-.]/
  } = {}) {
    this.options = { qc: quoteChars, sstc: slashStarComments, sslc: slashSlashComments };
    this.lexicaliser = new Lexicaliser({ whiteSpace, wordChars });
    this.lineno = 1;
  }
  getch() {
    if (this.lastch === "\n") this.lineno ++;
    this.lastch = this.get();
    return this.lastch;
  }
  next() {
    if (this.nextToken) { 
      const nextToken = this.nextToken;
      this.nextToken = null;
      return nextToken;
    }
    const { wordChars, qc, sstc, sslc } = this.options;
    const l = this.lexicaliser;
    let ch = this.nextch === undefined ? this.getch() : this.nextch;
    let token = this.token = '';
    let nextch = this.nextch = undefined;
    let type = this.type = EOF;
    let lws = '';
    let q;
    while (l.type(ch) === SPACE) {			// consume white space
      lws += ch;
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
        if (token.length && qc.indexOf(ch) === -1) {
          // a symbol terminate an existing token (unless its a quote)
          nextch = ch;
          break;
        }
        nextch = this.getch();
        if (qc.indexOf(ch)>=0) {			// start of quoted string
          q = ch;
          type = STRING;
          if (nextch === q) {
            nextch = this.getch();
          } else {
            token += nextch;
            let esc = 0;
            while (ch = this.getch()) {
              if (esc === 0 && ch === q) {
                nextch = this.getch();
                break;
              }
              if (esc) esc = 0;
              else if (ch === '\\') esc = 1;
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
    this.quote = q || '';
    if (type === NUMBER) {
      token = parseFloat(token);
    }
    return { token, type, nextch, lineno: this.lineno, quote: this.quote, lws };
  }
  peek() {
    if (this.nextToken) return this.nextToken;
    const token = this.next();
    this.nextToken = token;
    return token;
  }
}

class StringTokeniser extends Tokeniser {
  constructor(options, string) {
    super(options);
    if (string) this.set(string);
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

/* vim: set ai ts=2 sw=2 expandtab smarttab softtabstop=2 : */
