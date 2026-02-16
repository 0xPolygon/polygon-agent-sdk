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
      const { walletCreate, walletCreateAndWait } = await import('./commands/wallet.mjs')
      if (process.argv.includes('--wait')) {
        await walletCreateAndWait()
      } else {
        await walletCreate()
      }
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
    } else if (cmd === 'agent-wallet') {
      const { getAgentWallet } = await import('./commands/registry.mjs')
      await getAgentWallet()
    } else if (cmd === 'agent-metadata') {
      const { getMetadata } = await import('./commands/registry.mjs')
      await getMetadata()
    } else if (cmd === 'reputation') {
      const { getReputation } = await import('./commands/registry.mjs')
      await getReputation()
    } else if (cmd === 'give-feedback') {
      const { giveFeedback } = await import('./commands/registry.mjs')
      await giveFeedback()
    } else if (cmd === 'read-feedback') {
      const { readAllFeedback } = await import('./commands/registry.mjs')
      await readAllFeedback()
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
  wallet create --name <name> --wait    Create + wait for callback (zero copy/paste)
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

REGISTRY (ERC-8004 on Polygon):
  register --wallet <name> --name <n>   Register agent identity
  agent-wallet --agent-id <id>          Get agent payment wallet
  agent-metadata --agent-id <id> --key  Get agent metadata
  reputation --agent-id <id>            Get agent reputation score
  give-feedback --wallet <name> --agent-id <id> --value <score>  Submit feedback
  read-feedback --agent-id <id>         Read all agent feedback

Environment Variables:
  SEQUENCE_PROJECT_ACCESS_KEY           Project access key (from builder setup)
  SEQUENCE_DAPP_ORIGIN                  Connector URL for wallet creation
  SEQUENCE_INDEXER_ACCESS_KEY           Indexer key for balance checks

For detailed help: polygon-agent <command> --help
`)
  process.exit(cmd ? 1 : 0)
}

main()
