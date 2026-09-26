import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchRecentXPosts, fetchXPostMetrics } from './x.js';

const originalConnect = McpServer.prototype.connect;

McpServer.prototype.connect = async function patchedConnect(...args) {
  if (!this.__novelightXToolsRegistered) {
    this.__novelightXToolsRegistered = true;

    this.tool(
      'x_recent_posts',
      'Read recent public X posts for one handle. Read-only; does not require an X API key.',
      {
        handle: z.string().min(1),
        count: z.number().int().min(1).max(20).default(10)
      },
      async ({ handle, count }) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify(await fetchRecentXPosts(handle, { count }), null, 2)
          }
        ]
      })
    );

    this.tool(
      'x_post_metrics',
      'Read one public X post and its public metrics (views, likes, reposts, replies, quotes, bookmarks where available). Read-only.',
      {
        urlOrId: z.string().min(1)
      },
      async ({ urlOrId }) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify(await fetchXPostMetrics(urlOrId), null, 2)
          }
        ]
      })
    );
  }

  return originalConnect.apply(this, args);
};
