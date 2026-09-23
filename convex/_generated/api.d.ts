/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as askProjections from "../askProjections.js";
import type * as background from "../background.js";
import type * as http from "../http.js";
import type * as listings from "../listings.js";
import type * as migrations from "../migrations.js";
import type * as placeLimits from "../placeLimits.js";
import type * as places from "../places.js";
import type * as pathRouting from "../pathRouting.js";
import type * as profiles from "../profiles.js";
import type * as providerEvents from "../providerEvents.js";
import type * as requests from "../requests.js";
import type * as routes from "../routes.js";
import type * as sync from "../sync.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  askProjections: typeof askProjections;
  background: typeof background;
  http: typeof http;
  listings: typeof listings;
  migrations: typeof migrations;
  placeLimits: typeof placeLimits;
  places: typeof places;
  pathRouting: typeof pathRouting;
  profiles: typeof profiles;
  providerEvents: typeof providerEvents;
  requests: typeof requests;
  routes: typeof routes;
  sync: typeof sync;
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
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  backgroundWorkpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"backgroundWorkpool">;
};
