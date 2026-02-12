#!/usr/bin/env node

// Polygon Agent Kit - Main CLI Entry Point
// Agent-first blockchain toolkit for Polygon

const cmd = process.argv[2]
const subCmd = process.argv[3]

async function main() {
  try {
    if (cmd === 'builder' && subCmd === 'setup') {
      const { builderSetup } = await import('./commands/builder.mjs')
      await builderSetup()
    } else if (cmd === 'wallet' && subCmd === 'create') {
      const { walletCreate } = await import('./commands/wallet.mjs')
      await walletCreate()
    } else if (cmd === 'wallet' && subCmd === 'start-session') {
      const { walletStartSession } = await import('./commands/wallet.mjs')
      await walletStartSession()
    } else if (cmd === 'wallet' && subCmd === 'list') {
      const { walletList } = await import('./commands/wallet.mjs')
      await walletList()
    } else if (cmd === 'wallet' && subCmd === 'address') {
      const { walletAddress } = await import('./commands/wallet.mjs')
      await walletAddress()
    } else if (cmd === 'wallet' && subCmd === 'remove') {
      const { walletRemove } = await import('./commands/wallet.mjs')
      await walletRemove()
    } else if (cmd === 'balances') {
      const { balances } = await import('./commands/operations.mjs')
      await balances()
    } else if (cmd === 'send') {
      const { send } = await import('./commands/operations.mjs')
      await send()
    } else if (cmd === 'send-native') {
      const { sendNative } = await import('./commands/operations.mjs')
      await sendNative()
    } else if (cmd === 'send-token') {
      const { sendToken } = await import('./commands/operations.mjs')
      await sendToken()
    } else if (cmd === 'swap') {
      const { swap } = await import('./commands/operations.mjs')
      await swap()
    } else if (cmd === 'register') {
      const { registerAgent } = await import('./commands/registry.mjs')
      await registerAgent()
    } else {
      showHelp()
    }
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message, stack: err.stack }, null, 2))
    process.exit(1)
  }
}

function showHelp() {
  console.log(`
Polygon Agent Kit - Complete agent development toolkit

Usage: polygon-agent <command> [options]

BUILDER (Get Sequence project access key):
  builder setup --name <name>           One-command setup (EOA + auth + project)

WALLET (Create ecosystem wallet):
  wallet create --name <name>           Create wallet session request
  wallet start-session --name <name>    Start wallet session from ciphertext
  wallet list                           List all wallets
  wallet address --name <name>          Show wallet address
  wallet remove --name <name>           Remove wallet

OPERATIONS (Token & swap):
  balances --wallet <name>              Check token balances
  send --wallet <name> --to <addr>      Send native token (auto-detect)
  send-native --wallet <name> --to ...  Send native token (POL/MATIC)
  send-token --wallet <name> --symbol   Send ERC20 by symbol
  swap --wallet <name> --from --to      Execute DEX swap (coming soon)

REGISTRY (8004 on Polygon):
  register --wallet <name> --name <n>   Register agent on 8004 (coming soon)

Environment Variables:
  SEQUENCE_PROJECT_ACCESS_KEY           Project access key (from builder setup)
  SEQUENCE_DAPP_ORIGIN                  Connector URL for wallet creation
  SEQUENCE_INDEXER_ACCESS_KEY           Indexer key for balance checks

For detailed help: polygon-agent <command> --help
`)
  process.exit(cmd ? 1 : 0)
}

main()
