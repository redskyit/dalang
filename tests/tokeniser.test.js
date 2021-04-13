const { StringTokeniser } = require('../tokeniser');

// note, must leave tabs and trailing spaces
const script = `
L2 hello world
L3 /* 1000 1.2 */ 
L4 -1000 -01.20 
L5	100,100 
L6	abc"123" /* humm */
L7	abc""123 /* abc123 */
L8	123abc /* is a string */
	abc123 /* is a string */
	abc-123 /* is a string */
	// ignore this line
	"hello,there"
	/* hello */
	'hello,there'
	hello.there
	''
	"'"
	'"'
	/* hello */
`;

test('Tokeniser', () => {

  const tokeniser = new StringTokeniser({ wordChars: /[A-Za-z0-9$#_\-.]/ });
  tokeniser.set(script);

	expect(tokeniser.next()).toEqual({ token: 'L2', type: 1, nextch: ' ', lineno: 2, quote: '', lws: '\n' });
	expect(tokeniser.next()).toEqual({ token: 'hello', type: 1, nextch: ' ', lineno: 2, quote: '', lws: ' ' });
	expect(tokeniser.next()).toEqual({ token: 'world', type: 1, nextch: '\n', lineno: 2, quote: '', lws: ' ' });
	expect(tokeniser.next()).toEqual({ token: 'L3', type: 1, nextch: ' ', lineno: 3, quote: '', lws: '\n' });
	expect(tokeniser.next()).toEqual({ token: 'L4', type: 1, nextch: ' ', lineno: 4, quote: '', lws: ' \n' });
	expect(tokeniser.next()).toEqual({ token: -1000, type: 0, nextch: ' ', lineno: 4, quote: '', lws: ' ' });
	expect(tokeniser.next()).toEqual({ token: -1.2, type: 0, nextch: ' ', lineno: 4, quote: '', lws: ' ' });
	expect(tokeniser.next()).toEqual({ token: 'L5', type: 1, nextch: '\t', lineno: 5, quote: '', lws: ' \n' });
	expect(tokeniser.next()).toEqual({ token: 100, type: 0, nextch: ',', lineno: 5, quote: '', lws: '\t' });
	expect(tokeniser.next()).toEqual({ token: ',', type: 2, nextch: '1', lineno: 5, quote: '', lws: '' });
	expect(tokeniser.next()).toEqual({ token: 100, type: 0, nextch: ' ', lineno: 5, quote: '', lws: '' });
	expect(tokeniser.next()).toEqual({ token: 'L6', type: 1, nextch: '\t', lineno: 6, quote: '', lws: ' \n' });
	expect(tokeniser.next()).toEqual({ token: 'abc123', type: 1, nextch: ' ', lineno: 6, quote: '"', lws: '\t' });
	expect(tokeniser.next()).toEqual({ token: 'L7', type: 1, nextch: '\t', lineno: 7, quote: '', lws: '\n' });
	expect(tokeniser.next()).toEqual({ token: 'abc123', type: 1, nextch: ' ', lineno: 7, quote: '"', lws: '\t' });
	expect(tokeniser.next()).toEqual({ token: 'L8', type: 1, nextch: '\t', lineno: 8, quote: '', lws: '\n' });
	expect(tokeniser.next()).toEqual({ token: '123abc', type: 1, nextch: ' ', lineno: 8, quote: '', lws: '\t' });
	expect(tokeniser.next()).toEqual({ token: 'abc123', type: 1, nextch: ' ', lineno: 9, quote: '', lws: '\n\t' });
	expect(tokeniser.next()).toEqual({ token: 'abc-123', type: 1, nextch: ' ', lineno: 10, quote: '', lws: '\n\t' });
	expect(tokeniser.next()).toEqual({ token: 'hello,there', type: 1, nextch: '\n', lineno: 12, quote: '"', lws: '\n\t' });
	expect(tokeniser.next()).toEqual({ token: 'hello,there', type: 1, nextch: '\n', lineno: 14, quote: "'", lws: '\n\t' });
	expect(tokeniser.next()).toEqual({ token: 'hello.there', type: 1, nextch: '\n', lineno: 15, quote: '', lws: '\n\t' });
	expect(tokeniser.next()).toEqual({ token: '', type: 1, nextch: '\n', lineno: 16, quote: "'", lws: '\n\t' });
	expect(tokeniser.next()).toEqual({ token: "'", type: 1, nextch: '\n', lineno: 17, quote: '"', lws: '\n\t' });		// quoted = string
	expect(tokeniser.next()).toEqual({ token: '"', type: 1, nextch: '\n', lineno: 18, quote: "'", lws: '\n\t' });		// quoted = string
	expect(tokeniser.next()).toEqual({ token: '', type:  -1, nextch: undefined, lineno:  20, quote:  '', lws:  '\n' });

});
