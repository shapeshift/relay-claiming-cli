import 'dotenv/config'
import * as prompts from '@inquirer/prompts'
import { Command } from 'commander'
import { error, log, warn } from 'node:console'
import { SignClient } from "@walletconnect/sign-client";
import type { SessionTypes } from "@walletconnect/types";
import { baseChainId, baseRelayChainId, relayBaseUrl } from './constants';
import axios from 'axios';
import { ClaimApiResponse, ClaimRequestBody, RelayBalance, RelayBalanceResponse } from './types';

const program = new Command()

program.name('Relay Claiming CLI')
program.description('Here to help you do all things for relay claiming')
program.parse(process.argv)

const shutdown = () => {
  warn('Received shutdown signal, exiting.')
  process.exit(0)
}

const chooseTokenClaim = async (address: string): Promise<string | undefined> => {
  try {
    const apiUrl = `${relayBaseUrl}/app-fees/${address}/balances`;
    log(`Fetching balances from: ${apiUrl}`);
    const response = await axios.get<RelayBalanceResponse>(apiUrl);
    const balances = response.data.balances;

    if (!balances || balances.length === 0) {
      warn('No claimable balances found for the configured treasury address.');
      return undefined;
    }

    log(`Found ${balances.length} claimable balances.`);

    const choice = await prompts.select<string>({
      message: 'Which token do you want to claim?',
      choices: balances.map(balance => ({
        name: `${balance.currency.symbol} (${balance.amountFormatted})`,
        value: balance.currency.address,
        description: `$${parseFloat(balance.amountUsd).toFixed(2)} USD - ${balance.currency.name}`,
      })),
    });

    return choice;
  } catch (err) {
    error('Error fetching balances:', err instanceof Error ? err.message : err);
    if (axios.isAxiosError(err)) {
      error('Response data:', err.response?.data);
    }
    process.exit(1);
  }
}

const claim = async () => {
  let session: SessionTypes.Struct | undefined = undefined;

  const signClient = await SignClient.init({
    projectId: process.env.WALLETCONNECT_PROJECT_ID,
    relayUrl: process.env.WALLETCONNECT_RELAY_URL,
    metadata: {
      name: "Relay Claiming CLI",
      description: "Relay Claiming CLI",
      url: "https://github.com/shapeshift/relay-claiming-cli",
      icons: ["https://walletconnect.com/walletconnect-logo.png"],
    },
  });

  signClient.on("session_delete", shutdown)

  try {
    const { uri, approval } = await signClient.connect({
      requiredNamespaces: {
        eip155: {
          methods: [
            "eth_sendTransaction",
            "eth_sign",
            "personal_sign",
            "eth_signTypedData",
            "eth_signTypedData_v4",
          ],
          chains: [baseChainId],
          events: ["accountsChanged", "chainChanged"],
        },
      },
    });

    if (uri) {
      log('Please connect to your wallet using the following URI:');
      log(uri);
    }

    log('Waiting for wallet connection approval...');
    session = await approval();
    log(`Wallet connected! Session established for topic: ${session.topic}`);

    const accounts = session.namespaces.eip155?.accounts;
    if (!accounts || accounts.length === 0) {
      throw new Error("No EIP155 accounts found in session.");
    }
    const recipient = accounts[0].split(':')[2];
    log(`Using recipient address: ${recipient}`);

    const currencyAddress = await chooseTokenClaim(recipient);

    if (!currencyAddress) {
      throw new Error("No currency selected or available. Exiting.");
    }

    const claimApiUrl = `${relayBaseUrl}/app-fees/${recipient}/claim`;
    const requestBody: ClaimRequestBody = {
      chainId: baseRelayChainId,
      currency: currencyAddress,
      recipient: recipient,
    };

    log(`Sending claim request to: ${claimApiUrl}`);

    const claimResponse = await axios.post<ClaimApiResponse>(claimApiUrl, requestBody, {
      headers: { 'Content-Type': 'application/json' },
    });

    log('Claim API Response received:');
    log(JSON.stringify(claimResponse.data, null, 2));

    const firstStep = claimResponse.data.steps?.[0];
    const firstItem = firstStep?.items?.[0];

    if (firstStep?.kind === 'signature' && firstItem?.status === 'incomplete' && firstItem.data?.sign?.message) {
      const messageToSign = firstItem.data.sign.message;
      log('--- ACTION REQUIRED ---');
      log(`Please sign the following message using your connected wallet:`);
      log(messageToSign);
      log('-----------------------');

      const signature = await signClient.request({
        chainId: baseChainId,
        topic: session.topic,
        request: {
          method: 'personal_sign',
          params: [messageToSign, recipient],
        }
      })

      log('Signature received:', signature);

      const requestId = firstItem.data.sign.message;

      if (!requestId) {
        throw new Error("Could not find requestId in the claim response.");
      }

      const executePermitsUrl = `${relayBaseUrl}/execute/permits?signature=${signature}`;
      const executePermitsBody = {
        kind: "claim",
        requestId: requestId,
      };

      log(`Executing permit with URL: ${executePermitsUrl}`);
      log(`Request Body: ${JSON.stringify(executePermitsBody, null, 2)}`);

      try {
        const executeResponse = await axios.post(executePermitsUrl, executePermitsBody, {
          headers: { 'Content-Type': 'application/json' },
        });

        log('Execute permits response received:');
        log(JSON.stringify(executeResponse.data, null, 2));
        // TODO: Handle further steps if needed based on executeResponse.data

      } catch (executeError) {
        error('Error executing permits:', executeError instanceof Error ? executeError.message : executeError);
        if (axios.isAxiosError(executeError)) {
          error('Response status:', executeError.response?.status);
          error('Response data:', executeError.response?.data);
        }
        // Decide if we should re-throw or exit here
        throw executeError; // Re-throw to be caught by the outer catch block
      }

    } else {
      warn('Could not find a signature request in the first step of the response.');
      log('Full steps data:', JSON.stringify(claimResponse.data.steps, null, 2));
    }

  } catch (err) {
    error('Error during claim process:', err instanceof Error ? err.message : err)
    if (axios.isAxiosError(err)) {
      error('Response status:', err.response?.status);
      error('Response data:', err.response?.data);
    }
  } finally {
    if (session) {
      await signClient.disconnect({
        topic: session.topic,
        reason: {
          code: 1,
          message: 'Program finished executing',
        },
      })
    }
  }
}

const main = async () => {
  await claim();

  log("Claim process initiated. Waiting for further actions or shutdown signal.");
  process.exit(0);
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

main().catch(err => {
  error("Unhandled error in main:", err);
  process.exit(1);
});
