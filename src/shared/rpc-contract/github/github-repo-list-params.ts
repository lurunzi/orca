import { z } from 'zod'
import { lazyZodSchema } from '../../schema/lazy-zod-schema'
import { OptionalPositiveInt, OptionalString } from '../rpc-param-primitives'

export const GithubListReposParams = lazyZodSchema(() =>
  z.object({
    query: OptionalString,
    limit: OptionalPositiveInt,
    host: OptionalString
  })
)
