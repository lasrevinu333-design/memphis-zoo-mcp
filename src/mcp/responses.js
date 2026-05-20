export function textResponse(text) {
  return {
    content: [
      {
        type: "text",
        text: String(text),
      },
    ],
  };
}

export function jsonResponse(value) {
  return textResponse(JSON.stringify(value, null, 2));
}

export function errorResponse(error) {
  return jsonResponse({
    ok: false,
    error: error?.message || String(error),
  });
}
