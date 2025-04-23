export type RelayCurrency = {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  metadata: {
    logoURI: string;
    verified: boolean;
    isNative: boolean;
  };
};

export type RelayBalanceResponse = {
  balances: RelayBalance[];
};

export type RelayBalance = {
  currency: RelayCurrency;
  amount: string;
  amountFormatted: string;
  amountUsd: string;
  minimumAmount: string;
};

export type SignData = {
  signatureKind: 'eip191' | 'eip712';
  message: string;
};

export type PostData = {
  endpoint: string;
  method: 'POST';
  body: {
    kind: string;
    requestId: string;
    signature?: string;
  };
};

export type ClaimItemData = {
  sign: SignData;
  post: PostData;
};

export type ClaimItem = {
  status: 'incomplete' | 'complete' | 'pending';
  data: ClaimItemData;
  txHash?: string;
};

export type ClaimStep = {
  id: string;
  action: string;
  description: string;
  kind: 'signature' | 'transaction';
  items: ClaimItem[];
};

export type ClaimApiResponse = {
  steps: ClaimStep[];
};
