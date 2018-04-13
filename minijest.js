// mini version of jest
const state = {};

async function test(n,f) {
  state.name = n;
  try {
    console.log(`Running test ${n}`);
    await f();
  } catch(e) {
    console.dir(e);
  }
}

function expect(v) {
  const dont = this._dont;
  let t;
  return {
    toBe: function(t) {
      t = v === t;
      if (dont) {
        if (t) throw new Error(`${state.name} test failed. Didn't expect [${v}] to be [${t}]`);
      } else {
        if (!t) throw new Error(`${state.name} test failed. Expected [${v}] to be [${t}]`);
      }
    },
    toEqual: function(t) {
      t = v == t;
      if (dont) {
        if (t) throw new Error(`${state.name} test failed. Didn't expected [${v}] to equal [${t}]`);
      } else {
        if (!t) throw new Error(`${state.name} test failed. Expected [${v}] to equal [${t}]`);
      }
    },
    toBeInRange: function(l,h) {
      t = v >= l && v <= h;
      if (dont) {
        if (t) throw new Error(`${state.name} test failed. Didn't expect [${v}] to be in range [${l}:${h}]`);
      } else {
        if (!t) throw new Error(`${state.name} test failed. Expected [${v}] to be in range [${l}:${h}]`);
      }
    }
  }
}

function dont() {
  return { _dont: true, expect: expect, dont: function() { return module.exports; } };
}

module.exports = { test, expect, dont };

/* vim: set ai ts=2 sw=2 expandtab smarttab softtabstop=2 : */
