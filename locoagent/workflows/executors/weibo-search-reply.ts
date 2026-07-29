/**
 * Weibo Keyword Search & Reply Workflow Executor
 * 
 * Searches specific keywords and engages through likes, comments, and reposts.
 * 
 * Run: bun run workflow run --id weibo-search-reply
 */

import { $ } from "bun";

const CONFIG = {
  maxTotalActions: 30,
  cooldownSeconds: 30,
  searchQueries: [
    { keyword: "AI agent", pages: 2, action: "like_and_comment" },
    { keyword: "开源工具", pages: 1, action: "like" },
  ],
};

async function searchWeibo(keyword: string, page: number = 1) {
  const result = await $`aione weibo post search --query ${keyword} --page ${page} --output json`.quiet();
  try {
    return JSON.parse(result.stdout.toString());
  } catch {
    return [];
  }
}

async function main() {
  console.log("[Weibo Search Reply] Starting...");
  let totalActions = 0;
  
  for (const query of CONFIG.searchQueries) {
    if (totalActions >= CONFIG.maxTotalActions) {
      console.log("  Max actions reached. Stopping.");
      break;
    }
    
    for (let page = 1; page <= query.pages; page++) {
      console.log(`  Search: "${query.keyword}" page ${page}`);
      const posts = await searchWeibo(query.keyword, page);
      
      if (!Array.isArray(posts) || posts.length === 0) break;
      
      console.log(`    Found ${posts.length} posts (action: ${query.action})`);
      totalActions += posts.length;
      
      // Rate limiting
      if (page < query.pages) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.cooldownSeconds * 1000));
      }
    }
  }
  
  console.log(`[Weibo Search Reply] Complete. ${totalActions} posts discovered.`);
}

main();
