#!/usr/bin/env node
/**
 * Discover page URLs from a sitemap, without scanning them.
 *
 * Splitting discovery from scanning lets you review and trim the list before
 * committing to a long run — a large CMS sitemap can hold hundreds of pages,
 * and scanning every one of a repeated template wastes hours for no new
 * findings.
 *
 * Usage:
 *   npm run scan:urls -- --sitemap https://example.com/sitemap.xml
 *   npm run scan:urls -- --sitemap https://example.com/sitemap.xml --out urls.txt
 *   npm run scan:urls -- --sitemap https://example.com/sitemap.xml --include /pages/ --limit 25
 *
 * Feed the result to a scan with:
 *   npm run scan:all -- --urls ./urls.txt
 */
import { writeFileSync } from "node:fs";
import { readSitemap } from "../src/sitemap.js";

interface Args {
  sitemap?: string;
  out?: string;
  include: string[];
  exclude: string[];
  limit?: number;
  maxDepth?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { include: [], exclude: [] };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--sitemap": args.sitemap = argv[++i]; break;
      case "--out": args.out = argv[++i]; break;
      case "--include": args.include.push(argv[++i]!); break;
      case "--exclude": args.exclude.push(argv[++i]!); break;
      case "--limit": args.limit = Number(argv[++i]); break;
      case "--max-depth": args.maxDepth = Number(argv[++i]); break;
      default: break;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.sitemap) {
    process.stderr.write(
      "Usage: npm run scan:urls -- --sitemap <url> [--include <substr>] [--exclude <substr>] [--limit <n>] [--out <file>]\n"
    );
    process.exitCode = 1;
    return;
  }

  const discovered = await readSitemap(args.sitemap, { maxDepth: args.maxDepth });

  let urls = discovered;
  if (args.include.length > 0) {
    urls = urls.filter(u => args.include.some(s => u.includes(s)));
  }
  if (args.exclude.length > 0) {
    urls = urls.filter(u => !args.exclude.some(s => u.includes(s)));
  }
  if (typeof args.limit === "number" && !Number.isNaN(args.limit)) {
    urls = urls.slice(0, args.limit);
  }

  process.stderr.write(
    `Discovered ${discovered.length} URL(s) from ${args.sitemap}; selected ${urls.length}.\n`
  );

  if (args.out) {
    const header = [
      `# ${urls.length} URL(s) discovered from ${args.sitemap}`,
      `# Generated ${new Date().toISOString()}`,
      "#",
      "# Review and trim before scanning: prefer one page per distinct template",
      "# over every page sharing a template.",
      "",
    ].join("\n");
    writeFileSync(args.out, `${header}${urls.join("\n")}\n`);
    process.stderr.write(`Wrote ${args.out}\n`);
  } else {
    process.stdout.write(`${urls.join("\n")}\n`);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
