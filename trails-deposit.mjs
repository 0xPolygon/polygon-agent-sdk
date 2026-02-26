import { TrailsApi, TradeType, FundMethod } from './node_modules/@0xtrails/api/dist/index.js'
import { createWalletClient, createPublicClient, http, parseUnits } from 'viem'
import { polygon } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const TRAILS_API_KEY = 'AQAAAAAAALljsPpofr935DOEGOaNXJkixuU'
const PRIVATE_KEY = '0xf387f06ff6c7c2402a5f786c3ba3eccb04c64d6e9a13ad273dadad431c123b3e'
const USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
const POLYMARKET_DEPOSIT = '0x86A51A62337Fa4Aeb01fe404FbCA2a62592317ba' // EOA deposit address
const AMOUNT_USDC = parseUnits('5', 6) // 5 USDC to EOA account

const account = privateKeyToAccount(PRIVATE_KEY)
console.log('Sender (EOA):', account.address)

const walletClient = createWalletClient({ account, chain: polygon, transport: http('https://1rpc.io/matic') })
const publicClient = createPublicClient({ chain: polygon, transport: http('https://1rpc.io/matic') })

const trails = new TrailsApi(TRAILS_API_KEY)

async function main() {
  console.log('\n1. Quoting intent: 5 USDC on Polygon → Polymarket deposit address...')

  const quote = await trails.quoteIntent({
    ownerAddress: account.address,
    originChainId: 137,
    originTokenAddress: USDC_POLYGON,
    destinationChainId: 137,
    destinationTokenAddress: USDC_POLYGON,
    destinationToAddress: POLYMARKET_DEPOSIT,
    destinationTokenAmount: AMOUNT_USDC,
    tradeType: TradeType.EXACT_OUTPUT,
    fundMethod: FundMethod.WALLET,
  })

  console.log('Quote received. Passthrough eligible:', quote.passthrough?.eligible)

  if (quote.passthrough?.eligible && quote.passthrough?.passthroughTransaction) {
    const tx = quote.passthrough.passthroughTransaction
    console.log('\n2. Executing passthrough transfer...')
    console.log('   To:', tx.to)
    console.log('   Value:', tx.value?.toString())

    const hash = await walletClient.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value ?? 0n,
    })

    console.log('\n✓ Transaction submitted:', hash)
    console.log('  Waiting for confirmation...')

    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    console.log('✓ Confirmed in block', receipt.blockNumber)
    console.log('  Status:', receipt.status)
  } else {
    // Full intent flow: commit → sign deposit → execute
    console.log('\n2. Committing intent...')
    const committed = await trails.commitIntent({ quoteId: quote.quoteId })
    const intent = committed.intent
    console.log('   Intent ID:', intent.intentId)

    const deposit = intent.depositTransaction
    console.log('\n3. Sending deposit transaction...')
    console.log('   To:', deposit.to)
    console.log('   Amount:', deposit.amount?.toString(), 'USDC raw')

    const hash = await walletClient.sendTransaction({
      to: deposit.to,
      data: deposit.data,
      value: deposit.value ?? 0n,
    })

    console.log('\n✓ Deposit submitted:', hash)
    console.log('  Waiting for Trails to execute...')

    const receipt = await trails.waitIntentReceipt({
      intentId: intent.intentId,
      timeout: 120000,
    })

    console.log('\n✓ Intent completed! Status:', receipt.receipt?.summary?.status)
    console.log('  Destination tx:', receipt.receipt?.destinationTransaction?.txHash)
  }

  console.log('\nDone! Check Polymarket CLOB balance to confirm credit.')
}

main().catch(console.error)
