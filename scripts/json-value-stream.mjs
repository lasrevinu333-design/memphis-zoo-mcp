export function parseJsonValueStream(input, label = "JSON value stream") {
  const text = String(input);
  const values = [];
  let offset = 0;

  const skipWhitespace = () => {
    while (offset < text.length && /\s/u.test(text[offset])) offset += 1;
  };

  while (true) {
    skipWhitespace();
    if (offset >= text.length) break;

    const start = offset;
    const opener = text[offset];
    if (opener === "{" || opener === "[") {
      const stack = [];
      let inString = false;
      let escaped = false;
      for (; offset < text.length; offset += 1) {
        const character = text[offset];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === "\"") inString = false;
          continue;
        }
        if (character === "\"") {
          inString = true;
          continue;
        }
        if (character === "{" || character === "[") stack.push(character);
        else if (character === "}" || character === "]") {
          const expected = character === "}" ? "{" : "[";
          if (stack.pop() !== expected) throw new Error(`${label} contains mismatched JSON delimiters at byte ${offset}.`);
          if (stack.length === 0) {
            offset += 1;
            break;
          }
        }
      }
      if (stack.length !== 0 || inString) throw new Error(`${label} contains an incomplete JSON value at byte ${start}.`);
    } else if (opener === "\"") {
      let escaped = false;
      offset += 1;
      for (; offset < text.length; offset += 1) {
        const character = text[offset];
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === "\"") {
          offset += 1;
          break;
        }
      }
      if (text[offset - 1] !== "\"" || escaped) throw new Error(`${label} contains an incomplete JSON string at byte ${start}.`);
    } else {
      while (offset < text.length && !/\s/u.test(text[offset])) offset += 1;
    }

    try {
      values.push(JSON.parse(text.slice(start, offset)));
    } catch (error) {
      throw new Error(`${label} contains invalid JSON at byte ${start}: ${error.message}`);
    }
  }

  return values;
}
