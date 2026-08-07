/**
 * Loom MCP Server Marketplace (Lightweight)
 *
 * A registry of popular MCP servers with one-click install.
 * No external package — just metadata and install instructions.
 */

export interface McpServerEntry {
  id: string;
  name: string;
  description: string;
  category: 'search' | 'database' | 'api' | 'devtools' | 'productivity' | 'ai';
  /** The npx/node command to start this server */
  installCommand: string;
  installArgs: string[];
  /** Environment variables needed */
  requiredEnv?: string[];
  /** Homepage / docs URL */
  homepage?: string;
  /** Popularity score (for sorting) */
  popularity: number;
  /** Whether this server is verified */
  verified: boolean;
}

export const MCP_MARKETPLACE_SERVERS: McpServerEntry[] = [
  {
    id: 'mcp-github',
    name: 'GitHub',
    description: 'Access GitHub repos, PRs, issues, and code search',
    category: 'api',
    installCommand: 'npx',
    installArgs: ['-y', '@modelcontextprotocol/server-github'],
    requiredEnv: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    homepage: 'https://github.com/modelcontextprotocol/servers',
    popularity: 95,
    verified: true,
  },
  {
    id: 'mcp-filesystem',
    name: 'Filesystem',
    description: 'Read/write files outside the workspace',
    category: 'devtools',
    installCommand: 'npx',
    installArgs: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allow'],
    popularity: 90,
    verified: true,
  },
  {
    id: 'mcp-postgres',
    name: 'PostgreSQL',
    description: 'Query PostgreSQL databases with read-only access',
    category: 'database',
    installCommand: 'npx',
    installArgs: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'],
    popularity: 85,
    verified: true,
  },
  {
    id: 'mcp-sqlite',
    name: 'SQLite',
    description: 'Query SQLite databases',
    category: 'database',
    installCommand: 'npx',
    installArgs: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', './data.db'],
    popularity: 80,
    verified: true,
  },
  {
    id: 'mcp-brave-search',
    name: 'Brave Search',
    description: 'Search the web using Brave Search API',
    category: 'search',
    installCommand: 'npx',
    installArgs: ['-y', '@modelcontextprotocol/server-brave-search'],
    requiredEnv: ['BRAVE_API_KEY'],
    homepage: 'https://brave.com/search/api/',
    popularity: 88,
    verified: true,
  },
  {
    id: 'mcp-puppeteer',
    name: 'Puppeteer',
    description: 'Browser automation — navigate, click, screenshot',
    category: 'devtools',
    installCommand: 'npx',
    installArgs: ['-y', '@modelcontextprotocol/server-puppeteer'],
    popularity: 75,
    verified: true,
  },
  {
    id: 'mcp-memory',
    name: 'Memory',
    description: 'Persistent knowledge graph for long-term memory',
    category: 'ai',
    installCommand: 'npx',
    installArgs: ['-y', '@modelcontextprotocol/server-memory'],
    popularity: 70,
    verified: true,
  },
  {
    id: 'mcp-fetch',
    name: 'Fetch',
    description: 'Fetch and convert web pages to markdown',
    category: 'api',
    installCommand: 'npx',
    installArgs: ['-y', '@modelcontextprotocol/server-fetch'],
    popularity: 82,
    verified: true,
  },
  {
    id: 'mcp-google-maps',
    name: 'Google Maps',
    description: 'Location search, directions, and place details',
    category: 'api',
    installCommand: 'npx',
    installArgs: ['-y', '@modelcontextprotocol/server-google-maps'],
    requiredEnv: ['GOOGLE_MAPS_API_KEY'],
    popularity: 60,
    verified: true,
  },
  {
    id: 'mcp-slack',
    name: 'Slack',
    description: 'Read and send messages in Slack',
    category: 'productivity',
    installCommand: 'npx',
    installArgs: ['-y', '@modelcontextprotocol/server-slack'],
    requiredEnv: ['SLACK_BOT_TOKEN'],
    popularity: 65,
    verified: true,
  },
];

export class McpMarketplace {
  /**
   * Search marketplace by name, description, or category.
   */
  search(query: string): McpServerEntry[] {
    const q = query.toLowerCase();
    return MCP_MARKETPLACE_SERVERS.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q),
    ).sort((a, b) => b.popularity - a.popularity);
  }

  listByCategory(category: McpServerEntry['category']): McpServerEntry[] {
    return MCP_MARKETPLACE_SERVERS
      .filter(s => s.category === category)
      .sort((a, b) => b.popularity - a.popularity);
  }

  getAll(): McpServerEntry[] {
    return [...MCP_MARKETPLACE_SERVERS].sort((a, b) => b.popularity - a.popularity);
  }

  getById(id: string): McpServerEntry | undefined {
    return MCP_MARKETPLACE_SERVERS.find(s => s.id === id);
  }

  getCategories(): McpServerEntry['category'][] {
    return ['search', 'database', 'api', 'devtools', 'productivity', 'ai'];
  }

  /**
   * Generate the config object for installing a server.
   */
  generateConfig(entry: McpServerEntry, envValues?: Record<string, string>) {
    return {
      id: entry.id,
      name: entry.name,
      transport: 'stdio' as const,
      command: entry.installCommand,
      args: entry.installArgs,
      env: envValues || {},
      enabled: true,
      autoConnect: true,
    };
  }
}
