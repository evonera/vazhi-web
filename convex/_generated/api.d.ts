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
import type * as askProjections from "../askProjections.js";
import type * as betterAuth__generated_api from "../betterAuth/_generated/api.js";
import type * as betterAuth__generated_component from "../betterAuth/_generated/component.js";
import type * as betterAuth__generated_dataModel from "../betterAuth/_generated/dataModel.js";
import type * as betterAuth__generated_server from "../betterAuth/_generated/server.js";
import type * as betterAuth_auth from "../betterAuth/auth.js";
import type * as http from "../http.js";
import type * as mapsValidation from "../mapsValidation.js";
import type * as pathRouting from "../pathRouting.js";
import type * as placeLimits from "../placeLimits.js";
import type * as places from "../places.js";
import type * as profiles from "../profiles.js";
import type * as requests from "../requests.js";
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
  askProjections: typeof askProjections;
  "betterAuth/_generated/api": typeof betterAuth__generated_api;
  "betterAuth/_generated/component": typeof betterAuth__generated_component;
  "betterAuth/_generated/dataModel": typeof betterAuth__generated_dataModel;
  "betterAuth/_generated/server": typeof betterAuth__generated_server;
  "betterAuth/auth": typeof betterAuth_auth;
  http: typeof http;
  mapsValidation: typeof mapsValidation;
  pathRouting: typeof pathRouting;
  placeLimits: typeof placeLimits;
  places: typeof places;
  profiles: typeof profiles;
  requests: typeof requests;
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
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
