## Prerequisites

- NodeJS (v18+): https://nodejs.org/en/download/package-manager
- Yarn: https://classic.yarnpkg.com/lang/en/docs/install/#debian-stable

## Setup

- Install dependencies:

  ```bash
  yarn
  ```

- Copy sample env file:

  ```bash
  cp sample.env .env
  ```

- Request environment variables and update `.env` with the appropriate values

## Running

- Use node 23:
  ```bash
  nvm use 23
  ```
- Install dependencies:
  ```bash
  yarn
  ```
- Run script:
  ```bash
  yarn start
  ```

## Collecting enough fees with relay (minimum 5$)

Here is a diff on shapeshift you can use to collect 33% of fees from your TX:
```diff
diff --git a/packages/swapper/src/swappers/RelaySwapper/utils/getTrade.ts b/packages/swapper/src/swappers/RelaySwapper/utils/getTrade.ts
index 3844cbc20c..3a602748ed 100644
--- a/packages/swapper/src/swappers/RelaySwapper/utils/getTrade.ts
+++ b/packages/swapper/src/swappers/RelaySwapper/utils/getTrade.ts
@@ -189,7 +189,7 @@ export async function getTrade<T extends 'quote' | 'rate'>({
       appFees: [
         {
           recipient: affiliateTreasuryAddress,
-          fee: affiliateBps,
+          fee: '3300',
         },
       ],
     },
diff --git a/packages/utils/src/treasury.ts b/packages/utils/src/treasury.ts
index 92d0164ac8..dd96a359bc 100644
--- a/packages/utils/src/treasury.ts
+++ b/packages/utils/src/treasury.ts
@@ -31,7 +31,7 @@ export const DAO_TREASURY_POLYGON = '0xB5F944600785724e31Edb90F9DFa16dBF01Af000'
 export const DAO_TREASURY_GNOSIS = '0xb0E3175341794D1dc8E5F02a02F9D26989EbedB3'
 export const DAO_TREASURY_BSC = '0x8b92b1698b57bEDF2142297e9397875ADBb2297E'
 export const DAO_TREASURY_ARBITRUM = '0x38276553F8fbf2A027D901F8be45f00373d8Dd48'
-export const DAO_TREASURY_BASE = '0x9c9aA90363630d4ab1D9dbF416cc3BBC8d3Ed502'
+export const DAO_TREASURY_BASE = '<Your personal address (SAFE wallet please so you test the same setup as the DAO multisig)>'
 
 // Multisigs
 export const DAO_TREASURY_COSMOS = 'cosmos1qgmqsmytnwm6mhyxwjeur966lv9jacfexgfzxs'
diff --git a/src/lib/fees/model.ts b/src/lib/fees/model.ts
index 3f60b692ff..0f97b71052 100644
--- a/src/lib/fees/model.ts
+++ b/src/lib/fees/model.ts
@@ -99,6 +99,7 @@ export const calculateFees: CalculateFeeBps = ({
 
   // the fox discount before any other logic is applied
   const foxBaseDiscountPercent = (() => {
+    return bn(0)
     if (isFree) return bn(100)
 
     const foxDiscountPercent = bnOrZero(foxHeld)
```

You should now do a TX which as a fiat value or around 16$, so around 5$ will be collected as fees

## Run the CLI
- Clone this branch
- Run `yarn start`
- Paste the wc link to your safe wallet WC connection
- Select the token you want to claim
<img width="308" alt="image" src="https://github.com/user-attachments/assets/6d0c8be8-5fc2-496b-8745-0700c4efbf96" />
- Sign the message in your wallet
![image](https://github.com/user-attachments/assets/f32820a5-0899-434c-a3b8-2962e192e10c)
- Here we go
<img width="694" alt="image" src="https://github.com/user-attachments/assets/ae06c233-e306-4d1e-b78b-63aa85f54c22" />
