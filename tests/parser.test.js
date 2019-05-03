const dalang = require('../dalang');
// test('Parser', async () => {
//	await dalang.run('parser.test');
// });
test('Parser', async () => { 
	await dalang.run('tests/parser.test', {
		headless: false, 
		executablePath: process.env.CHROME_PATH
	}); 
}, 30000);
