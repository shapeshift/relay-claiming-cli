import 'dotenv/config'
import * as prompts from '@inquirer/prompts'
import { Command } from 'commander'
import { error, log, warn } from 'node:console'
import Client, { SignClient } from "@walletconnect/sign-client";
import type { SessionTypes } from "@walletconnect/types";
import { baseChainId, baseRelayChainId, relayBaseUrl } from './constants';
import axios from 'axios';
import { ClaimApiResponse, RelayBalanceResponse } from './types';

const program = new Command()

program.name('Relay Claiming CLI')
program.description('Here to help you do all things for relay claiming')
program.parse(process.argv)

const shutdown = () => {
  warn('Received shutdown signal, exiting.')
  process.exit(0)
}

const getBalanceToClaim = async (address: string): Promise<string | undefined> => {
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

const connectWallet = async (signClient: Client): Promise<SessionTypes.Struct> => {
  const { uri, approval } = await signClient.connect({
    requiredNamespaces: {
      eip155: {
        methods: ["personal_sign"],
        chains: [baseChainId],
        events: ["accountsChanged", "chainChanged"],
      },
    },
  });

  if (uri) {
    log('--- ACTION REQUIRED ---');
    log('Please connect to your wallet using the following URI:');
    log(uri);
    log('-----------------------');
  }

  log('Waiting for wallet connection approval...');
  const session = await approval();
  log(`Wallet connected! Session established for topic: ${session.topic}`);
  
  return session;
}

const getRecipientAddress = (session: SessionTypes.Struct): string => {
  const accounts = session.namespaces.eip155?.accounts;
  if (!accounts || accounts.length === 0) {
    throw new Error("No EIP155 accounts found in session.");
  }
  const recipient = accounts[0].split(':')[2];
  log(`Using recipient address: ${recipient}`);
  
  return recipient;
}

const requestClaimMessage = async (recipient: string, currencyAddress: string): Promise<ClaimApiResponse> => {
  const claimApiUrl = `${relayBaseUrl}/app-fees/${recipient}/claim`;
  log(`Sending claim request to: ${claimApiUrl}`);

  const response = await axios.post<ClaimApiResponse>(claimApiUrl, {
    chainId: baseRelayChainId,
    currency: currencyAddress,
    recipient: recipient,
  }, {
    headers: { 'Content-Type': 'application/json' },
  });

  log('Claim API Response received:');
  log(JSON.stringify(response.data, null, 2));
  
  return response.data;
}

const handleSignature = async (
  signClient: Client, 
  session: SessionTypes.Struct, 
  claimResponse: ClaimApiResponse, 
  recipient: string
): Promise<string | undefined> => {
  const firstStep = claimResponse.steps?.[0];
  const firstItem = firstStep?.items?.[0];

  if (firstStep?.kind !== 'signature' || 
      firstItem?.status !== 'incomplete' || 
      !firstItem.data?.sign?.message) {
    warn('Could not find a signature request in the first step of the response.');
    log('Full steps data:', JSON.stringify(claimResponse.steps, null, 2));
    return undefined;
  }

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
  });

  log('Signature received:', signature);
  return signature as string;
}

const executePermit = async (signature: string, requestId: string): Promise<void> => {
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
  } catch (executeError) {
    error('Error executing permits:', executeError instanceof Error ? executeError.message : executeError);
    if (axios.isAxiosError(executeError)) {
      error('Response status:', executeError.response?.status);
      error('Response data:', executeError.response?.data);
    }
    throw executeError;
  }
}

const claim = async () => {
  let session: SessionTypes.Struct | undefined = undefined;

  const signClient = await SignClient.init({
    projectId: process.env.WALLETCONNECT_PROJECT_ID,
    metadata: {
      name: "Relay Claiming CLI",
      description: "Relay Claiming CLI",
      url: "https://github.com/shapeshift/relay-claiming-cli",
      icons: ["https://walletconnect.com/walletconnect-logo.png"],
    },
  });

  signClient.on("session_delete", shutdown)

  try {
    session = await connectWallet(signClient);
    
    const recipient = getRecipientAddress(session);
    const currencyAddress = await getBalanceToClaim(recipient);

    if (!currencyAddress) {
      throw new Error("No currency selected or available. Exiting.");
    }

    const claimResponse = await requestClaimMessage(recipient, currencyAddress);
    
    const signature = await handleSignature(signClient, session, claimResponse, recipient);

    if (claimResponse.steps.length > 1) {
      throw new Error("Multiple steps found in the claim response. Exiting as we don't support this yet. Please contact the engineering workstream.");
    }
    
    if (signature) {
      const firstStep = claimResponse.steps?.[0];
      const firstItem = firstStep?.items?.[0];
      const requestId = firstItem?.data?.sign?.message;
      
      if (!requestId) {
        throw new Error("Could not find requestId in the claim response.");
      }
      
      await executePermit(signature, requestId);
    }
  } catch (err) {
    error('Error during claim process:', err instanceof Error ? err.message : err)
    if (axios.isAxiosError(err)) {
      error('Response status:', err.response?.status);
      error('Response data:', err.response?.data);
    }
  } finally {
    if (session && signClient) {
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
  process.exit(0);
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

main().catch(err => {
  error("Unhandled error in main:", err);
  process.exit(1);
});
