const dalang = require('../dalang');
// test('Parser', async () => {
//	await dalang.run('parser.test');
// });
(async function() { 
	await dalang.run('parser.test', { headless: false }); 
})();
