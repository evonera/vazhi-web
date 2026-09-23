import { createApi } from '@convex-dev/better-auth'
import { createAuthOptions } from './auth'
import schema from './schema'

// The Better Auth component discovers these functions during Convex codegen.
// Without them its generated ComponentApi is empty and adapter(ctx) cannot be
// typechecked or invoked by the component client.
export const { create, findOne, findMany, updateOne, updateMany, deleteOne, deleteMany } =
  createApi(schema, createAuthOptions)
