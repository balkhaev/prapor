import { parseTradeAsset } from './trade';
import type { TradeAsset } from './trade';
import type { GameIdentity } from './commands';

export const MARKET_MAX_PRICE = 1_000_000;
export const MARKET_MAX_ACTIVE = 6;
export const MARKET_LISTING_FEE_RATE = 0.02;
export const MARKET_COMMISSION_RATE = 0.05;
export const getMarketListingFee = (price: number) => Math.max(1, Math.ceil(price * MARKET_LISTING_FEE_RATE));
export const getMarketCommission = (price: number) => Math.max(1, Math.ceil(price * MARKET_COMMISSION_RATE));
export const getMarketFees = (price: number) => ({ listingFee: getMarketListingFee(price), commission: getMarketCommission(price), proceeds: price - getMarketCommission(price) });

/** An offer contains an escrow item snapshot, never a player's game state or identity key. */
export interface MarketListing {
  id: string;
  asset: TradeAsset;
  label: string;
  guidePrice: number;
  price: number;
  listingFee: number;
  commission: number;
  proceeds: number;
  createdAt: number;
  status: 'active' | 'sold' | 'cancelled';
  soldAt: number | null;
  claimedAt: number | null;
  owner: boolean;
  claimable: boolean;
}
export interface MarketSnapshot {
  identity: GameIdentity;
  serverNow: number;
  offers: MarketListing[];
  mine: MarketListing[];
  receivables: number;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

/** Shared strict wire reader rejects invented fees, asset data and inconsistent receipts. */
export function readMarketSnapshot(value: unknown): MarketSnapshot {
  const invalid = (): never => { throw new Error('invalid_market_response'); };
  if (!record(value) || !exact(value, ['identity', 'serverNow', 'offers', 'mine', 'receivables']) || !integer(value.serverNow) || !integer(value.receivables)
    || !record(value.identity) || !exact(value.identity, ['id', 'kind', 'name']) || !text(value.identity.id, 160) || !text(value.identity.name, 80)
    || !['guest', 'account'].includes(value.identity.kind as string) || !Array.isArray(value.offers) || value.offers.length > 200 || !Array.isArray(value.mine) || value.mine.length > 50) return invalid();
  const listing = (raw: unknown): MarketListing => {
    if (!record(raw) || !exact(raw, ['id', 'asset', 'label', 'guidePrice', 'price', 'listingFee', 'commission', 'proceeds', 'createdAt', 'status', 'soldAt', 'claimedAt', 'owner', 'claimable'])
      || !text(raw.id, 160) || !text(raw.label, 200) || !integer(raw.guidePrice, 1_000_000_000) || !integer(raw.price, MARKET_MAX_PRICE) || raw.price < 1
      || !integer(raw.createdAt) || !['active', 'sold', 'cancelled'].includes(raw.status as string) || typeof raw.owner !== 'boolean' || typeof raw.claimable !== 'boolean') return invalid();
    const fees = getMarketFees(raw.price), asset = parseTradeAsset(raw.asset);
    if (!asset || raw.listingFee !== fees.listingFee || raw.commission !== fees.commission || raw.proceeds !== fees.proceeds) return invalid();
    if (raw.status === 'sold') {
      if (!integer(raw.soldAt) || raw.soldAt < raw.createdAt || !(raw.claimedAt === null || integer(raw.claimedAt) && raw.claimedAt >= raw.soldAt)) return invalid();
    } else if (raw.soldAt !== null || raw.claimedAt !== null) return invalid();
    if (raw.claimable !== (raw.owner && raw.status === 'sold' && raw.claimedAt === null)) return invalid();
    return { ...raw, asset } as unknown as MarketListing;
  };
  const offers = value.offers.map(listing), mine = value.mine.map(listing);
  if (new Set(offers.map(item => item.id)).size !== offers.length || new Set(mine.map(item => item.id)).size !== mine.length
    || offers.some(item => item.status !== 'active') || mine.some(item => !item.owner)
    || mine.filter(item => item.claimable).reduce((sum, item) => sum + item.proceeds, 0) > value.receivables) return invalid();
  return { identity: { id: value.identity.id, kind: value.identity.kind as GameIdentity['kind'], name: value.identity.name }, serverNow: value.serverNow, receivables: value.receivables, offers, mine };
}
