function T(v) {
  if (typeof v === "string") {
    switch(v.toLowerCase()) {
    case "on": case "yes": case "true":
      return true;
	case "off": case "no": case "false":
		return false;
    }
    return;		// undefined if not recognised falsy
  }
  return !!v;
}

module.exports = T;
