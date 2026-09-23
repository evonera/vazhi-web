/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as acceptedRecommendationOrder from "../acceptedRecommendationOrder.js";
import type * as ai from "../ai.js";
import type * as aiRequestValidation from "../aiRequestValidation.js";
import type * as askProjections from "../askProjections.js";
import type * as background from "../background.js";
import type * as http from "../http.js";
import type * as listings from "../listings.js";
import type * as migrations from "../migrations.js";
import type * as moderationAuth from "../moderationAuth.js";
import type * as moderationPagination from "../moderationPagination.js";
import type * as moderationPolicy from "../moderationPolicy.js";
import type * as places from "../places.js";
import type * as profiles from "../profiles.js";
import type * as publicGuideSanitization from "../publicGuideSanitization.js";
import type * as publicReportReceipt from "../publicReportReceipt.js";
import type * as rateLimitKey from "../rateLimitKey.js";
import type * as recommendationStatusTransition from "../recommendationStatusTransition.js";
import type * as requests from "../requests.js";
import type * as routeRefreshValidation from "../routeRefreshValidation.js";
import type * as routes from "../routes.js";
import type * as sync from "../sync.js";
import type * as syncValidation from "../syncValidation.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  acceptedRecommendationOrder: typeof acceptedRecommendationOrder;
  ai: typeof ai;
  aiRequestValidation: typeof aiRequestValidation;
  askProjections: typeof askProjections;
  background: typeof background;
  http: typeof http;
  listings: typeof listings;
  migrations: typeof migrations;
  moderationAuth: typeof moderationAuth;
  moderationPagination: typeof moderationPagination;
  moderationPolicy: typeof moderationPolicy;
  places: typeof places;
  profiles: typeof profiles;
  publicGuideSanitization: typeof publicGuideSanitization;
  publicReportReceipt: typeof publicReportReceipt;
  rateLimitKey: typeof rateLimitKey;
  recommendationStatusTransition: typeof recommendationStatusTransition;
  requests: typeof requests;
  routeRefreshValidation: typeof routeRefreshValidation;
  routes: typeof routes;
  sync: typeof sync;
  syncValidation: typeof syncValidation;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  backgroundWorkpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"backgroundWorkpool">;
};
