test('Instanciation', async () => {
	const dalang = require('../dalang');
});

test('Custom dalang instansiation', async () => {
	const dalang = new (require('../dalang').Dalang)({ defaultTimeout: 60 });
});
