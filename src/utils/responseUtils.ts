/**
 * Utility functions for formatting MCP responses
 */

/**
 * Create a standardized JSON text response for MCP
 */
export function createJsonResponse(data: any): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}
