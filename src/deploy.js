/**
 * Deploy command — creates Cloudflare Worker + D1 for the user's portal
 * Same pattern as Hearthline CLI deploy
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { loadConfig, saveConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORTAL_DIR = resolve(__dirname, '..', 'portal');

export async function deploy(options) {
  const { verbose } = options;

  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║       AI EXODUS — Portal Deploy      ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');

  // Check wrangler is available
  const wranglerOk = await checkCommand('npx', ['wrangler', '--version']);
  if (!wranglerOk) {
    console.error('  Error: Wrangler not found. Install it: npm install -g wrangler');
    console.error('  Then log in: npx wrangler login');
    process.exit(1);
  }

  // Check if portal source exists
  if (!existsSync(join(PORTAL_DIR, 'worker.js'))) {
    console.error('  Error: Portal source not found at ' + PORTAL_DIR);
    console.error('  Make sure ai-exodus-portal/ is alongside ai-exodus/');
    process.exit(1);
  }

  const config = await loadConfig();
  const isRedeployMode = !!config.portalUrl;

  if (isRedeployMode) {
    console.log('  Existing deployment detected: ' + config.portalUrl);
    console.log('  Redeploying with latest code...');
    console.log('');
  }

  // Generate deployment name or reuse existing
  const deployName = config.deployName || 'exodus-' + randomBytes(3).toString('hex');
  const mcpSecret = config.mcpSecret || 'exodus-' + randomBytes(8).toString('hex');
  const dbName = config.dbName || deployName + '-db';

  // Step 1: Create D1 database (skip if exists)
  if (!config.dbId) {
    console.log('  [1/4] Creating database...');
    const dbOutput = await runCommand('npx', ['wrangler', 'd1', 'create', dbName], { verbose });
    // Try both TOML format (old) and JSON format (new wrangler)
    const dbIdMatch = dbOutput.match(/database_id\s*=\s*"([^"]+)"/) ||
                      dbOutput.match(/"database_id"\s*:\s*"([^"]+)"/);
    if (!dbIdMatch) {
      console.error('  Error: Could not parse database ID from wrangler output');
      console.error(dbOutput);
      process.exit(1);
    }
    config.dbId = dbIdMatch[1];
    config.dbName = dbName;
    console.log('    Database created: ' + dbName + ' (' + config.dbId + ')');
  } else {
    console.log('  [1/4] Database exists: ' + config.dbName);
  }

  // Step 2: Set up deploy directory
  console.log('  [2/4] Preparing deployment...');
  const deployDir = resolve(join(PORTAL_DIR, '.deploy-' + deployName));
  await mkdir(deployDir, { recursive: true });

  // Copy worker.js and schema.sql
  await copyFile(join(PORTAL_DIR, 'worker.js'), join(deployDir, 'worker.js'));
  await copyFile(join(PORTAL_DIR, 'schema.sql'), join(deployDir, 'schema.sql'));

  // Write wrangler.toml with actual values
  const wranglerToml = `name = "${deployName}"
main = "worker.js"
compatibility_date = "2024-12-01"

[[d1_databases]]
binding = "DB"
database_name = "${dbName}"
database_id = "${config.dbId}"

[vars]
MCP_SECRET = "${mcpSecret}"
`;
  await writeFile(join(deployDir, 'wrangler.toml'), wranglerToml, 'utf-8');

  // Step 3: Initialize database schema
  console.log('  [3/4] Initializing database schema...');
  try {
    const schemaContent = await readFile(join(PORTAL_DIR, 'schema.sql'), 'utf-8');
    // Split by semicolons and run each statement (wrangler --file can be finicky)
    const statements = schemaContent.split(';').map(s => s.trim()).filter(s => s.length > 5);
    for (const stmt of statements) {
      try {
        await runCommand('npx', ['wrangler', 'd1', 'execute', dbName, '--remote', '--command', stmt + ';'], { verbose, cwd: deployDir });
      } catch (err) {
        const msg = err.message || '';
        // Tolerate "already exists" and argument parsing issues with CREATE INDEX
        if (msg.includes('already exists') || msg.includes('Unknown arguments') || msg.includes('must provide')) {
          if (verbose) console.log('      (skipped: ' + msg.slice(0, 80) + ')');
        } else {
          console.error('    Schema error: ' + msg.slice(0, 200));
          console.error('    Deploy may fail — check your database manually.');
        }
      }
    }
    console.log('    Schema applied.');
  } catch (err) {
    console.error('    Schema initialization failed: ' + err.message);
    console.error('    Try applying manually: npx wrangler d1 execute ' + dbName + ' --remote --file schema.sql');
  }

  // Step 4: Deploy worker
  console.log('  [4/4] Deploying portal...');
  const deployOutput = await runCommand('npx', ['wrangler', 'deploy'], { verbose, cwd: deployDir });

  // Extract URL from deploy output
  const urlMatch = deployOutput.match(/(https:\/\/[^\s]+\.workers\.dev)/);
  const portalUrl = urlMatch ? urlMatch[1] : `https://${deployName}.workers.dev`;

  // Save config
  config.deployName = deployName;
  config.mcpSecret = mcpSecret;
  config.portalUrl = portalUrl;
  await saveConfig(config);

  // Clean up deploy dir
  // Leave it for now — useful for redeployments

  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║          Portal deployed!             ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log('  Portal URL:  ' + portalUrl);
  console.log('  MCP Secret:  ' + mcpSecret);
  console.log('');
  console.log('  Next steps:');
  console.log('    1. Open ' + portalUrl + ' and set your password');
  console.log('    2. Import your chat history:');
  console.log('       ai-exodus import conversations.json');
  console.log('    3. Run analysis:');
  console.log('       ai-exodus analyze --passes all');
  console.log('');
  console.log('  MCP connector URL (for Claude):');
  console.log('  ' + portalUrl + '/mcp/' + mcpSecret + '/search?q=your+query');
  console.log('');
  console.log('  Config saved to ~/.exodus/config.json');
  console.log('');
}


// ── Helpers ──

function checkCommand(cmd, args) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: 'pipe', shell: true });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

function runCommand(cmd, args, { verbose = false, cwd = undefined } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: true, cwd });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      if (verbose) process.stdout.write(d);
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (verbose) process.stderr.write(d);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || stdout.trim() || `Command failed with code ${code}`));
      else resolve(stdout);
    });
  });
}
