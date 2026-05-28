import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Convert a Zod schema to a JSON Schema object suitable for MCP tool definitions.
 */
export function toJSONSchema(schema: z.ZodType<any>): Record<string, any> {
  const jsonSchema = zodToJsonSchema(schema, {
    $refStrategy: 'none',
    target: 'openApi3',
  });
  
  // Handle the output format of zodToJsonSchema
  if (jsonSchema.$schema) {
    delete jsonSchema.$schema;
  }
  
  // The schema might be wrapped in a defs object
  const j = jsonSchema as Record<string, any>;
  if (j.definitions && !j.properties) {
    // Find the root schema
    const mainSchema = { ...jsonSchema };
    delete mainSchema.definitions;
    return mainSchema;
  }
  
  return jsonSchema as Record<string, any>;
}
