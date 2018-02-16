// mini version of jest
const state = {};

async function test(n,f) {
  state.name = n;
  try {
    console.log(`Running test ${n}`);
    f();
  } catch(e) {
    console.dir(e);
  }
}

function expect(v) {
  return {
    toBe: function(t) {
      if (v !== t) {
        throw new Error(`${state.name} test failed. Expected [${t}] got [${v}]`);
      }
    },
    toEqual: function(t) {
      if (v != t) {
        throw new Error(`${state.name} test failed. Expected [${t}] got [${v}]`);
      }
    }
  }
}

module.exports = { test, expect };

/* vim: set ai ts=2 sw=2 expandtab smarttab softtabstop=2 : */
