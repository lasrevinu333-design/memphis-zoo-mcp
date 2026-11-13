// Tool discovery needs an object-valued array items schema. Zod fixed tuples
// serialize with prefixItems/items:false, which the connected app rejects.
// This is a wire descriptor only: the original Zod schema remains the command
// validator and the source of the unchanged command-contract digest.
export function advertisedInputSchema(value) {
  if (Array.isArray(value)) return value.map(advertisedInputSchema);
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, advertisedInputSchema(item)]));
  if (result.type === 'array' && (Array.isArray(result.prefixItems) || Array.isArray(result.items))) {
    const modern = Array.isArray(result.prefixItems);
    const tuple = modern ? result.prefixItems : result.items;
    if ((modern ? result.items !== false : result.additionalItems !== false) || tuple.some(item => item?.type !== 'string' || typeof item.const !== 'string')) {
      throw new Error('Unsupported MCP tuple descriptor; preserve its command validator.');
    }
    const values = tuple.map(item => item.const);
    result.items = values.length ? { type: 'string', enum: [...new Set(values)] } : { type: 'string' };
    result.minItems = values.length;
    result.maxItems = values.length;
    if (values.length > 1) result.description = [result.description, `Exact required order: ${JSON.stringify(values)}. The server rejects any other order.`].filter(Boolean).join(' ');
    delete result.prefixItems;
    delete result.additionalItems;
  }
  return result;
}
