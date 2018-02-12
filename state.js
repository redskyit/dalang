class State {
	constructor(initialState) {
		this.__state = initialState || {};
	}
	set state(o) {
		this.__state = Object.assign({}, this.__state, o);
	}
	get state() {
		return this.__state;
	}
	setState(o) {
		this.state = o;
	}
	resetState(o) {
		this.__state = o;
	}
}

module.exports = State;
