/**
 * [Gate TripKitFix] 組織・B2B の API は services/api/organizationsApi.ts(後から読む塊)へ移した。
 * 継承の順(PlanSearchApi → OrganizationsApi → …)を変えないため、この型だけを残す。
 */
import { PlanSearchApi } from './planSearch';

export class OrganizationsApi extends PlanSearchApi {}
