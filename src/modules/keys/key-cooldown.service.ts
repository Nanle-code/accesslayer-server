// src/modules/keys/key-cooldown.service.ts
// Buy cooldown status for a wallet on a key (#874).

import { prisma } from '../../utils/prisma.utils';
import { KeyNotFoundError } from './key-fees.service';

/** Approximate seconds per Stellar ledger. */
const SECONDS_PER_LEDGER = 5;

export interface KeyCooldown {
   cooldownActive: boolean;
   remainingSeconds: number;
   unlockEstimatedAt: string | null;
}

const NO_COOLDOWN: KeyCooldown = {
   cooldownActive: false,
   remainingSeconds: 0,
   unlockEstimatedAt: null,
};

/**
 * remainingSeconds = (last_buy_ledger + cooldown_ledgers - current_ledger) * 5.
 * last_buy_ledger is the wallet's most recent trade ledger on the key and
 * current_ledger is the latest indexed ledger. The cooldown is inactive when
 * none is configured, the wallet never bought, or the window has elapsed.
 */
export async function getKeyCooldown(
   keyId: string,
   walletAddress: string
): Promise<KeyCooldown> {
   const creator = await prisma.creatorProfile.findFirst({
      where: { OR: [{ id: keyId }, { handle: keyId }] },
      select: { id: true, cooldownLedgers: true },
   });
   if (!creator) {
      throw new KeyNotFoundError(keyId);
   }
   if (creator.cooldownLedgers <= 0) {
      return NO_COOLDOWN;
   }

   const [lastBuy, indexed] = await Promise.all([
      prisma.trade.findFirst({
         where: { buyer: walletAddress, creatorId: creator.id },
         orderBy: { ledger: 'desc' },
         select: { ledger: true },
      }),
      prisma.indexedLedger.findUnique({
         where: { id: 1 },
         select: { ledger: true },
      }),
   ]);
   if (!lastBuy || !indexed) {
      return NO_COOLDOWN;
   }

   const remainingLedgers =
      lastBuy.ledger + creator.cooldownLedgers - indexed.ledger;
   if (remainingLedgers <= 0) {
      return NO_COOLDOWN;
   }

   const remainingSeconds = remainingLedgers * SECONDS_PER_LEDGER;
   return {
      cooldownActive: true,
      remainingSeconds,
      unlockEstimatedAt: new Date(
         Date.now() + remainingSeconds * 1000
      ).toISOString(),
   };
}
